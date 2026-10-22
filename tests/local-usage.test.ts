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
const turn = (id: string) =>
  JSON.stringify({ type: "turn_context", payload: { turn_id: id, cwd: "PRIVATE_PATH" } }) + "\n";
const requestEvent = (owner: string, turn: string, response: string, tokens: number, offset = 0) =>
  JSON.stringify({
    type: "token_usage_record",
    timestamp: stamp(offset),
    payload: {
      thread_id: owner,
      turn_id: turn,
      response_id: response,
      usage: {
        total_tokens: tokens,
        input_tokens: tokens - 2,
        cached_input_tokens: 1,
        output_tokens: 2,
        reasoning_output_tokens: 1,
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
  it("merges shorter continuation files and keeps daily totals stable as each segment grows", async () => {
    const f = await fixture();
    const original = join(f.home, "sessions/z-original.jsonl");
    const continuation = join(f.home, "sessions/a-continuation.jsonl");
    await writeFile(
      original,
      meta("continued") +
        event(10_000_000, 10_000_000, -86_400_000) +
        event(20_000_000, 10_000_000, -86_399_000) +
        event(30_000_000, 10_000_000, -86_398_000),
    );
    await writeFile(continuation, meta("continued") + event(430_000_000, 400_000_000));
    const first = await f.scan();
    expect(total(first)).toBe(430_000_000);
    expect(first.trend.points.at(-2)?.tokens).toBe(30_000_000);
    expect(first.trend.points.at(-1)?.tokens).toBe(400_000_000);
    expect(total(await f.scan())).toBe(430_000_000);
    await appendFile(continuation, event(440_000_000, 10_000_000, 1000));
    expect(total(await f.scan())).toBe(440_000_000);
    await appendFile(continuation, event(450_000_000, 10_000_000, 2000));
    await appendFile(continuation, event(460_000_000, 10_000_000, 3000));
    expect(total(await f.scan())).toBe(460_000_000);
    expect(total(await scanLocalUsage({ ...f.request, force: true }))).toBe(460_000_000);
  });
  it("deduplicates overlapping segments, rate-limit repeats and fork prefixes after merging", async () => {
    const f = await fixture();
    const prefix = event(100, 100) + event(160, 60, 1000);
    await writeFile(join(f.home, "sessions/a.jsonl"), meta("parent") + prefix);
    await writeFile(
      join(f.home, "sessions/b.jsonl"),
      meta("parent") + event(160, 60, 1000) + event(220, 60, 2000) + event(220, 60, 2500),
    );
    await copyFile(join(f.home, "sessions/b.jsonl"), join(f.home, "archived_sessions/copy.jsonl"));
    await writeFile(
      join(f.home, "sessions/child.jsonl"),
      meta("child", "parent") +
        prefix +
        event(220, 60, 2000) +
        event(220, 60, 2500) +
        event(280, 60, 3000),
    );
    expect(total(await f.scan())).toBe(280);
    expect(total(await f.scan())).toBe(280);
  });
  it("retains the baseline before the indexing window without attributing it to a recent day", async () => {
    const f = await fixture();
    await writeFile(
      join(f.home, "sessions/original.jsonl"),
      meta("continued") + event(1000, 1000, -32 * 86_400_000) + event(1100, 100, -86_400_000),
    );
    await writeFile(
      join(f.home, "sessions/continuation.jsonl"),
      meta("continued") + event(1100, 100, -86_400_000) + event(1200, 100),
    );
    const result = await f.scan();
    expect(total(result)).toBe(200);
    expect(result.trend.points.at(-2)?.tokens).toBe(100);
    expect(result.trend.points.at(-1)?.tokens).toBe(100);
    expect(total(await f.scan())).toBe(200);
  });
  it("preserves a zero initial last count and rebuilds the previous index version", async () => {
    const f = await fixture();
    await writeFile(
      join(f.home, "sessions/one.jsonl"),
      meta("one") + event(1000, 0) + event(1050, 50, 1000),
    );
    expect(total(await f.scan())).toBe(50);
    const cache = join(f.request.cacheDirectory, (await readdir(f.request.cacheDirectory))[0]!);
    const old = JSON.parse(await readFile(cache, "utf8"));
    old.version = 2;
    for (const file of Object.values(old.files) as { records: { delta: number }[] }[])
      for (const token of file.records) token.delta = 9999;
    await writeFile(cache, JSON.stringify(old));
    const rebuilt = await f.scan();
    expect(total(rebuilt)).toBe(50);
    expect(rebuilt.trend.reusedFiles).toBe(0);
    expect((await f.scan()).trend.reusedFiles).toBe(1);
  });
  it("prefers owned request records per turn, keeps legacy turns and deduplicates response copies", async () => {
    const f = await fixture();
    await writeFile(
      join(f.home, "sessions/legacy.jsonl"),
      meta("one") + turn("legacy") + event(100, 100),
    );
    const modern =
      meta("one") +
      turn("modern") +
      event(160, 60, 1000) +
      requestEvent("one", "modern", "PRIVATE_RESPONSE_A", 60, 1000) +
      requestEvent("one", "modern", "PRIVATE_RESPONSE_B", 30, 2000) +
      event(190, 30, 2000) +
      requestEvent("one", "modern", "PRIVATE_RESPONSE_B", 30, 3000) +
      requestEvent("one", "modern", "PRIVATE_RESPONSE_C", 10, 4000);
    await writeFile(join(f.home, "sessions/modern.jsonl"), modern);
    await writeFile(join(f.home, "archived_sessions/copy.jsonl"), modern);
    const result = await f.scan();
    expect(total(result)).toBe(200);
    expect(result.trend.source).toBe("session-events");
    expect(total(await f.scan())).toBe(200);
    expect(JSON.stringify(result)).not.toMatch(/PRIVATE|RESPONSE|\.jsonl/);
    const cache = (await readdir(f.request.cacheDirectory))[0]!;
    expect(await readFile(join(f.request.cacheDirectory, cache), "utf8")).not.toMatch(
      /PRIVATE|RESPONSE|privatePrompt|cwd/,
    );
  });
  it("counts request-only turns and excludes inherited parent requests in fork copies", async () => {
    const f = await fixture();
    const inherited = requestEvent("parent", "parent-turn", "parent-response", 100);
    await writeFile(join(f.home, "sessions/parent.jsonl"), meta("parent") + inherited);
    await writeFile(
      join(f.home, "sessions/child.jsonl"),
      meta("child", "parent") +
        inherited +
        requestEvent("child", "child-turn", "child-response", 20, 1000),
    );
    expect(total(await f.scan())).toBe(120);
    expect(total(await f.scan())).toBe(120);
  });
  it("replaces legacy mirrors after appends and attributes requests to their own local day", async () => {
    const f = await fixture();
    const path = join(f.home, "sessions/one.jsonl");
    await writeFile(path, meta("one") + turn("active") + event(100, 100));
    expect(total(await f.scan())).toBe(100);
    await appendFile(path, requestEvent("one", "active", "response-a", 70, -86_400_000));
    await appendFile(path, requestEvent("one", "active", "response-b", 30));
    const result = await f.scan();
    expect(total(result)).toBe(100);
    expect(result.trend.points.at(-2)?.tokens).toBe(70);
    expect(result.trend.points.at(-1)?.tokens).toBe(30);
    await appendFile(
      path,
      requestEvent("one", "active", "response-c", 60, 1000) + event(160, 60, 1000),
    );
    expect(total(await f.scan())).toBe(160);
    expect(total(await scanLocalUsage({ ...f.request, force: true }))).toBe(160);
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
