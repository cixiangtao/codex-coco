import assert from "node:assert/strict";
import { createHash } from "node:crypto";

/** JSON is a YAML subset accepted by electron-updater; derive metadata from the exact signed ZIP. */
export function createUpdateInfo(version, archiveName, archive) {
  assert.match(version, /^0\.\d+\.\d+-preview\.[1-9]\d*$/);
  assert.equal(archiveName, `Codex-Coco-${version}-macOS-arm64-self-signed.zip`);
  const sha512 = createHash("sha512").update(archive).digest("base64");
  return (
    JSON.stringify(
      {
        version,
        files: [{ url: archiveName, sha512, size: archive.byteLength }],
        path: archiveName,
        sha512,
      },
      null,
      2,
    ) + "\n"
  );
}

/** Publisher validates the metadata as well as SHA256SUMS; no arbitrary asset URLs are accepted. */
export function verifyUpdateInfo(text, version, archiveName, archive) {
  assert(Buffer.byteLength(text) <= 32768);
  assert.deepEqual(JSON.parse(text), JSON.parse(createUpdateInfo(version, archiveName, archive)));
}
