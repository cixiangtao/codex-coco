import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createDesktopSession } from "./verify-desktop.mjs";
const exec = promisify(execFile);
const pin = JSON.parse(await readFile("apps/desktop/resources/signing/identity.json", "utf8"));
const bundle = resolve("apps/desktop/release/mac-arm64/Codex Coco.app");
await exec("codesign", [
  "--verify",
  "--deep",
  "--strict",
  "-R",
  `=anchor H"${pin.sha1}" and identifier "${pin.bundleId}"`,
  bundle,
]);
assert.equal(
  (await exec("lipo", ["-archs", join(bundle, "Contents/MacOS/Codex Coco")])).stdout.trim(),
  "arm64",
);
const directory = await mkdtemp(join(tmpdir(), "codex-coco-signed-smoke-"));
let session;
try {
  session = await createDesktopSession(
    directory,
    process.env,
    join(bundle, "Contents/MacOS/Codex Coco"),
  );
  const result = await session.page.evaluate(() => window.codexCoco.updates());
  assert.equal(result.ok, true);
  assert.equal(result.value.installSupported, true);
  assert.equal(result.value.phase, "idle");
  assert.deepEqual(session.errors, []);
  console.log("Production app accepts the pinned self-signed identity without an Apple Team ID.");
} finally {
  await session?.application.close();
  await rm(directory, { recursive: true, force: true });
}
