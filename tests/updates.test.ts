import { afterEach, expect, it, vi } from "vitest";
import { mkdtemp, writeFile, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ApplicationUpdates, type UpdateEngine } from "../apps/desktop/src/application/updates";
import { updatePreferencesSchema, updateActionSchema } from "../apps/desktop/src/contracts/updates";
const directories: string[] = [];
const services: ApplicationUpdates[] = [];
async function setup(engine?: UpdateEngine) {
  const dir = await mkdtemp(join(tmpdir(), "codex-coco-updates-"));
  directories.push(dir);
  const port = engine ?? {
    supported: vi.fn(async () => true),
    check: vi.fn(async () => ({ version: "0.2.0", available: true })),
    download: vi.fn(async (_signal, progress) => {
      progress(50);
    }),
    install: vi.fn(),
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
it("does no startup network, checks without downloading, and requires explicit installation confirmation", async () => {
  const { service, port } = await setup();
  expect(port.check).not.toHaveBeenCalled();
  await service.action({ action: "check" });
  expect(service.snapshot().phase).toBe("unconfigured");
  await service.save({
    expectedRevision: 0,
    value: { source: "https://updates.example.com/", intervalHours: 0 },
  });
  await service.action({ action: "check" });
  await idle(service);
  expect(service.snapshot().phase).toBe("available");
  expect(port.download).not.toHaveBeenCalled();
  await expect(service.action({ action: "install" })).rejects.toMatchObject({
    code: "INVALID_INPUT",
  });
  await service.action({ action: "download" });
  await idle(service);
  expect(service.snapshot()).toMatchObject({ phase: "downloaded", progress: 100 });
  expect(port.install).not.toHaveBeenCalled();
  await service.action({ action: "install", confirmed: true });
  expect(port.install).toHaveBeenCalledTimes(1);
});
it("waits for download cancellation to settle, keeps raw failures private, and supports retry", async () => {
  let release: (() => void) | undefined;
  const { service, port } = await setup({
    supported: async () => true,
    check: async () => ({ version: "0.2.0", available: true }),
    download: vi.fn(async () => {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      throw new Error("PRIVATE_ACCOUNT_AND_PATH");
    }),
    install: () => undefined,
  });
  await service.save({
    expectedRevision: 0,
    value: { source: "https://updates.example.com/", intervalHours: 0 },
  });
  await service.action({ action: "check" });
  await idle(service);
  await service.action({ action: "download" });
  await vi.waitFor(() => expect(release).toBeTypeOf("function"));
  await service.action({ action: "cancel" });
  expect(service.snapshot().phase).toBe("cancelling");
  await expect(service.action({ action: "download" })).rejects.toMatchObject({ code: "CONFLICT" });
  release?.();
  await idle(service);
  expect(service.snapshot().phase).toBe("available");
  expect(JSON.stringify(service.snapshot())).not.toContain("PRIVATE");
  expect(port.download).toHaveBeenCalledTimes(1);
});
it("persists opt-in checks, detects revision conflicts, and isolates corrupt settings with backup reset", async () => {
  const { service, port, dir } = await setup();
  await service.save({
    expectedRevision: 0,
    value: { source: "https://updates.example.com/", intervalHours: 4 },
  });
  await expect(
    service.save({ expectedRevision: 0, value: { source: "", intervalHours: 0 } }),
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
    damaged.save({ expectedRevision: 0, value: { source: "", intervalHours: 0 } }),
  ).rejects.toMatchObject({ code: "SETTINGS_UNAVAILABLE" });
  await damaged.action({ action: "reset" });
  expect((await readdir(dir)).some((file) => file.includes("backup-"))).toBe(true);
});
it("blocks unsigned engines and rejects credential-bearing or insecure update sources", async () => {
  const { service, port } = await setup({
    supported: async () => false,
    check: vi.fn(async () => ({ version: "0.2.0", available: true })),
    download: vi.fn(async () => undefined),
    install: vi.fn(),
  });
  await service.save({
    expectedRevision: 0,
    value: { source: "https://updates.example.com/", intervalHours: 0 },
  });
  await service.action({ action: "check" });
  await idle(service);
  expect(service.snapshot().reason).toBe("SIGNED_INSTALL_REQUIRED");
  expect(port.check).not.toHaveBeenCalled();
  for (const source of [
    "http://example.com/",
    "https://user:password@example.com/",
    "https://example.com/?token=secret",
    "https://example.com/#secret",
    "not-url",
  ])
    expect(updatePreferencesSchema.safeParse({ source, intervalHours: 0 }).success).toBe(false);
  expect(updateActionSchema.safeParse({ action: "install", confirmed: false }).success).toBe(false);
});

it("rejects failed package verification and failed installation without exposing raw errors", async () => {
  const port: UpdateEngine = {
    supported: async () => true,
    check: async () => ({ version: "0.2.0", available: true }),
    download: async () => {
      throw new Error("PRIVATE_PATH sha512 mismatch");
    },
    install: () => {
      throw new Error("PRIVATE_SYSTEM_ERROR");
    },
  };
  const { service } = await setup(port);
  await service.save({
    expectedRevision: 0,
    value: { source: "https://updates.example.com/", intervalHours: 0 },
  });
  await service.action({ action: "check" });
  await idle(service);
  await service.action({ action: "download" });
  await idle(service);
  expect(service.snapshot()).toMatchObject({ phase: "error", reason: "DOWNLOAD_FAILED" });
  expect(JSON.stringify(service.snapshot())).not.toContain("PRIVATE");
  await expect(service.action({ action: "install", confirmed: true })).rejects.toMatchObject({
    code: "INVALID_INPUT",
  });
  port.download = async () => undefined;
  await service.action({ action: "download" });
  await idle(service);
  expect(service.snapshot().phase).toBe("downloaded");
  await service.action({ action: "install", confirmed: true });
  expect(service.snapshot()).toMatchObject({ phase: "error", reason: "INSTALL_FAILED" });
  expect(JSON.stringify(service.snapshot())).not.toContain("PRIVATE");
});
