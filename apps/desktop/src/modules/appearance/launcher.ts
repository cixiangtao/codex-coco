import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, writeFile, mkdir, rename, unlink, realpath, lstat } from "node:fs/promises";
import { dirname, join, isAbsolute } from "node:path";
import { createServer } from "node:net";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { z } from "zod";
import type { AppearanceConfig } from "./contract";
const exec = promisify(execFile);
const selectionSchema = z.strictObject({
  path: z.string().max(4096),
  port: z.number().int().min(1024).max(65535).nullable(),
});
export interface AppearanceLauncher {
  selected(): Promise<boolean>;
  /** Reads only the selected bundle's process arguments; paths and arguments stay private. */
  probe?(signal: AbortSignal): Promise<{ running: boolean; debugPort: number | null }>;
  choose(signal: AbortSignal): Promise<boolean>;
  port(config: AppearanceConfig): Promise<number>;
  launch(config: AppearanceConfig, restart: boolean, signal: AbortSignal): Promise<number>;
}
async function freePort() {
  const server = createServer();
  return new Promise<number>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close((error) =>
        error || !address || typeof address === "string"
          ? reject(new Error("LAUNCH_FAILED"))
          : resolve(address.port),
      );
    });
  });
}
/** A private native selection, never a renderer-supplied executable, owns launch and explicit quit. */
export function createAppearanceLauncher(options: {
  file: string;
  pick(): Promise<string | null>;
  bundleId?: string;
  run?: (command: string, args: string[], signal: AbortSignal) => Promise<string>;
}): AppearanceLauncher {
  const run =
    options.run ??
    (async (command, args, signal) =>
      (
        await exec(command, args, {
          signal,
          timeout: 5000,
          maxBuffer: 512 * 1024,
          killSignal: "SIGKILL",
        })
      ).stdout);
  async function selection() {
    try {
      if ((await lstat(options.file)).size > 8192) throw new Error("LAUNCH_FAILED");
      const value = selectionSchema.parse(JSON.parse(await readFile(options.file, "utf8")));
      if (!isAbsolute(value.path) || !value.path.endsWith(".app")) throw new Error("LAUNCH_FAILED");
      return value;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw new Error("LAUNCH_FAILED");
    }
  }
  async function save(value: z.infer<typeof selectionSchema>) {
    await mkdir(dirname(options.file), { recursive: true, mode: 0o700 });
    const temporary = `${options.file}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, JSON.stringify(value), { mode: 0o600, flag: "wx" });
      await rename(temporary, options.file);
    } finally {
      await unlink(temporary).catch(() => undefined);
    }
  }
  async function bundle(path: string, signal: AbortSignal) {
    const resolved = await realpath(path);
    if (!resolved.endsWith(".app") || !(await lstat(resolved)).isDirectory())
      throw new Error("LAUNCH_FAILED");
    const info = JSON.parse(
      await run(
        "/usr/bin/plutil",
        ["-convert", "json", "-o", "-", join(resolved, "Contents/Info.plist")],
        signal,
      ),
    ) as { CFBundleIdentifier?: unknown; CFBundleExecutable?: unknown };
    if (
      typeof info.CFBundleIdentifier !== "string" ||
      info.CFBundleIdentifier !== (options.bundleId ?? "com.openai.codex") ||
      typeof info.CFBundleExecutable !== "string" ||
      !/^[\w .-]+$/.test(info.CFBundleExecutable) ||
      [".", ".."].includes(info.CFBundleExecutable)
    )
      throw new Error("LAUNCH_FAILED");
    return {
      path: resolved,
      id: info.CFBundleIdentifier,
      executable: join(resolved, "Contents/MacOS", info.CFBundleExecutable),
    };
  }
  return {
    selected: async () => Boolean(await selection()),
    probe: async (signal) => {
      const selected = await selection();
      if (!selected) return { running: false, debugPort: null };
      const chosen = await bundle(selected.path, signal);
      const processes = await run("/bin/ps", ["-ww", "-axo", "pid=,comm="], signal);
      const matches = processes.split("\n").flatMap((line) => {
        const match = /^\s*(\d+)\s+(.+)$/.exec(line);
        return match?.[2]?.trim() === chosen.executable ? [match[1]!] : [];
      });
      for (const pid of matches) {
        const args = await run("/bin/ps", ["-ww", "-p", pid, "-o", "args="], signal);
        const match = /(?:^|\s)--remote-debugging-port(?:=|\s+)(\d+)(?=\s|$)/.exec(args);
        const port = Number(match?.[1]);
        if (Number.isInteger(port) && port >= 1024 && port <= 65535)
          return { running: true, debugPort: port };
      }
      return { running: matches.length > 0, debugPort: null };
    },
    choose: async (signal) => {
      const path = await options.pick();
      signal.throwIfAborted();
      if (!path) return false;
      const chosen = await bundle(path, signal);
      await save({ path: chosen.path, port: null });
      return true;
    },
    port: async (config) =>
      config.portMode === "fixed" ? config.port : ((await selection())?.port ?? config.port),
    launch: async (config, restart, signal) => {
      if (process.platform !== "darwin") throw new Error("LAUNCH_FAILED");
      const selected = await selection();
      if (!selected) throw new Error("APP_NOT_SELECTED");
      const chosen = await bundle(selected.path, signal);
      const running = async () =>
        (await run("/bin/ps", ["-ww", "-axo", "comm="], signal))
          .split("\n")
          .some((line) => line.trim() === chosen.executable);
      if (await running()) {
        if (!restart) throw new Error("APP_RUNNING");
        // The native picker and the main-window restart confirmation authorize only this bundle.
        await run(
          "/usr/bin/osascript",
          ["-e", `tell application ${JSON.stringify(chosen.path)} to quit`],
          signal,
        );
        const until = Date.now() + 10_000;
        while (await running()) {
          if (Date.now() > until) throw new Error("APP_RUNNING");
          await delay(150, undefined, { signal });
        }
      }
      const port = config.portMode === "fixed" ? config.port : await freePort();
      // Save before launch so restart recovery uses the same loopback port even if the task is cancelled.
      await save({ path: chosen.path, port });
      signal.throwIfAborted();
      await run(
        "/usr/bin/open",
        [
          "-n",
          "-a",
          chosen.path,
          "--args",
          `--remote-debugging-port=${port}`,
          "--remote-debugging-address=127.0.0.1",
        ],
        signal,
      );
      return port;
    },
  };
}
