import { afterEach, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { releasesUrl, updateRepository } from "../apps/desktop/src/contracts/updates";

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  open: vi.fn(),
  feed: vi.fn(),
  check: vi.fn(),
  download: vi.fn(),
}));
vi.mock("../apps/desktop/node_modules/electron", () => ({
  app: { getVersion: () => "0.1.0-dev.1", isPackaged: false },
  net: { fetch: mocks.fetch },
  shell: { openExternal: mocks.open },
}));
vi.mock("../apps/desktop/node_modules/electron-updater", () => ({
  MacUpdater: class {
    setFeedURL = mocks.feed;
    checkForUpdates = mocks.check;
    downloadUpdate = mocks.download;
    on() {}
    off() {}
  },
  CancellationToken: class {
    cancel() {}
  },
}));
const { createNativeUpdateEngine } = await import("../apps/desktop/src/desktop/main/updates");
const directories: string[] = [];
afterEach(async () => {
  vi.clearAllMocks();
  await Promise.all(directories.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});
async function engine() {
  const dir = await mkdtemp(join(tmpdir(), "codex-coco-native-update-"));
  directories.push(dir);
  return createNativeUpdateEngine(dir);
}
it("uses anonymous GitHub metadata even in development and rejects arbitrary browser destinations", async () => {
  mocks.fetch.mockResolvedValue(
    new Response(JSON.stringify({ tag_name: "v0.1.0", draft: false, prerelease: false })),
  );
  const port = await engine();
  expect(await port.supported()).toBe(false);
  expect(await port.check(new AbortController().signal)).toMatchObject({
    available: true,
    version: "0.1.0",
  });
  expect(mocks.check).not.toHaveBeenCalled();
  await expect(port.openRelease("https://evil.invalid")).rejects.toThrow("INVALID_RELEASE_URL");
  expect(mocks.open).not.toHaveBeenCalled();
  await port.openRelease(releasesUrl);
  expect(mocks.open).toHaveBeenCalledWith(releasesUrl);
});
it("uses the public GitHub provider and refuses changed or missing versions before downloading", async () => {
  const port = await engine();
  const signal = new AbortController().signal;
  for (const result of [
    null,
    { isUpdateAvailable: false, updateInfo: { version: "0.2.0" } },
    { isUpdateAvailable: true, updateInfo: { version: "0.3.0" } },
  ]) {
    mocks.check.mockResolvedValue(result);
    await expect(port.download("0.2.0", signal, () => undefined)).rejects.toThrow(
      "RELEASE_CHANGED",
    );
  }
  expect(mocks.download).not.toHaveBeenCalled();
  expect(mocks.feed).toHaveBeenCalledWith({
    provider: "github",
    ...updateRepository,
    private: false,
  });
  mocks.check.mockResolvedValue({ isUpdateAvailable: true, updateInfo: { version: "0.2.0" } });
  await port.download("0.2.0", signal, () => undefined);
  expect(mocks.download).toHaveBeenCalledTimes(1);
});
