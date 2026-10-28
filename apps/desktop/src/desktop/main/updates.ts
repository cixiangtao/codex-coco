import { app, net, shell } from "electron";
import identity from "../../../resources/signing/identity.json";
import { readGithubRelease } from "../../application/github-releases";
import { updateRepository, releasesUrl, releaseCheckSchema } from "../../contracts/updates";
import type { MacUpdater } from "electron-updater";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { UpdateEngine } from "../../application/updates";
const exec = promisify(execFile);
/** Pinned electron-updater owns checksum verification and native signed replacement; logs stay private. */
export function createNativeUpdateEngine(directory: string): UpdateEngine {
  let updater: MacUpdater | undefined;
  let errorListener: (() => void) | undefined;
  const get = async () => {
    if (updater) return updater;
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const config = join(directory, "app-update.yml");
    await writeFile(config, "updaterCacheDirName: codex-coco-updater\n", { mode: 0o600 });
    const { MacUpdater } = await import("electron-updater");
    updater = new MacUpdater();
    updater.logger = null;
    // Keep the provider header shared across installations; never upload its locally generated rollout UUID.
    updater.requestHeaders = { "x-user-staging-id": "00000000-0000-4000-8000-000000000000" };
    updater.autoDownload = false;
    updater.autoInstallOnAppQuit = false;
    updater.allowDowngrade = false;
    updater.allowPrerelease = false;
    updater.disableDifferentialDownload = true;
    updater.updateConfigPath = config;
    updater.on("error", () => errorListener?.());
    return updater;
  };
  return {
    supported: async () => {
      if (!app.isPackaged || process.platform !== "darwin") return false;
      const bundle = dirname(dirname(dirname(process.execPath)));
      try {
        await exec(
          "/usr/bin/codesign",
          [
            "--verify",
            "--deep",
            "--strict",
            "-R",
            `anchor H"${identity.sha1}" and identifier "${identity.bundleId}"`,
            bundle,
          ],
          { timeout: 10_000, maxBuffer: 64 * 1024 },
        );
        return true;
      } catch {
        return false;
      }
    },
    check: (signal) =>
      readGithubRelease(
        (input, init) => net.fetch(input instanceof URL ? input.toString() : input, init),
        app.getVersion(),
        signal,
      ),
    openRelease: async (url) => {
      if (url !== releasesUrl && !releaseCheckSchema.shape.releaseUrl.safeParse(url).success)
        throw new Error("INVALID_RELEASE_URL");
      await shell.openExternal(url);
    },
    download: async (version, signal, progress) => {
      const engine = await get();
      engine.setFeedURL({ provider: "github", ...updateRepository, private: false });
      const checked = await engine.checkForUpdates();
      signal.throwIfAborted();
      // A release changed after the prompt: require a new explicit check rather than downloading a different version.
      if (!checked?.isUpdateAvailable || checked.updateInfo.version !== version)
        throw new Error("RELEASE_CHANGED");
      const { CancellationToken } = await import("electron-updater");
      const token = new CancellationToken();
      const abort = () => token.cancel();
      signal.addEventListener("abort", abort, { once: true });
      if (signal.aborted) abort();
      const handler = (value: { percent: number }) => progress(value.percent);
      engine.on("download-progress", handler);
      try {
        await engine.downloadUpdate(token);
      } finally {
        signal.removeEventListener("abort", abort);
        engine.off("download-progress", handler);
      }
    },
    install: () => {
      if (!updater) throw new Error("INSTALL_FAILED");
      updater.quitAndInstall();
    },
    onError: (listener) => {
      errorListener = listener;
      return () => {
        errorListener = undefined;
      };
    },
  };
}
