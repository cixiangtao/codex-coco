import { afterEach, describe, expect, it, vi } from "vitest";
import {
  mkdtemp,
  mkdir,
  writeFile,
  appendFile,
  readFile,
  rm,
  copyFile,
  symlink,
  readdir,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { Worker } from "node:worker_threads";
import { scanLocalUsage } from "../apps/desktop/src/modules/usage/local-index";
import { localScanResultSchema } from "../apps/desktop/src/modules/usage/contract";
import { runWorkerTask } from "../apps/desktop/src/application/worker-task";
import { createLocalUsageService } from "../apps/desktop/src/modules/usage/local-service";

const directories: string[] = [];
const now = new Date("2026-10-21T12:00:00+08:00").getTime();
const stamp = (offset = 0) => new Date(now - 100_000 + offset).toISOString();
const meta = (id: string, parent?: string) =>
  JSON.stringify({
    type: "session_meta",
    payload: { id, forked_from_id: parent, cwd: "PRIVATE_PATH", title: "PRIVATE_PROMPT" },
  }) + "\n";
const event = (total: number, last: number, offset = 0, email?: string) =>
  JSON.stringify({
    type: "event_msg",
    timestamp: stamp(offset),
    payload: {
      type: "token_count",
      info: {
        total_token_usage: { total_tokens: total },
        last_token_usage: { total_tokens: last },
      },
      rate_limits: {
        email,
        limit_id: "codex",
        primary: { used_percent: 25, window_minutes: 300, resets_at: 2_000_000_000 },
      },
      privatePrompt: "PRIVATE_PROMPT",
    },
  }) + "\n";
async function fixture() {
  const home = await mkdtemp(join(tmpdir(), "codex-coco-local-"));
  directories.push(home);
  await mkdir(join(home, "sessions"));
  await mkdir(join(home, "archived_sessions"));
  const request = {
    home,
    cacheDirectory: join(home, "cache"),
    days: 7 as const,
    scope: null,
    now,
    force: false,
  };
  return { home, request, scan: () => scanLocalUsage(request) };
}
const total = (data: Awaited<ReturnType<typeof scanLocalUsage>>) =>
  data.trend.points.reduce((sum, point) => sum + point.tokens, 0);
afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("local usage counters and incremental indexing", () => {
  it("rejects a non-Codex directory without replacing the previous private choice", async () => {
    const f = await fixture();
    const invalid = join(f.home, "empty");
    await mkdir(invalid);
    let choice = f.home;
    const service = createLocalUsageService({
      createWorker: () => {
        throw new Error("Not used");
      },
      directory: join(f.home, "private-choice"),
      chooseDirectory: async () => choice,
    });
    await service.chooseHome();
    choice = invalid;
    await expect(service.chooseHome()).rejects.toThrow("LOCAL_SOURCE_INVALID");
    expect(await service.environment!()).toEqual({ CODEX_HOME: f.home });
  });
  it("expires the ten-minute cache at local midnight and retains a privately chosen source", async () => {
    const f = await fixture();
    await writeFile(join(f.home, "sessions/day.jsonl"), meta("day") + event(31, 31));
    vi.useFakeTimers({ toFake: ["Date"] });
    const midnight = new Date(now);
    midnight.setHours(24, 0, 0, 0);
    vi.setSystemTime(midnight.getTime() - 30_000);
    const createWorker = vi.fn(
      () =>
        new Worker(new URL("../apps/desktop/src/modules/usage/worker.ts", import.meta.url), {
          execArgv: [],
          stdout: true,
          stderr: true,
        }),
    );
    const service = createLocalUsageService({
      createWorker,
      directory: join(f.home, "private"),
      chooseDirectory: async () => f.home,
    });
    await service.chooseHome();
    expect(await service.environment!()).toEqual({ CODEX_HOME: f.home });
    const input = { days: 30 as const, scope: null, force: false };
    const first = await service.scan(new AbortController().signal, () => undefined, input);
    await service.scan(new AbortController().signal, () => undefined, input);
    expect(createWorker).toHaveBeenCalledTimes(1);
    expect(first.trend.points.at(-1)?.tokens).toBe(31);
    vi.setSystemTime(midnight.getTime() + 30_000);
    const next = await service.scan(new AbortController().signal, () => undefined, input);
    expect(createWorker).toHaveBeenCalledTimes(2);
    expect(next.trend.points.at(-1)?.tokens).toBe(0);
    expect(next.trend.points.at(-2)?.tokens).toBe(31);
  });
  it("counts model-specific token events without treating their quota as the general quota", async () => {
    const f = await fixture();
    await writeFile(
      join(f.home, "sessions/model.jsonl"),
      meta("model") + event(45, 45).replace('"limit_id":"codex"', '"limit_id":"codex_spark"'),
    );
    const result = await f.scan();
    expect(total(result)).toBe(45);
    expect(result.trend.source).toBe("session-events");
    expect(result.fallback).toBeNull();
  });
  it("deduplicates archive copies, repeated events and inherited fork prefixes", async () => {
    const f = await fixture();
    const parent = meta("parent") + event(100, 100) + event(160, 60, 1000);
    await writeFile(join(f.home, "sessions/parent.jsonl"), parent + event(160, 60, 1000));
    await copyFile(
      join(f.home, "sessions/parent.jsonl"),
      join(f.home, "archived_sessions/copy.jsonl"),
    );
    await writeFile(
      join(f.home, "sessions/fork.jsonl"),
      meta("child", "parent") +
        event(100, 100) +
        event(160, 60, 1000) +
        meta("parent") +
        event(220, 60, 2000),
    );
    const result = await f.scan();
    expect(total(result)).toBe(220);
    expect(result.trend.source).toBe("session-events");
    expect(result.fallback?.source).toBe("local-session");
    const second = await f.scan();
    expect(second.trend.reusedFiles).toBe(3);
    expect(total(second)).toBe(220);
    const cache = (await readdir(f.request.cacheDirectory))[0]!;
    const serialized = await readFile(join(f.request.cacheDirectory, cache), "utf8");
    expect(serialized).not.toMatch(/PRIVATE|privatePrompt|cwd|title|email/);
    expect(JSON.stringify(result)).not.toMatch(/PRIVATE|parent|child|\.jsonl|home|email/);
  });
  it("commits only complete lines, reads appended bytes and rebuilds truncations and rewrites", async () => {
    const f = await fixture();
    const path = join(f.home, "sessions/one.jsonl");
    const pending = event(150, 50, 1000);
    await writeFile(path, meta("one") + event(100, 100) + pending.slice(0, -5));
    expect(total(await f.scan())).toBe(100);
    await appendFile(path, pending.slice(-5));
    expect(total(await f.scan())).toBe(150);
    await appendFile(path, event(190, 40, 2000));
    expect(total(await f.scan())).toBe(190);
    await writeFile(path, meta("one") + event(3, 3));
    expect(total(await f.scan())).toBe(3);
    await writeFile(path, meta("one") + event(9, 9) + " ".repeat(20));
    expect(total(await f.scan())).toBe(9);
  });
  it("uses last tokens for the initial cumulative event, handles counter resets and filters known other accounts", async () => {
    const f = await fixture();
    await writeFile(
      join(f.home, "sessions/one.jsonl"),
      meta("one") +
        event(1000, 5, 0, "a@example.test") +
        event(1100, 100, 1000) +
        event(1200, 100, 2000, "b@example.test") +
        event(4, 4, 3000),
    );
    const scope = createHash("sha256").update("a@example.test").digest("hex");
    const result = await scanLocalUsage({ ...f.request, scope });
    expect(total(result)).toBe(109);
    expect(result.trend.unassignedTokens).toBe(104);
    expect(result.trend.scope).toBe("current-account-and-unassigned");
  });
  it("skips malformed and oversized records without retaining content and never follows symlinked files", async () => {
    const f = await fixture();
    await writeFile(
      join(f.home, "sessions/one.jsonl"),
      "not json\n" +
        JSON.stringify({ type: "response_item", content: "PRIVATE_PROMPT" }) +
        "\n" +
        "x".repeat(1024 * 1024 + 10) +
        "\n" +
        meta("one") +
        event(7, 7),
    );
    await writeFile(join(f.home, "outside.jsonl"), meta("outside") + event(500, 500));
    await symlink(join(f.home, "outside.jsonl"), join(f.home, "sessions/link.jsonl"));
    const result = await f.scan();
    expect(total(result)).toBe(7);
    expect(result.trend.limited).toBe(true);
    expect(result.trend.scannedFiles).toBe(1);
  });
  it("falls back to read-only SQLite thread totals and does not add them to JSONL events", async () => {
    const f = await fixture();
    const path = join(f.home, "state_5.sqlite");
    const db = new DatabaseSync(path);
    db.exec("CREATE TABLE threads (created_at INTEGER, tokens_used INTEGER)");
    db.prepare("INSERT INTO threads VALUES (?, ?)").run(Math.floor(now / 1000) - 10, 123);
    db.close();
    const before = await readFile(path);
    const fallback = await f.scan();
    expect(total(fallback)).toBe(123);
    expect(fallback.trend.source).toBe("thread-totals");
    expect(await readFile(path)).toEqual(before);
    await writeFile(join(f.home, "sessions/events.jsonl"), meta("one") + event(9, 9));
    const events = await f.scan();
    expect(total(events)).toBe(9);
    expect(events.trend.source).toBe("session-events");
  });
  it("runs the actual worker source through the bounded worker transport", async () => {
    const f = await fixture();
    await writeFile(join(f.home, "sessions/one.jsonl"), meta("one") + event(21, 21));
    let worker: Worker | undefined;
    const result = await runWorkerTask(
      () => {
        worker = new Worker(
          new URL("../apps/desktop/src/modules/usage/worker.ts", import.meta.url),
          { execArgv: [], stdout: true, stderr: true },
        );
        return worker;
      },
      f.request,
      { signal: new AbortController().signal, report: () => undefined },
    );
    expect(total(localScanResultSchema.parse(result))).toBe(21);
    expect(worker?.threadId).toBe(-1);
  });
});
