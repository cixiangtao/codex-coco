import { afterEach, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ModuleHost } from "../apps/desktop/src/application/module-host";
import { buildGlanceItems } from "../apps/desktop/src/application/glance";
import { createUsageModule } from "../apps/desktop/src/modules/usage/runtime";
import {
  localScanResultSchema,
  trendTotals,
  usageState,
  usageToolsSchema,
} from "../apps/desktop/src/modules/usage/contract";
import { type UsageToolsService } from "../apps/desktop/src/modules/usage/tools";
import type { LocalUsageService } from "../apps/desktop/src/modules/usage/local-service";

const directories: string[] = [];
afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

it("keeps quota, daily statistics and menu text across auxiliary failure, cancellation and new-window snapshots", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 9, 30, 12));
  const directory = await mkdtemp(join(tmpdir(), "codex-coco-usage-state-"));
  directories.push(directory);
  const toolsState = usageToolsSchema.parse({
    installation: "unknown",
    models: [],
    samples: [],
    history: [],
    error: null,
    cliVersion: null,
    latestCliVersion: null,
  });
  const tools: UsageToolsService = {
    snapshot: () => structuredClone(toolsState),
    execute: async (name, _input, signal, report) => {
      if (name === "check-cli") throw new Error("PRIVATE_FAILURE");
      toolsState.cliVersion = "1.2.3";
      report(50);
      await new Promise<void>((resolve) =>
        signal.addEventListener("abort", () => resolve(), { once: true }),
      );
      signal.throwIfAborted();
    },
  };
  const scan = localScanResultSchema.parse({
    trend: {
      capturedAt: new Date(2026, 9, 30, 12).getTime(),
      days: 30,
      source: "session-events",
      scope: "all-local-unassigned",
      points: Array.from({ length: 30 }, (_, index) => ({
        day: `2026-10-${String(index + 1).padStart(2, "0")}`,
        tokens: index + 1,
      })),
      unassignedTokens: 465,
      limited: false,
      scannedFiles: 1,
      reusedFiles: 0,
    },
    fallback: null,
  });
  const local = {
    scan: vi.fn<LocalUsageService["scan"]>(async () => scan),
    chooseHome: async () => false,
  };
  const host = new ModuleHost(
    [
      createUsageModule(
        async () => ({ rateLimits: { primary: { usedPercent: 25, windowDurationMins: 300 } } }),
        undefined,
        local,
        undefined,
        tools,
      ),
    ],
    directory,
  );
  const snapshot = () => host.snapshots()[0]!;
  const summary = () => buildGlanceItems(host.snapshots(), host.glanceDetails())[0]!;
  try {
    await host.load();
    await host.setEnabled({ moduleId: "usage", enabled: true });
    host.run({ moduleId: "usage", operation: "refresh", input: {} });
    await expect.poll(() => snapshot().operation?.phase).toBe("succeeded");
    const ready = usageState(snapshot());
    expect(ready?.status).toBe("ready");
    expect(trendTotals(ready!.trend!)).toEqual({ today: 30, week: 189, month: 465 });
    expect(local.scan.mock.calls[0]?.[2]).toMatchObject({ days: 30 });
    expect(summary().statusText).toBe("5h 75%");
    expect(summary().metrics?.find((metric) => metric.id === "tokens:today")?.value).toBe(
      "30 tokens",
    );
    host.run({ moduleId: "usage", operation: "scan-trend", input: { force: false } });
    await expect.poll(() => snapshot().operation?.phase).toBe("succeeded");
    expect(local.scan.mock.lastCall?.[2]).toMatchObject({ force: false, refresh: true });
    host.run({ moduleId: "usage", operation: "check-cli", input: {} });
    await expect.poll(() => snapshot().operation?.phase).toBe("failed");
    expect(usageState(snapshot())).toEqual(ready);
    expect(summary().phase).toBe("running");
    const pending = host.run({ moduleId: "usage", operation: "list-models", input: {} });
    await expect.poll(() => snapshot().operation?.progress).toBe(50);
    expect(usageState(snapshot())?.tools?.cliVersion).toBe("1.2.3");
    expect(summary().statusText).toBe("5h 75%");
    host.cancel({ moduleId: "usage", operationId: pending.operation!.id });
    await expect.poll(() => snapshot().operation?.phase).toBe("cancelled");
    expect(usageState(snapshot())).toMatchObject({ status: "ready", trend: ready!.trend });
    expect(snapshot().operation?.result).toBeNull();
    expect(summary().statusText).toBe("5h 75%");
    await host.setEnabled({ moduleId: "usage", enabled: false });
    expect(snapshot().state).toBeUndefined();
  } finally {
    await host.shutdown();
  }
});

