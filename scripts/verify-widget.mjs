import { access, mkdtemp, rm } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
const compiler = "/Library/Developer/CommandLineTools/usr/bin/swiftc";
const sdk = "/Library/Developer/CommandLineTools/SDKs/MacOSX.sdk";
const directory = await mkdtemp(join(tmpdir(), "codex-coco-widget-check-"));
try {
  await access(compiler);
  await access(sdk);
  await promisify(execFile)(
    compiler,
    [
      "-typecheck",
      "-parse-as-library",
      "-sdk",
      sdk,
      "-target",
      "arm64-apple-macos14.0",
      "-module-cache-path",
      directory,
      fileURLToPath(new URL("../native/widget/CodexCocoWidget.swift", import.meta.url)),
    ],
    {
      env: { ...process.env, CLANG_MODULE_CACHE_PATH: directory },
      timeout: 60_000,
      maxBuffer: 1024 * 1024,
    },
  );
  console.log(
    JSON.stringify(
      { ok: true, swiftTypecheck: true, installedWidget: false, appGroupConfigured: false },
      null,
      2,
    ),
  );
} catch (error) {
  console.error(
    error instanceof Error && "code" in error && error.code === "ENOENT"
      ? "WIDGET_SDK_UNAVAILABLE"
      : "WIDGET_TYPECHECK_FAILED",
  );
  process.exitCode = 1;
} finally {
  await rm(directory, { recursive: true, force: true });
}
