import { app } from "electron";
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
        await exec("/usr/bin/codesign", ["--verify", "--deep", "--strict", bundle], {
          timeout: 10_000,
          maxBuffer: 64 * 1024,
        });
        const detail = await exec("/usr/bin/codesign", ["-dv", "--verbose=4", bundle], {
          timeout: 5000,
          maxBuffer: 64 * 1024,
        });
        return /^TeamIdentifier=[A-Z0-9]+$/m.test(detail.stderr);
      } catch {
        return false;
      }
    },
    check: async (source) => {
      const engine = await get();
      engine.setFeedURL({ provider: "generic", url: source, useMultipleRangeRequest: false });
      const result = await engine.checkForUpdates();
      if (!result) throw new Error("CHECK_FAILED");
      return { version: result.updateInfo.version, available: result.isUpdateAvailable };
    },
    download: async (signal, progress) => {
      const engine = await get();
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
