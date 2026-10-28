import { afterEach, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import identity from "../apps/desktop/resources/signing/identity.json";
import { releasesUrl } from "../apps/desktop/src/contracts/updates";

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  open: vi.fn(),
  feed: vi.fn(),
  check: vi.fn(),
  download: vi.fn(),
  packaged: false,
  signatureValid: true,
  signatureCheck: vi.fn(),
  version: "0.1.0-dev.1",
  instances: [] as { allowPrerelease: boolean }[],
}));
vi.mock("../apps/desktop/node_modules/electron", () => ({
  app: {
    getVersion: () => mocks.version,
    get isPackaged() {
      return mocks.packaged;
    },
  },
  net: { fetch: mocks.fetch },
  shell: { openExternal: mocks.open },
}));
vi.mock("node:child_process", () => ({
  execFile: (
    file: string,
    args: string[],
    _options: unknown,
    callback: (error: Error | null, result: string) => void,
  ) => {
    mocks.signatureCheck(file, args);
    callback(mocks.signatureValid ? null : new Error("PRIVATE signature failure"), "");
  },
}));
vi.mock("../apps/desktop/node_modules/electron-updater", () => ({
  MacUpdater: class {
    allowPrerelease = false;
    constructor() {
      mocks.instances.push(this);
    }
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
  mocks.packaged = false;
  mocks.signatureValid = true;
  mocks.version = "0.1.0-dev.1";
  mocks.instances.length = 0;
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
it("pins the checked GitHub release and refuses changed or missing metadata before downloading", async () => {
  const port = await engine();
  const signal = new AbortController().signal;
  mocks.fetch.mockResolvedValue(
    new Response(JSON.stringify({ tag_name: "v0.2.0", draft: false, prerelease: false })),
  );
  await port.check(signal);
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
    provider: "generic",
    url: `${releasesUrl}/download/v0.2.0/`,
    channel: "latest",
    useMultipleRangeRequest: false,
  });
  mocks.check.mockResolvedValue({ isUpdateAvailable: true, updateInfo: { version: "0.2.0" } });
  await port.download("0.2.0", signal, () => undefined);
  expect(mocks.download).toHaveBeenCalledTimes(1);
});

it("downloads preview metadata from exactly the selected tag and permits a later stable release", async () => {
  mocks.version = "0.1.0-preview.1";
  mocks.fetch.mockImplementation(
    async () =>
      new Response(
        JSON.stringify([{ tag_name: "0.1.0-preview.2", draft: false, prerelease: true }]),
      ),
  );
  const port = await engine();
  const signal = new AbortController().signal;
  await port.check(signal);
  mocks.check.mockResolvedValue({
    isUpdateAvailable: true,
    updateInfo: { version: "0.1.0-preview.2" },
  });
  await port.download("0.1.0-preview.2", signal, () => undefined);
  expect(mocks.feed).toHaveBeenLastCalledWith({
    provider: "generic",
    url: `${releasesUrl}/download/0.1.0-preview.2/`,
    channel: "preview",
    useMultipleRangeRequest: false,
  });
  expect(mocks.instances[0]?.allowPrerelease).toBe(true);
});

it("requires the pinned certificate and bundle identifier without requiring an Apple Team ID", async () => {
  mocks.packaged = true;
  const port = await engine();
  expect(await port.supported()).toBe(true);
  expect(mocks.signatureCheck).toHaveBeenCalledWith(
    "/usr/bin/codesign",
    expect.arrayContaining([
      "--strict",
      "--deep",
      "-R",
      `=anchor H"${identity.sha1}" and identifier "${identity.bundleId}"`,
    ]),
  );
  mocks.signatureValid = false;
  expect(await port.supported()).toBe(false);
});
