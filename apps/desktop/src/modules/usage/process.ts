import { spawn } from "node:child_process";
import { codexCommand } from "./app-server";

export interface CommandOptions {
  command?: string;
  prefixArgs?: string[];
  env?: NodeJS.ProcessEnv;
  environment?(): Promise<NodeJS.ProcessEnv>;
}
/** Owns a bounded process group. No shell, raw errors or stderr cross the service boundary. */
export async function runCodexCommand(
  args: string[],
  options: { cwd: string; input?: string; signal: AbortSignal; timeoutMs: number },
  host: CommandOptions = {},
) {
  const environment = { ...(host.env ?? process.env), ...(await host.environment?.()) };
  const command = host.command ?? (await codexCommand(environment, options.signal));
  options.signal.throwIfAborted();
  const child = spawn(command, [...(host.prefixArgs ?? []), ...args], {
    cwd: options.cwd,
    env: environment,
    shell: false,
    detached: process.platform !== "win32",
    stdio: ["pipe", "pipe", "pipe"],
  });
  return new Promise<string>((resolve, reject) => {
    let output = "";
    let size = 0;
    let failure: string | null = null;
    let closed = false;
    let force: ReturnType<typeof setTimeout> | undefined;
    const kill = (name: NodeJS.Signals) => {
      if (closed) return;
      try {
        if (process.platform !== "win32" && child.pid) process.kill(-child.pid, name);
        else child.kill(name);
      } catch {
        /* close confirms actual release. */
      }
    };
    const stop = (code: string) => {
      if (failure) return;
      failure = code;
      kill("SIGTERM");
      force = setTimeout(() => kill("SIGKILL"), 250);
    };
    const abort = () => stop("COMMAND_CANCELLED");
    const deadline = setTimeout(() => stop("COMMAND_TIMEOUT"), options.timeoutMs);
    const budget = (bytes: number) => {
      size += bytes;
      if (size > 1024 * 1024) stop("COMMAND_LIMIT");
      return !failure;
    };
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      if (budget(Buffer.byteLength(chunk, "utf8"))) output += chunk;
    });
    child.stderr.on("data", (chunk: Buffer) => budget(chunk.length));
    child.on("error", () => stop("COMMAND_FAILED"));
    child.stdin.on("error", () => stop("COMMAND_FAILED"));
    child.on("close", (code) => {
      closed = true;
      clearTimeout(deadline);
      clearTimeout(force);
      options.signal.removeEventListener("abort", abort);
      if (failure || code !== 0 || options.signal.aborted)
        reject(new Error(failure ?? "COMMAND_FAILED"));
      else resolve(output);
    });
    options.signal.addEventListener("abort", abort, { once: true });
    if (options.signal.aborted) abort();
    else child.stdin.end(options.input ?? "");
  });
}