it("invalidates failed local scans without losing successful quota and clears the warning on retry", async () => {
  let fails = false;
  const local: LocalUsageService = {
    chooseHome: async () => false,
    scan: async () => {
      if (fails) throw new Error("PRIVATE_SCAN_FAILURE");
      return localScanResultSchema.parse({
        trend: {
          capturedAt: Date.now(),
          days: 30,
          source: "session-events",
          scope: "all-local-unassigned",
          points: [{ day: "2026-10-26", tokens: 42 }],
          unassignedTokens: 42,
          limited: false,
          scannedFiles: 1,
          reusedFiles: 0,
        },
        fallback: null,
      });
    },
  };
  const { usageDefaults, usageResultSchema } =
    await import("../apps/desktop/src/modules/usage/contract");
  const runtime = await createUsageModule(
    async () => ({ rateLimits: { primary: { usedPercent: 25 } } }),
    undefined,
    local,
  ).start(new AbortController().signal, {
    configuration: () => usageDefaults,
    requestOperation: () => false,
  });
  const context = {
    signal: new AbortController().signal,
    config: usageDefaults,
    report: () => undefined,
  };
  try {
    await runtime.execute("refresh", {}, context);
    expect(usageResultSchema.parse(runtime.state!()).trend?.points[0]?.tokens).toBe(42);
    fails = true;
    await runtime.execute("refresh", {}, context);
    expect(usageResultSchema.parse(runtime.state!())).toMatchObject({
      status: "ready",
      trend: null,
      trendFailed: true,
    });
    fails = false;
    await runtime.execute("scan-trend", { force: false }, context);
    expect(usageResultSchema.parse(runtime.state!())).toMatchObject({
      status: "ready",
      trendFailed: false,
    });
    fails = true;
    await expect(runtime.execute("scan-trend", { force: false }, context)).rejects.toThrow();
    expect(usageResultSchema.parse(runtime.state!())).toMatchObject({
      status: "ready",
      trend: null,
      trendFailed: true,
    });
  } finally {
    await runtime.stop();
  }
});

it("publishes uncertain redemption as the durable runtime state instead of leaving current quota ready", async () => {
  const { usageDefaults, usageResultSchema } =
    await import("../apps/desktop/src/modules/usage/contract");
  const input = { attemptKey: randomUUID(), reference: null };
  const feedback = { ...input, outcome: "pending" as const, updatedAt: Date.now() };
  const runtime = await createUsageModule(
    async () => ({ rateLimits: { primary: { usedPercent: 90 } } }),
    undefined,
    undefined,
    {
      latest: async () => feedback,
      consume: async () => feedback,
    },
  ).start(new AbortController().signal, {
    configuration: () => usageDefaults,
    requestOperation: () => false,
  });
  const context = {
    signal: new AbortController().signal,
    config: usageDefaults,
    report: () => undefined,
  };
  try {
    await runtime.execute("refresh", {}, context);
    const result = await runtime.execute("consume-reset", input, context);
    expect(usageResultSchema.parse(runtime.state!())).toMatchObject({
      status: "error",
      reason: "READ_FAILED",
      reset: feedback,
    });
    expect(usageResultSchema.parse(runtime.state!())).toEqual(usageResultSchema.parse(result));
  } finally {
    await runtime.stop();
  }
});

it("anchors local totals to calendar dates and never presents yesterday as today's usage", async () => {
  const { trendTotals, trendIsCurrentDay } =
    await import("../apps/desktop/src/modules/usage/contract");
  const trend = localScanResultSchema.parse({
    trend: {
      capturedAt: new Date(2026, 9, 25, 23, 59).getTime(),
      days: 30,
      source: "session-events",
      scope: "all-local-unassigned",
      points: [
        { day: "2026-10-18", tokens: 10 },
        { day: "2026-10-25", tokens: 20 },
        { day: "2026-10-27", tokens: 999 },
      ],
      unassignedTokens: 30,
      limited: false,
      scannedFiles: 1,
      reusedFiles: 0,
    },
    fallback: null,
  }).trend;
  expect(trendTotals(trend)).toEqual({ today: 20, week: 20, month: 30 });
  const midnight = new Date(2026, 9, 26, 0, 1).getTime();
  expect(trendIsCurrentDay(trend, midnight)).toBe(false);
  expect(trendTotals(trend, midnight)).toEqual({ today: 0, week: 20, month: 30 });
});
