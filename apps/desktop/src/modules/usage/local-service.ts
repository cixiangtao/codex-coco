import { readFile, mkdir, writeFile, rename, lstat, unlink } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve, isAbsolute } from "node:path";
import { randomUUID } from "node:crypto";
import { runWorkerTask, type WorkerFactory } from "../../application/worker-task";
import { localScanResultSchema, type TrendSnapshot } from "./contract";
import { z } from "zod";

export interface LocalUsageService {
  scan(
    signal: AbortSignal,
    report: (value: number) => void,
    input: { days: 7 | 14 | 30; scope: string | null; force: boolean },
  ): Promise<z.infer<typeof localScanResultSchema>>;
  chooseHome(): Promise<boolean>;
}
/** User-selected local directories are private service state, never public module configuration. */
export function createLocalUsageService(options: {
  createWorker: WorkerFactory;
  directory: string;
  chooseDirectory(): Promise<string | null>;
}): LocalUsageService {
  const choicePath = join(options.directory, "source.json");
  let cached: {
    home: string;
    scope: string | null;
    trend: TrendSnapshot;
    fallback: z.infer<typeof localScanResultSchema>["fallback"];
  } | null = null;
  async function home() {
    try {
      if ((await lstat(choicePath)).size > 8192) throw new Error("LOCAL_SOURCE_INVALID");
      const value = JSON.parse(await readFile(choicePath, "utf8")) as { home?: unknown };
      if (typeof value.home !== "string" || value.home.length > 4096 || !isAbsolute(value.home))
        throw new Error("LOCAL_SOURCE_INVALID");
      return value.home;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT")
        throw new Error("LOCAL_SOURCE_INVALID");
    }
    return resolve(process.env.CODEX_HOME || join(homedir(), ".codex"));
  }
  return {
    scan: async (signal, report, input) => {
      const directory = await home();
      signal.throwIfAborted();
      if (
        !input.force &&
        cached &&
        cached.home === directory &&
        cached.scope === input.scope &&
        cached.trend.days === input.days &&
        Date.now() - cached.trend.capturedAt < 600_000
      )
        return { trend: cached.trend, fallback: cached.fallback };
      const raw = await runWorkerTask(
        options.createWorker,
        {
          home: directory,
          cacheDirectory: join(options.directory, "index"),
          scope: input.scope,
          days: input.days,
          now: Date.now(),
          force: input.force,
        },
        { signal, report },
      );
      const result = localScanResultSchema.parse(raw);
      cached = { ...result, home: directory, scope: input.scope };
      return result;
    },
    chooseHome: async () => {
      const path = await options.chooseDirectory();
      if (!path) return false;
      await mkdir(options.directory, { recursive: true, mode: 0o700 });
      const temporary = `${choicePath}.${randomUUID()}.tmp`;
      try {
        await writeFile(temporary, JSON.stringify({ home: resolve(path) }), {
          mode: 0o600,
          flag: "wx",
        });
        await rename(temporary, choicePath);
      } finally {
        await unlink(temporary).catch(() => undefined);
      }
      cached = null;
      return true;
    },
  };
}
