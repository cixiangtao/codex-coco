import { afterEach, describe, expect, it, vi } from "vitest";
import {
  usageConfigSchema,
  usageDefaults,
  type UsageSnapshot,
} from "../apps/desktop/src/modules/usage/contract";
import type { UsageNotifier } from "../apps/desktop/src/modules/usage/notifications";
import type { UsageReader } from "../apps/desktop/src/modules/usage/app-server";
import { UsageNotifications } from "../apps/desktop/src/modules/usage/notifications";
import { createUsageModule } from "../apps/desktop/src/modules/usage/runtime";
import { UsageReadError } from "../apps/desktop/src/modules/usage/normalize";

const raw = {
  rateLimits: { primary: { usedPercent: 50, windowDurationMins: 300, resetsAt: 2_000_000_000 } },
};
const data = (usedPercent: number): UsageSnapshot => ({
  account: null,
  credits: null,
  resetCredits: null,
  source: "codex-app-server",
  capturedAt: 123,
  buckets: [
    {
      id: "codex",
      windows: [{ kind: "primary", usedPercent, windowMinutes: 300, resetsAt: 2_000_000_000 }],
    },
  ],
});
afterEach(() => vi.useRealTimers());
describe("usage notification policy", () => {
  it("notifies low, critical, recovery and failure transitions without repeating polling ticks", () => {
    const deliver = vi.fn<UsageNotifier>(() => true);
    const policy = new UsageNotifications(deliver);
    const config = { ...usageDefaults, notificationsEnabled: true };
    policy.success(data(50), config);
    expect(deliver).not.toHaveBeenCalled();
    policy.success(data(81), config);
    policy.success(data(82), config);
    const drift = data(82);
    drift.buckets[0]!.windows[0]!.resetsAt! += 2;
    policy.success(drift, config);
    expect(deliver).toHaveBeenCalledTimes(1);
    policy.success(data(96), config);
    expect(deliver.mock.calls.at(-1)?.[0]).toMatchObject({ kind: "critical" });
    policy.failure(config);
    policy.failure(config);
    expect(deliver).toHaveBeenCalledTimes(3);
    policy.success(data(1), config);
    expect(deliver.mock.calls.at(-1)?.[0]).toMatchObject({ kind: "recovered" });
    policy.failure(config);
    expect(deliver).toHaveBeenCalledTimes(5);
    expect(JSON.stringify(deliver.mock.calls)).not.toMatch(/token|email|auth|path/);
  });
  it("isolates failed notifications from usage and retries delivery, with default opt-out", () => {
    const deliver = vi.fn<UsageNotifier>(() => {
      throw new Error("OS denied");
    });
    const policy = new UsageNotifications(deliver);
    policy.success(data(99), usageDefaults);
    policy.failure(usageDefaults);
    expect(deliver).not.toHaveBeenCalled();
    const config = { ...usageDefaults, notificationsEnabled: true };
    expect(() => policy.success(data(99), config)).not.toThrow();
    policy.success(data(99), config);
    expect(deliver).toHaveBeenCalledTimes(2);
    policy.success(data(99), usageDefaults);
    expect(deliver).toHaveBeenCalledTimes(2);
  });
});
describe("usage scheduling", () => {
  it("refreshes once without polling, activates saved policy and releases every timer on stop", async () => {
    vi.useFakeTimers();
    const read = vi.fn(async () => raw);
    const request = vi.fn(() => true);
    const controller = new AbortController();
    const definition = createUsageModule(read);
    const runtime = await definition.start(controller.signal, {
      configuration: () => usageDefaults,
      requestOperation: request,
    });
    await vi.advanceTimersByTimeAsync(3_600_000);
    expect(request).toHaveBeenCalledTimes(1);
    expect(read).not.toHaveBeenCalled();
    request.mockClear();
    request.mockReturnValue(false);
    runtime.configurationChanged!({ ...usageDefaults, refreshIntervalSeconds: 30 });
    await vi.advanceTimersByTimeAsync(29_999);
    expect(request).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(request).toHaveBeenCalledWith("refresh", {});
    await vi.advanceTimersByTimeAsync(30_000);
    expect(request).toHaveBeenCalledTimes(2);
    runtime.configurationChanged!(usageDefaults);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(request).toHaveBeenCalledTimes(2);
    runtime.configurationChanged!({ ...usageDefaults, refreshIntervalSeconds: 30 });
    controller.abort();
    await runtime.stop();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(request).toHaveBeenCalledTimes(2);
  });
  it("backs off after read failures, resets after success and does not report cancellation as a notification", async () => {
    vi.useFakeTimers();
    const config = { ...usageDefaults, refreshIntervalSeconds: 30, notificationsEnabled: true };
    const request = vi.fn(() => true);
    const read = vi.fn<UsageReader>(async () => {
      throw new UsageReadError("READ_FAILED");
    });
    const notify = vi.fn(() => true);
    const controller = new AbortController();
    const runtime = await createUsageModule(read, notify).start(controller.signal, {
      configuration: () => config,
      requestOperation: request,
    });
    await runtime.execute(
      "refresh",
      {},
      { signal: controller.signal, config, report: () => undefined },
    );
    await vi.advanceTimersByTimeAsync(30_000);
    expect(request).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(request).toHaveBeenCalledTimes(1);
    read.mockImplementationOnce(async () => raw);
    await runtime.execute(
      "refresh",
      {},
      { signal: controller.signal, config, report: () => undefined },
    );
    await vi.advanceTimersByTimeAsync(30_000);
    expect(request).toHaveBeenCalledTimes(2);
    const aborted = new AbortController();
    aborted.abort();
    await expect(
      runtime.execute("refresh", {}, { signal: aborted.signal, config, report: () => undefined }),
    ).rejects.toThrow();
    expect(notify).toHaveBeenCalledTimes(1);
    await runtime.stop();
  });
  it("defers startup while busy, lets a manual refresh replace it and cancels on stop", async () => {
    vi.useFakeTimers();
    const request = vi.fn(() => false);
    const controller = new AbortController();
    const runtime = await createUsageModule(async () => raw).start(controller.signal, {
      configuration: () => usageDefaults,
      requestOperation: request,
    });
    await vi.advanceTimersByTimeAsync(300);
    expect(request).toHaveBeenCalledTimes(3);
    await runtime.execute(
      "refresh",
      {},
      { signal: controller.signal, config: usageDefaults, report: () => undefined },
    );
    await vi.advanceTimersByTimeAsync(60_000);
    expect(request).toHaveBeenCalledTimes(3);
    await runtime.stop();
    const second = await createUsageModule(async () => raw).start(controller.signal, {
      configuration: () => usageDefaults,
      requestOperation: request,
    });
    await second.stop();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(request).toHaveBeenCalledTimes(3);
  });
  it("waits for an auxiliary task to settle before issuing the pending startup read", async () => {
    vi.useFakeTimers();
    const request = vi.fn(() => true);
    let finish = () => {};
    const picked = new Promise<boolean>((resolve) => {
      finish = () => resolve(false);
    });
    const signal = new AbortController().signal;
    const runtime = await createUsageModule(async () => raw, undefined, {
      chooseHome: () => picked,
      scan: async () => {
        throw new Error("UNEXPECTED_SCAN");
      },
    }).start(signal, { configuration: () => usageDefaults, requestOperation: request });
    const pending = runtime.execute(
      "choose-local-home",
      {},
      { signal, config: usageDefaults, report: () => undefined },
    );
    await vi.advanceTimersByTimeAsync(60_000);
    expect(request).not.toHaveBeenCalled();
    finish();
    await pending;
    await vi.advanceTimersByTimeAsync(100);
    expect(request).toHaveBeenCalledTimes(1);
    await runtime.stop();
  });
  it("rejects invalid refresh intervals and threshold relationships", () => {
    for (const config of [
      { ...usageDefaults, refreshIntervalSeconds: 5 },
      { ...usageDefaults, criticalThreshold: 25 },
      { ...usageDefaults, warningThreshold: 101 },
    ])
      expect(usageConfigSchema.safeParse(config).success).toBe(false);
    expect(
      usageConfigSchema.safeParse({ ...usageDefaults, refreshIntervalSeconds: 30 }).success,
    ).toBe(true);
  });
});
