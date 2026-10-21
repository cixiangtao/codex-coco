import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { createUsageReader } from "../apps/desktop/src/modules/usage/app-server";
import { normalizeUsage, UsageReadError } from "../apps/desktop/src/modules/usage/normalize";
import { createUsageModule } from "../apps/desktop/src/modules/usage/runtime";
import {
  usageResultSchema,
  usageWindowTitle,
  remainingPercent,
} from "../apps/desktop/src/modules/usage/contract";
import { ModuleHost } from "../apps/desktop/src/application/module-host";
import { buildGlanceItems } from "../apps/desktop/src/application/glance";

const directories: string[] = [];
async function directory() {
  const path = await mkdtemp(join(tmpdir(), "codex-coco-usage-"));
  directories.push(path);
  return path;
}
const server = fileURLToPath(new URL("./fixtures/usage-server.mjs", import.meta.url));
const raw = {
  rateLimitsByLimitId: {
    codex: {
      primary: { usedPercent: 25, windowDurationMins: 300, resetsAt: 2_000_000_000 },
      secondary: null,
    },
  },
};
async function source(mode = "ready", timeoutMs = 1000) {
  const trace = join(await directory(), "trace.jsonl");
  return {
    trace,
    read: createUsageReader({
      command: process.execPath,
      args: [server],
      timeoutMs,
      env: { ...process.env, FAKE_USAGE_MODE: mode, FAKE_USAGE_TRACE: trace },
    }),
  };
}
async function events(path: string): Promise<{ method: string; pid: number }[]> {
  try {
    return (await readFile(path, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
  } catch {
    return [];
  }
}
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("public usage normalization", () => {
  it("prefers mapped buckets, preserves window semantics and discards all account and token fields", () => {
    const data = normalizeUsage(
      {
        ...raw,
        rateLimits: { primary: { usedPercent: 99 } },
        email: "private@example.com",
        token: "private-token",
      },
      123,
    );
    expect(data.buckets[0]!.windows[0]).toEqual({
      kind: "primary",
      usedPercent: 25,
      windowMinutes: 300,
      resetsAt: 2_000_000_000,
    });
    expect(JSON.stringify(data)).not.toMatch(/private|email|token/);
    expect(usageWindowTitle(data.buckets[0]!.windows[0]!)).toBe("5 小时窗口");
    const unknown = normalizeUsage({ rateLimits: { secondary: { usedPercent: 0 } } }, 123);
    expect(unknown.buckets[0]!.windows[0]).toMatchObject({
      usedPercent: 0,
      windowMinutes: null,
      resetsAt: null,
    });
    expect(usageWindowTitle(unknown.buckets[0]!.windows[0]!)).toContain("时长未知");
    expect(normalizeUsage({ ...raw, rateLimits: { primary: "ignored legacy" } }, 123)).toEqual(
      data,
    );
    const over = normalizeUsage(
      { rateLimits: { limitId: "extra", primary: { usedPercent: 101 } } },
      123,
    );
    expect(over.buckets[0]!.id).toBe("extra");
    expect(remainingPercent(over.buckets[0]!.windows[0]!.usedPercent)).toBe(0);
  });
  it("does not substitute missing data or fall back from an authoritative empty map", () => {
    expect(() =>
      normalizeUsage({ rateLimits: { primary: { usedPercent: 99 } }, rateLimitsByLimitId: {} }, 1),
    ).toThrow("NO_LIMITS");
    expect(() => normalizeUsage({ rateLimits: null }, 1)).toThrow("NO_LIMITS");
    for (const usedPercent of [-1, NaN, "25"])
      expect(() => normalizeUsage({ rateLimits: { primary: { usedPercent } } }, 1)).toThrow(
        "INVALID_RESPONSE",
      );
  });
});

describe("read-only App Server connection", () => {
  it("handshakes, reads the current account and quota only, drains stderr, and exits before returning", async () => {
    const { read, trace } = await source();
    const data = normalizeUsage(await read(new AbortController().signal), Date.now());
    expect(data.buckets[0]!.windows).toHaveLength(2);
    const log = await events(trace);
    expect(log.map((item) => item.method)).toEqual([
      "spawn",
      "initialize",
      "initialized",
      "account/read",
      "account/rateLimits/read",
    ]);
    expect(() => process.kill(log[0]!.pid, 0)).toThrow();
    expect(JSON.stringify(data)).not.toMatch(/private|accessToken|email/);
  });
  it.each([
    ["signed-out", "NOT_SIGNED_IN"],
    ["api-key", "UNSUPPORTED_ACCOUNT"],
    ["unsupported", "UNSUPPORTED_CLI"],
    ["error", "READ_FAILED"],
    ["exit", "CLI_FAILED"],
    ["malformed", "INVALID_RESPONSE"],
    ["oversized", "INVALID_RESPONSE"],
    ["hang", "READ_TIMEOUT"],
  ])("returns fixed failure for %s and confirms child cleanup", async (mode, code) => {
    // Budget process startup under concurrent test load as well as the hung response.
    const { read, trace } = await source(mode, 2000);
    const error = await read(new AbortController().signal).catch((value: unknown) => value);
    expect(error).toMatchObject({ code });
    expect(String(error)).not.toContain("private");
    const log = await events(trace);
    expect(log.length).toBeGreaterThan(0);
    expect(() => process.kill(log[0]!.pid, 0)).toThrow();
  });
  it("reports a missing executable without returning its path", async () => {
    await expect(
      createUsageReader({ command: join(await directory(), "missing") })(
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ code: "CLI_NOT_FOUND" });
  });
  it("terminates a child that ignores SIGTERM, and cancels a pending read", async () => {
    const stubborn = await source("ignore-term");
    await stubborn.read(new AbortController().signal);
    const log = await events(stubborn.trace);
    expect(log.some((item) => item.method === "term")).toBe(true);
    expect(() => process.kill(log[0]!.pid, 0)).toThrow();
    const { read, trace } = await source("hang", 2000);
    const controller = new AbortController();
    const pending = read(controller.signal);
    const rejected = expect(pending).rejects.toMatchObject({ code: "READ_FAILED" });
    await expect
      .poll(async () =>
        (await events(trace)).some((item) => item.method === "account/rateLimits/read"),
      )
      .toBe(true);
    controller.abort();
    await rejected;
    const cancelledPid = (await events(trace))[0]!.pid;
    expect(() => process.kill(cancelledPid, 0)).toThrow();
    const before = (await events(trace)).length;
    await expect(read(controller.signal)).rejects.toThrow();
    expect((await events(trace)).length).toBe(before);
  });
});

describe("usage module and glance projection", () => {
  it("does not read on enable or restart, handles recoverable errors and hides old quotas from glance", async () => {
    let calls = 0;
    const definition = createUsageModule(async () => {
      if (++calls === 2) throw new UsageReadError("READ_FAILED");
      return raw;
    });
    const path = await directory();
    const host = new ModuleHost([definition], path);
    try {
      await host.load();
      await host.setEnabled({ moduleId: "usage", enabled: true });
      expect(calls).toBe(0);
      const run = () => host.run({ moduleId: "usage", operation: "refresh", input: {} });
      const result = () => usageResultSchema.parse(host.snapshots()[0]!.operation?.result);
      run();
      await expect.poll(() => host.snapshots()[0]!.operation?.phase).toBe("succeeded");
      expect(result().status).toBe("ready");
      const summary = buildGlanceItems(host.snapshots(), host.glanceDetails()).find(
        (item) => item.id === "usage",
      )!;
      expect(summary.metrics![0]!.value).toBe("剩余 75%");
      run();
      await expect.poll(() => result().status).toBe("error");
      expect(result()).toMatchObject({
        status: "error",
        reason: "READ_FAILED",
        previous: { source: "codex-app-server" },
      });
      const failure = buildGlanceItems(host.snapshots(), host.glanceDetails())[0]!;
      expect(failure).toMatchObject({ phase: "error", page: "usage" });
      expect(failure.metrics).toBeUndefined();
      expect(failure.capturedAt).toBeUndefined();
      run();
      await expect.poll(() => result().status).toBe("ready");
      expect(host.snapshots()[0]!.phase).toBe("running");
    } finally {
      await host.shutdown();
    }
    const restarted = new ModuleHost([definition], path);
    try {
      await restarted.load();
      await delay(10);
      expect(calls).toBe(3);
      expect(restarted.snapshots()[0]!.operation).toBeNull();
    } finally {
      await restarted.shutdown();
    }
  });
  it("rejects arbitrary operation inputs and malformed public projections", async () => {
    const definition = createUsageModule(async () => raw);
    const unsafe = {
      description: "safe",
      metrics: [
        { id: "test", label: "label", value: "value", detail: "detail", private: "private-token" },
      ],
    };
    definition.glance = () => unsafe;
    const host = new ModuleHost([definition], await directory());
    try {
      await host.load();
      await host.setEnabled({ moduleId: "usage", enabled: true });
      expect(() =>
        host.run({ moduleId: "usage", operation: "refresh", input: { command: "arbitrary" } }),
      ).toThrow();
      expect(host.glanceDetails().size).toBe(0);
    } finally {
      await host.shutdown();
    }
  });
});
