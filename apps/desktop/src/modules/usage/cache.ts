import { constants } from "node:fs";
import { open, mkdir, writeFile, rename, unlink } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { dirname, resolve } from "node:path";
import { homedir } from "node:os";
import { z } from "zod";
import { usageSnapshotSchema, type UsageSnapshot } from "./contract";

const digest = z.string().regex(/^[a-f0-9]{64}$/);
const recordSchema = z.strictObject({
  version: z.literal(1),
  source: digest,
  scope: digest.nullable(),
  data: usageSnapshotSchema,
});
type Record = z.infer<typeof recordSchema>;
export interface UsageCache {
  load(): Promise<Pick<Record, "data" | "scope"> | null>;
  save(data: UsageSnapshot, scope: string | null): Promise<void>;
  clear(): Promise<void>;
}

/** Only successful public quota fields survive restart; no tokens, tools, reset references or paths. */
export function createUsageCache(
  file: string,
  options: { environment(): Promise<NodeJS.ProcessEnv> },
): UsageCache {
  const limit = 256 * 1024;
  async function source() {
    const environment = await options.environment();
    return createHash("sha256")
      .update(resolve(environment.CODEX_HOME || resolve(homedir(), ".codex")))
      .digest("hex");
  }
  return {
    async load() {
      try {
        const handle = await open(
          file,
          constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
        );
        let contents: string;
        try {
          const stat = await handle.stat();
          if (!stat.isFile() || stat.size > limit) return null;
          const buffer = Buffer.alloc(limit + 1);
          const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
          if (bytesRead > limit) return null;
          contents = buffer.subarray(0, bytesRead).toString("utf8");
        } finally {
          await handle.close();
        }
        const record = recordSchema.parse(JSON.parse(contents));
        const age = Date.now() - record.data.capturedAt;
        if (
          record.source !== (await source()) ||
          age < 0 ||
          age > 7 * 86_400_000 ||
          record.data.source !== "codex-app-server" ||
          record.data.resetCredits !== null
        )
          return null;
        return { data: record.data, scope: record.scope };
      } catch {
        return null;
      }
    },
    async save(data, scope) {
      // Explicit whitelist: tool answers, redemption IDs and credentials never enter this file.
      const sanitized = usageSnapshotSchema.safeParse({
        account: data.account,
        credits: data.credits,
        capturedAt: data.capturedAt,
        source: data.source,
        buckets: data.buckets,
        resetCredits: null,
      });
      if (!sanitized.success || sanitized.data.source !== "codex-app-server") {
        await unlink(file).catch(() => undefined);
        return;
      }
      const record = recordSchema.parse({
        version: 1,
        source: await source(),
        scope,
        data: sanitized.data,
      });
      const contents = JSON.stringify(record);
      if (Buffer.byteLength(contents) > limit) return;
      await mkdir(dirname(file), { recursive: true, mode: 0o700 });
      const temporary = `${file}.${randomUUID()}.tmp`;
      try {
        await writeFile(temporary, contents, { mode: 0o600, flag: "wx" });
        await rename(temporary, file);
      } finally {
        await unlink(temporary).catch(() => undefined);
      }
    },
    async clear() {
      await unlink(file).catch(() => undefined);
    },
  };
}
