import { afterEach, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
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
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

it("keeps quota, daily statistics and menu text across auxiliary failure, cancellation and new-window snapshots", async () => {
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
      capturedAt: Date.now(),
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
