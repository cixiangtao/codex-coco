import { createHash } from "node:crypto";
import { mkdir, readFile, copyFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
const pkg = JSON.parse(await readFile("apps/desktop/package.json", "utf8"));
const pin = JSON.parse(await readFile("apps/desktop/resources/signing/identity.json", "utf8"));
const directory = "apps/desktop/release/publish";
await mkdir(directory, { recursive: true });
const names = ["dmg", "zip"].map(
  (ext) => `Codex-Coco-${pkg.version}-macOS-arm64-self-signed.${ext}`,
);
for (const name of names) await copyFile(join("apps/desktop/release", name), join(directory, name));
await copyFile(
  "work/release/THIRD_PARTY_LICENSES.txt",
  join(directory, "THIRD_PARTY_LICENSES.txt"),
);
await writeFile(
  join(directory, "release-manifest.json"),
  JSON.stringify(
    {
      version: pkg.version,
      commit: process.env.GITHUB_SHA,
      architecture: "arm64",
      signing: "self-signed",
      certificateSha256: pin.sha256,
      notarized: false,
    },
    null,
    2,
  ) + "\n",
);
names.push("THIRD_PARTY_LICENSES.txt", "release-manifest.json");
const sums = [];
for (const name of names)
  sums.push(
    `${createHash("sha256")
      .update(await readFile(join(directory, name)))
      .digest("hex")}  ${name}`,
  );
await writeFile(join(directory, "SHA256SUMS.txt"), sums.join("\n") + "\n");
console.log("Prepared DMG, ZIP, notices, source manifest and SHA-256 checksums.");
