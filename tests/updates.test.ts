import { afterEach, expect, it, vi } from "vitest";
import { mkdtemp, writeFile, readFile, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ApplicationUpdates, type UpdateEngine } from "../apps/desktop/src/application/updates";
import {
  updatePreferencesSchema,
  updateActionSchema,
  releaseCheckSchema,
  releasesUrl,
} from "../apps/desktop/src/contracts/updates";
const directories: string[] = [];
const services: ApplicationUpdates[] = [];
const release = { version: "0.2.0", available: true, releaseUrl: `${releasesUrl}/tag/v0.2.0` };
async function setup(overrides: Partial<UpdateEngine> = {}) {
  const dir = await mkdtemp(join(tmpdir(), "codex-coco-updates-"));
  directories.push(dir);
  const port = {
    supported: vi.fn(async () => true),
    check: vi.fn(async () => release),
    download: vi.fn(
      async (_version: string, _signal: AbortSignal, progress: (percent: number) => void) => {
        progress(50);
      },
    ),
    install: vi.fn(),
    openRelease: vi.fn(async (_url: string) => undefined),
    ...overrides,
  };
  const service = new ApplicationUpdates(join(dir, "updates.json"), "0.1.0", port);
  services.push(service);
  await service.load();
  return { service, port, dir };
}
async function idle(service: ApplicationUpdates) {
  await vi.waitFor(() =>
    expect(["checking", "downloading", "cancelling"].includes(service.snapshot().phase)).toBe(
      false,
    ),
  );
}
afterEach(async () => {
  await Promise.all(services.splice(0).map((s) => s.shutdown()));
  vi.useRealTimers();
  await Promise.all(directories.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});
it("defers startup networking and keeps separate low-level download/install actions explicit", async () => {
  const { service, port } = await setup();
  expect(port.check).not.toHaveBeenCalled();
  await service.action({ action: "check" });
  await idle(service);
  expect(service.snapshot()).toMatchObject({
    phase: "available",
    availableVersion: "0.2.0",
    releaseUrl: release.releaseUrl,
  });
  expect(port.download).not.toHaveBeenCalled();
  for (const action of ["download", "install"])
    await expect(service.action({ action })).rejects.toMatchObject({ code: "INVALID_INPUT" });
  await service.action({ action: "download", confirmed: true });
  await idle(service);
  expect(service.snapshot()).toMatchObject({ phase: "downloaded", progress: 100 });
  expect(port.install).not.toHaveBeenCalled();
  await service.action({ action: "install", confirmed: true });
  expect(port.install).toHaveBeenCalledTimes(1);
});

it("checks automatically after startup and daily without downloading or restarting", async () => {
  vi.useFakeTimers();
  const { service, port } = await setup();
  expect(service.snapshot().preferences.intervalHours).toBe(24);
  await vi.advanceTimersByTimeAsync(9999);
  expect(port.check).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  expect(port.check).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(24 * 3600_000);
  expect(port.check).toHaveBeenCalledTimes(2);
  expect(port.download).not.toHaveBeenCalled();
  expect(port.install).not.toHaveBeenCalled();
});

it("honors an existing saved manual-check preference", async () => {
  vi.useFakeTimers();
  const { service, port } = await setup();
  await service.save({ expectedRevision: 0, value: { intervalHours: 0 } });
  await vi.advanceTimersByTimeAsync(168 * 3600_000);
  expect(port.check).not.toHaveBeenCalled();
});

it("downloads and installs once from one explicit consent, and never after cancellation", async () => {
  const { service, port } = await setup();
  await service.action({ action: "check" });
  await idle(service);
  await expect(service.action({ action: "update" })).rejects.toMatchObject({
    code: "INVALID_INPUT",
  });
  await service.action({ action: "update", confirmed: true });
  await idle(service);
  expect(port.download).toHaveBeenCalledTimes(1);
  expect(port.install).toHaveBeenCalledTimes(1);
  expect(service.snapshot().phase).toBe("installing");
  let finish: (() => void) | undefined;
  const cancelled = await setup({
    download: async () => {
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
    },
  });
  await cancelled.service.action({ action: "check" });
  await idle(cancelled.service);
  await cancelled.service.action({ action: "update", confirmed: true });
  await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
  await cancelled.service.action({ action: "cancel" });
  finish?.();
  await idle(cancelled.service);
  expect(cancelled.port.install).not.toHaveBeenCalled();
  expect(cancelled.service.snapshot().phase).toBe("available");
});

it("does not restart from one-click consent after a failed download or shutdown", async () => {
  const failed = await setup({
    download: async () => {
      throw new Error("PRIVATE checksum");
    },
  });
  await failed.service.action({ action: "check" });
  await idle(failed.service);
  await failed.service.action({ action: "update", confirmed: true });
  await idle(failed.service);
  expect(failed.port.install).not.toHaveBeenCalled();
  expect(failed.service.snapshot().reason).toBe("DOWNLOAD_FAILED");
  let finish: (() => void) | undefined;
  const stopping = await setup({
    download: async () => {
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
    },
  });
  await stopping.service.action({ action: "check" });
  await idle(stopping.service);
  await stopping.service.action({ action: "update", confirmed: true });
  await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
  const stopped = stopping.service.shutdown();
  finish?.();
  await stopped;
  expect(stopping.port.install).not.toHaveBeenCalled();
});
it("allows unsigned checks and manual release navigation while blocking native download and installation", async () => {
  const { service, port } = await setup({ supported: async () => false });
  await service.action({ action: "check" });
  await idle(service);
  expect(service.snapshot()).toMatchObject({ phase: "available", installSupported: false });
  await service.action({ action: "open-release" });
  expect(port.openRelease).toHaveBeenCalledWith(release.releaseUrl);
  await service.action({ action: "download", confirmed: true });
  await idle(service);
  expect(service.snapshot().reason).toBe("SIGNED_INSTALL_REQUIRED");
  expect(port.download).not.toHaveBeenCalled();
  await expect(service.action({ action: "install", confirmed: true })).rejects.toMatchObject({
    code: "INVALID_INPUT",
  });
  expect(port.install).not.toHaveBeenCalled();
});
it("treats no Release as distinct from current/latest and opens only the fixed releases page", async () => {
  const { service, port } = await setup({ check: async () => null });
  await service.action({ action: "check" });
  await idle(service);
  expect(service.snapshot()).toMatchObject({
    phase: "no-release",
    releaseUrl: null,
    availableVersion: null,
  });
  await service.action({ action: "open-release" });
  expect(port.openRelease).toHaveBeenCalledWith(releasesUrl);
  await expect(
    service.action({ action: "open-release", url: "https://evil.example" }),
  ).rejects.toMatchObject({ code: "INVALID_INPUT" });
});
it("waits for cancellation to settle and keeps raw failures private", async () => {
  let releaseDownload: (() => void) | undefined;
  const { service, port } = await setup({
    download: vi.fn(async () => {
      await new Promise<void>((resolve) => {
        releaseDownload = resolve;
      });
      throw new Error("PRIVATE_ACCOUNT_AND_PATH");
    }),
  });
  await service.action({ action: "check" });
  await idle(service);
  await service.action({ action: "download", confirmed: true });
  await vi.waitFor(() => expect(releaseDownload).toBeTypeOf("function"));
  await service.action({ action: "cancel" });
  expect(service.snapshot().phase).toBe("cancelling");
  await expect(service.action({ action: "download", confirmed: true })).rejects.toMatchObject({
    code: "CONFLICT",
  });
  releaseDownload?.();
  await idle(service);
  expect(service.snapshot().phase).toBe("available");
  expect(JSON.stringify(service.snapshot())).not.toContain("PRIVATE");
  expect(port.download).toHaveBeenCalledTimes(1);
});
it("persists opt-in checks, detects revision conflicts, and recovers corrupt settings with a backup", async () => {
  const { service, port, dir } = await setup();
  await service.save({ expectedRevision: 0, value: { intervalHours: 4 } });
  expect(JSON.parse(await readFile(join(dir, "updates.json"), "utf8")).version).toBe(2);
  await expect(
    service.save({ expectedRevision: 0, value: { intervalHours: 0 } }),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  vi.useFakeTimers();
  const restored = new ApplicationUpdates(join(dir, "updates.json"), "0.1.0", port);
  services.push(restored);
  await restored.load();
  expect(port.check).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(4 * 3600_000);
  expect(port.check).toHaveBeenCalledTimes(1);
  await restored.shutdown();
  await writeFile(join(dir, "updates.json"), "broken PRIVATE");
  const damaged = new ApplicationUpdates(join(dir, "updates.json"), "0.1.0", port);
  services.push(damaged);
  await damaged.load();
  expect(damaged.snapshot().reason).toBe("SETTINGS_UNAVAILABLE");
  await expect(
    damaged.save({ expectedRevision: 0, value: { intervalHours: 0 } }),
  ).rejects.toMatchObject({ code: "SETTINGS_UNAVAILABLE" });
  await damaged.action({ action: "reset" });
  expect((await readdir(dir)).some((file) => file.includes("backup-"))).toBe(true);
});
it("migrates legacy custom feeds without retaining the source or automatically contacting a new provider", async () => {
  const { port, dir } = await setup();
  const legacy = JSON.stringify({
    version: 1,
    revision: 7,
    preferences: { source: "https://old.example/", intervalHours: 4 },
  });
  await writeFile(join(dir, "updates.json"), legacy);
  const restored = new ApplicationUpdates(join(dir, "updates.json"), "0.1.0", port);
  services.push(restored);
  await restored.load();
  expect(restored.snapshot()).toMatchObject({
    phase: "idle",
    revision: 7,
    preferences: { intervalHours: 0 },
  });
  expect(JSON.stringify(restored.snapshot())).not.toContain("old.example");
  expect(await readFile(join(dir, "updates.json"), "utf8")).toBe(legacy);
  expect(port.check).not.toHaveBeenCalled();
});
it("rejects arbitrary sources, release links, and malformed public engine output", async () => {
  expect(
    updatePreferencesSchema.safeParse({ intervalHours: 0, source: "https://evil.example/" })
      .success,
  ).toBe(false);
  for (const url of [
    "https://evil.example",
    `${releasesUrl}/tag/v1.0.0?token=secret`,
    `${releasesUrl}/tag/../../settings`,
  ])
    expect(releaseCheckSchema.safeParse({ ...release, releaseUrl: url }).success).toBe(false);
  expect(updateActionSchema.safeParse({ action: "install", confirmed: false }).success).toBe(false);
  const { service } = await setup({
    check: async () => ({ ...release, releaseUrl: "https://evil.example/PRIVATE" }),
  });
  await service.action({ action: "check" });
  await idle(service);
  expect(service.snapshot()).toMatchObject({
    phase: "error",
    reason: "CHECK_FAILED",
    releaseUrl: null,
  });
  expect(JSON.stringify(service.snapshot())).not.toContain("PRIVATE");
});
it("clears a stale available version after a failed check", async () => {
  const check = vi
    .fn<UpdateEngine["check"]>()
    .mockResolvedValueOnce(release)
    .mockRejectedValueOnce(new Error("PRIVATE"));
  const { service } = await setup({ check });
  await service.action({ action: "check" });
  await idle(service);
  await service.action({ action: "check" });
  await idle(service);
  expect(service.snapshot()).toMatchObject({
    phase: "error",
    availableVersion: null,
    releaseUrl: null,
  });
  await expect(service.action({ action: "download", confirmed: true })).rejects.toMatchObject({
    code: "INVALID_INPUT",
  });
});
it("isolates checksum and installation failures", async () => {
  const { service, port } = await setup({
    download: async () => {
      throw new Error("PRIVATE sha512 mismatch");
    },
    install: () => {
      throw new Error("PRIVATE_SYSTEM");
    },
  });
  await service.action({ action: "check" });
  await idle(service);
  await service.action({ action: "download", confirmed: true });
  await idle(service);
  expect(service.snapshot()).toMatchObject({ phase: "error", reason: "DOWNLOAD_FAILED" });
  expect(JSON.stringify(service.snapshot())).not.toContain("PRIVATE");
  port.download = async () => undefined;
  await service.action({ action: "download", confirmed: true });
  await idle(service);
  await service.action({ action: "install", confirmed: true });
  expect(service.snapshot()).toMatchObject({ phase: "error", reason: "INSTALL_FAILED" });
});

it("does not publish a late release result after check cancellation", async () => {
  let finish: ((value: typeof release) => void) | undefined;
  const { service } = await setup({
    check: async () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  });
  await service.action({ action: "check" });
  await service.action({ action: "cancel" });
  expect(service.snapshot().phase).toBe("cancelling");
  finish?.(release);
  await idle(service);
  expect(service.snapshot()).toMatchObject({
    phase: "idle",
    availableVersion: null,
    releaseUrl: null,
  });
});

it("holds the install lock through signature checks and waits during shutdown without installing", async () => {
  let finish: ((value: boolean) => void) | undefined;
  const supported = vi
    .fn<UpdateEngine["supported"]>()
    .mockResolvedValueOnce(true)
    .mockResolvedValueOnce(true)
    .mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
  const { service, port } = await setup({ supported });
  await service.action({ action: "check" });
  await idle(service);
  await service.action({ action: "download", confirmed: true });
  await idle(service);
  const installing = service.action({ action: "install", confirmed: true });
  await expect(service.action({ action: "check" })).rejects.toMatchObject({ code: "CONFLICT" });
  await expect(
    service.save({ expectedRevision: 0, value: { intervalHours: 4 } }),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  let stopped = false;
  const stopping = service.shutdown().then(() => {
    stopped = true;
  });
  await Promise.resolve();
  expect(stopped).toBe(false);
  finish?.(true);
  await Promise.all([installing, stopping]);
  expect(port.install).not.toHaveBeenCalled();
});
