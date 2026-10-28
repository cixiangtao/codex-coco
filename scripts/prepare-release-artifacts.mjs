import { createHash } from "node:crypto";
import { mkdir, readFile, copyFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createUpdateInfo } from "./release-update-info.mjs";
const pkg = JSON.parse(await readFile("apps/desktop/package.json", "utf8"));
const pin = JSON.parse(await readFile("apps/desktop/resources/signing/identity.json", "utf8"));
const source = process.argv[2] ?? "apps/desktop/release";
const directory = join(source, "publish");
await mkdir(directory, { recursive: true });
const names = ["dmg", "zip"].map(
  (ext) => `Codex-Coco-${pkg.version}-macOS-arm64-self-signed.${ext}`,
);
for (const name of names) await copyFile(join(source, name), join(directory, name));
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
      signing: process.env.GITHUB_ACTIONS === "true" ? "self-signed" : "local-unsigned-test",
      certificateSha256: pin.sha256,
      notarized: false,
    },
    null,
    2,
  ) + "\n",
);
const zipName = names[1];
await writeFile(
  join(directory, "preview-mac.yml"),
  createUpdateInfo(pkg.version, zipName, await readFile(join(directory, zipName))),
);
names.push("THIRD_PARTY_LICENSES.txt", "release-manifest.json", "preview-mac.yml");
const sums = [];
for (const name of names)
  sums.push(
    `${createHash("sha256")
      .update(await readFile(join(directory, name)))
      .digest("hex")}  ${name}`,
  );
await writeFile(join(directory, "SHA256SUMS.txt"), sums.join("\n") + "\n");
console.log("Prepared DMG, ZIP, native update metadata, notices, source manifest and checksums.");
