import { createHash, randomUUID } from "node:crypto";
import { mkdir, readdir, lstat, open, rename, writeFile, unlink } from "node:fs/promises";
import { join, dirname, isAbsolute } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import {
  localScanResultSchema,
  usageSnapshotSchema,
  type UsageSnapshot,
  type TrendSnapshot,
} from "./contract.ts";

const MAX_FILES = 20_000;
const MAX_RECORDS = 200_000;
const MAX_LINE = 1024 * 1024;
const MAX_CACHE = 32 * 1024 * 1024;
const hash = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
const record = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const count = (value: unknown) =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
const text = (value: unknown) => (typeof value === "string" && value.length <= 300 ? value : null);
const tokenSchema = z.strictObject({
  t: z.number(),
  c: z.number().nullable(),
  last: z.number(),
  delta: z.number(),
  fp: z.string(),
  scope: z.string().nullable(),
});
const entrySchema = z.strictObject({
  identity: z.string(),
  size: z.number(),
  mtime: z.number(),
  offset: z.number(),
  boundary: z.string(),
  head: z.string(),
  session: z.string().nullable(),
  parent: z.string().nullable(),
  cumulative: z.number().nullable(),
  fingerprint: z.string().nullable(),
  records: z.array(tokenSchema).max(MAX_RECORDS),
  latest: z.strictObject({ scope: z.string().nullable(), data: usageSnapshotSchema }).nullable(),
  limited: z.boolean(),
});
type Entry = z.infer<typeof entrySchema>;
const cacheSchema = z.strictObject({
  version: z.literal(1),
  home: z.string(),
  files: z.record(z.string(), entrySchema),
});
export const localScanRequestSchema = z.strictObject({
  home: z.string().max(4096),
  cacheDirectory: z.string().max(4096),
  days: z.union([z.literal(7), z.literal(14), z.literal(30)]),
  scope: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .nullable(),
  now: z.number().int().nonnegative(),
  force: z.boolean(),
});
export type LocalScanRequest = z.infer<typeof localScanRequestSchema>;

async function boundedFile(path: string, maximum: number) {
  const handle = await open(path, "r");
  try {
    const metadata = await handle.stat();
    if (!metadata.isFile() || metadata.size > maximum) throw new Error("LIMIT");
    const bytes = Buffer.alloc(metadata.size + 1);
    const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0);
    if (bytesRead > maximum) throw new Error("LIMIT");
    return bytes.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}
async function boundary(handle: Awaited<ReturnType<typeof open>>, offset: number) {
  const length = Math.min(offset, 4096);
  const bytes = Buffer.alloc(length);
  await handle.read(bytes, 0, length, offset - length);
  return hash(bytes);
}
async function head(handle: Awaited<ReturnType<typeof open>>, offset: number) {
  const length = Math.min(offset, 4096);
  const bytes = Buffer.alloc(length);
  await handle.read(bytes, 0, length, 0);
  return hash(bytes);
}
function accountScope(...objects: Record<string, unknown>[]) {
  for (const object of objects)
    for (const key of [
      "email",
      "user_email",
      "userEmail",
      "phone_number",
      "phoneNumber",
      "phone",
    ]) {
      const value = text(object[key]);
      if (value?.trim()) return hash(value.trim().toLowerCase());
    }
  return null;
}
function quota(raw: Record<string, unknown>, capturedAt: number): UsageSnapshot | null {
  const windows = (["primary", "secondary"] as const).flatMap((kind) => {
    const value = record(raw[kind]);
    const used = value.used_percent;
    const minutes = value.window_minutes;
    const reset = value.resets_at;
    if (typeof used !== "number" || !Number.isFinite(used) || used < 0) return [];
    return [
      {
        kind,
        usedPercent: used,
        windowMinutes: count(minutes) && Number(minutes) > 0 ? Number(minutes) : null,
        resetsAt: count(reset),
      },
    ];
  });
  if (!windows.length) return null;
  const parsed = usageSnapshotSchema.safeParse({
    capturedAt,
    source: "local-session",
    buckets: [{ id: "codex", windows }],
  });
  return parsed.success ? parsed.data : null;
}
function consumeLine(line: Buffer, entry: Entry, minimumTimestamp: number) {
  if (!line.includes('"token_count"') && !line.includes('"session_meta"')) return;
  let root: Record<string, unknown>;
  try {
    root = record(JSON.parse(line.toString("utf8")));
  } catch {
    return;
  }
  const payload = record(root.payload);
  if (root.type === "session_meta" && entry.session === null) {
    entry.session = text(payload.id) ?? text(payload.session_id);
    entry.parent = text(payload.forked_from_id) ?? text(payload.parent_thread_id);
    return;
  }
  if (root.type !== "event_msg" || payload.type !== "token_count") return;
  const timestamp = typeof root.timestamp === "string" ? Date.parse(root.timestamp) : NaN;
  if (!Number.isFinite(timestamp) || timestamp < 0) return;
  const info = record(payload.info);
  const rates = record(payload.rate_limits);
  if (typeof rates.limit_id === "string" && rates.limit_id !== "codex") return;
  const scope = accountScope(rates, payload, info);
  const local = quota(rates, timestamp);
  if (local && (!entry.latest || entry.latest.data.capturedAt <= timestamp))
    entry.latest = { scope, data: local };
  const c = count(record(info.total_token_usage).total_tokens);
  const last = count(record(info.last_token_usage).total_tokens) ?? 0;
  if (c === null && last === 0) return;
  const fp = hash(`${timestamp}|${c}|${last}`);
  if (fp === entry.fingerprint) return;
  const delta =
    c === null
      ? last
      : entry.cumulative === null
        ? last || c
        : c >= entry.cumulative
          ? c - entry.cumulative
          : last;
  if (c !== null) entry.cumulative = c;
  entry.fingerprint = fp;
  if (timestamp < minimumTimestamp) return;
  if (entry.records.length >= MAX_RECORDS) {
    entry.limited = true;
    return;
  }
  entry.records.push({ t: timestamp, c, last, delta, fp, scope });
}
async function scanFile(path: string, existing: Entry | undefined, minimumTimestamp: number) {
  const handle = await open(path, "r");
  try {
    const info = await handle.stat();
    const identity = `${info.dev}:${info.ino}`;
    let entry: Entry;
    const reusable =
      existing &&
      existing.identity === identity &&
      existing.offset <= info.size &&
      existing.boundary === (await boundary(handle, existing.offset)) &&
      existing.head === (await head(handle, existing.offset)) &&
      (existing.size !== info.size || existing.mtime === info.mtimeMs);
    if (reusable) entry = structuredClone(existing);
    else
      entry = {
        identity,
        size: info.size,
        mtime: info.mtimeMs,
        offset: 0,
        boundary: hash(Buffer.alloc(0)),
        head: hash(Buffer.alloc(0)),
        session: null,
        parent: null,
        cumulative: null,
        fingerprint: null,
        records: [],
        latest: null,
        limited: false,
      };
    entry.records = entry.records.filter((token) => token.t >= minimumTimestamp);
    if (reusable && entry.size === info.size && entry.mtime === info.mtimeMs)
      return { entry, reused: true };
    let position = entry.offset;
    let pending = Buffer.alloc(0);
    let skipping = false;
    const chunk = Buffer.alloc(256 * 1024);
    while (position < info.size) {
      const { bytesRead } = await handle.read(
        chunk,
        0,
        Math.min(chunk.length, info.size - position),
        position,
      );
      if (!bytesRead) break;
      const bytes = chunk.subarray(0, bytesRead);
      let begin = 0;
      for (let index = 0; index < bytes.length; index++)
        if (bytes[index] === 10) {
          if (!skipping) {
            const line = Buffer.concat([pending, bytes.subarray(begin, index)]);
            if (line.length <= MAX_LINE) consumeLine(line, entry, minimumTimestamp);
            else entry.limited = true;
          }
          entry.offset = position + index + 1;
          pending = Buffer.alloc(0);
          skipping = false;
          begin = index + 1;
        }
      if (!skipping) {
        pending = Buffer.concat([pending, bytes.subarray(begin)]);
        if (pending.length > MAX_LINE) {
          pending = Buffer.alloc(0);
          skipping = true;
          entry.limited = true;
        }
      }
      position += bytesRead;
    }
    const after = await handle.stat();
    if (`${after.dev}:${after.ino}` !== identity || after.size < info.size)
      throw new Error("CHANGED");
    entry.size = info.size;
    entry.mtime = info.mtimeMs;
    entry.boundary = await boundary(handle, entry.offset);
    entry.head = await head(handle, entry.offset);
    return { entry, reused: false };
  } finally {
    await handle.close();
  }
}
/** Indexes only structured counters. No message, prompt, title or raw account content is retained. */
export async function scanLocalUsage(
  input: LocalScanRequest,
  report: (progress: number) => void = () => undefined,
) {
  const request = localScanRequestSchema.parse(input);
  if (!isAbsolute(request.home) || !isAbsolute(request.cacheDirectory))
    throw new Error("LOCAL_INVALID");
  const cachePath = join(request.cacheDirectory, `${hash(request.home)}.json`);
  // A killed worker can leave one atomic-write temporary file; only remove our own exact names.
  try {
    for (const file of await readdir(request.cacheDirectory))
      if (/^[a-f0-9]{64}\.json\.[a-f0-9-]{36}\.tmp$/.test(file))
        await unlink(join(request.cacheDirectory, file));
  } catch {
    /* An absent cache is rebuilt. */
  }
  let old: Record<string, Entry> = {};
  if (!request.force)
    try {
      const parsed = cacheSchema.parse(
        JSON.parse((await boundedFile(cachePath, MAX_CACHE)).toString()),
      );
      if (parsed.home === hash(request.home)) old = parsed.files;
    } catch {
      /* Rebuild an absent, damaged or stale index. */
    }
  const paths: string[] = [];
  let limited = false;
  let skipped = 0;
  async function walk(directory: string, depth: number) {
    if (depth > 12) {
      limited = true;
      return;
    }
    let entries;
    try {
      if (!(await lstat(directory)).isDirectory()) return;
      entries = await readdir(directory, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        limited = true;
        skipped++;
      }
      return;
    }
    for (const entry of entries) {
      if (paths.length >= MAX_FILES) {
        limited = true;
        return;
      }
      if (entry.isSymbolicLink()) continue;
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await walk(path, depth + 1);
      else if (entry.isFile() && entry.name.endsWith(".jsonl")) paths.push(path);
    }
  }
  await walk(join(request.home, "sessions"), 0);
  await walk(join(request.home, "archived_sessions"), 0);
  const next: Record<string, Entry> = {};
  let scannedFiles = 0;
  let reusedFiles = 0;
  let totalRecords = 0;
  for (const path of paths) {
    if (totalRecords >= MAX_RECORDS) {
      limited = true;
      break;
    }
    const key = hash(path);
    try {
      const scan = await scanFile(path, old[key], request.now - 31 * 86_400_000);
      next[key] = scan.entry;
      totalRecords += scan.entry.records.length;
      scannedFiles++;
      if (scan.reused) reusedFiles++;
      limited ||= scan.entry.limited;
    } catch {
      limited = true;
      skipped++;
    }
    report(Math.round((scannedFiles / Math.max(1, paths.length)) * 85));
  }
  const sessions = new Map<string, Entry>();
  for (const [key, entry] of Object.entries(next)) {
    const session = entry.session ?? key;
    const previous = sessions.get(session);
    if (!previous || previous.records.length < entry.records.length) sessions.set(session, entry);
  }
  const points = new Map<string, number>();
  const start = new Date(request.now);
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - request.days + 1);
  for (let offset = 0; offset < request.days; offset++) {
    const day = new Date(start);
    day.setDate(day.getDate() + offset);
    points.set(localDay(day), 0);
  }
  let unassignedTokens = 0;
  let sawEvents = false;
  let fallback: UsageSnapshot | null = null;
  for (const entry of sessions.values()) {
    const parent = entry.parent ? sessions.get(entry.parent) : undefined;
    let prefix = 0;
    if (parent)
      while (
        prefix < Math.min(parent.records.length, entry.records.length) &&
        parent.records[prefix]!.fp === entry.records[prefix]!.fp
      )
        prefix++;
    const seen = new Set<string>();
    for (const token of entry.records.slice(prefix)) {
      if (seen.has(token.fp)) continue;
      seen.add(token.fp);
      if (token.t > request.now || (request.scope && token.scope && request.scope !== token.scope))
        continue;
      const day = localDay(new Date(token.t));
      if (!points.has(day)) continue;
      sawEvents = true;
      const nextTotal = points.get(day)! + token.delta;
      if (!Number.isSafeInteger(nextTotal)) {
        limited = true;
        continue;
      }
      points.set(day, nextTotal);
      if (!token.scope) unassignedTokens += token.delta;
    }
    if (
      entry.latest &&
      entry.latest.data.capturedAt <= request.now &&
      (!request.scope || !entry.latest.scope || entry.latest.scope === request.scope) &&
      (!fallback || fallback.capturedAt < entry.latest.data.capturedAt)
    )
      fallback = entry.latest.data;
  }
  let source: TrendSnapshot["source"] = sawEvents ? "session-events" : "none";
  if (!sawEvents) {
    try {
      const path = join(request.home, "state_5.sqlite");
      if ((await lstat(path)).isFile()) {
        const database = new DatabaseSync(path, {
          readOnly: true,
          allowExtension: false,
          timeout: 1000,
        });
        try {
          database.exec("PRAGMA query_only=ON; PRAGMA trusted_schema=OFF;");
          const rows = database
            .prepare(
              "SELECT created_at, tokens_used FROM threads WHERE created_at >= ? AND tokens_used > 0 LIMIT 200001",
            )
            .all(Math.floor(start.getTime() / 1000));
          if (rows.length > MAX_RECORDS) limited = true;
          for (const row of rows.slice(0, MAX_RECORDS)) {
            const stamp = count(row.created_at);
            const tokens = count(row.tokens_used);
            if (stamp === null || tokens === null || stamp * 1000 > request.now) continue;
            const day = localDay(new Date(stamp * 1000));
            if (points.has(day)) {
              const total = points.get(day)! + tokens;
              if (Number.isSafeInteger(total)) {
                points.set(day, total);
                unassignedTokens += tokens;
                source = "thread-totals";
              } else limited = true;
            }
          }
        } finally {
          database.close();
        }
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") limited = true;
    }
  }
  const bytes = JSON.stringify({ version: 1, home: hash(request.home), files: next });
  if (Buffer.byteLength(bytes) <= MAX_CACHE) {
    const temporary = `${cachePath}.${randomUUID()}.tmp`;
    try {
      await mkdir(dirname(cachePath), { recursive: true, mode: 0o700 });
      await writeFile(temporary, bytes, { mode: 0o600, flag: "wx" });
      await rename(temporary, cachePath);
    } catch {
      limited = true;
    } finally {
      await unlink(temporary).catch(() => undefined);
    }
  } else limited = true;
  report(100);
  return localScanResultSchema.parse({
    trend: {
      capturedAt: request.now,
      days: request.days,
      source,
      scope: request.scope ? "current-account-and-unassigned" : "all-local-unassigned",
      points: [...points].map(([day, tokens]) => ({ day, tokens })),
      unassignedTokens,
      limited: limited || skipped > 0,
      scannedFiles,
      reusedFiles,
    },
    fallback,
  });
}
function localDay(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
