import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { verifyUpdateInfo } from "./release-update-info.mjs";
const exec = promisify(execFile);
const repository = "cixiangtao/codex-coco";
assert.equal(process.env.GITHUB_ACTIONS, "true");
assert.equal(process.env.GITHUB_REPOSITORY, repository);
assert.equal(process.env.GITHUB_REF, "refs/heads/main");
assert.match(process.env.GITHUB_SHA ?? "", /^[a-f0-9]{40}$/);
const sourceSha = process.env.CODEX_COCO_RELEASE_SOURCE_SHA ?? process.env.GITHUB_SHA;
assert.match(sourceSha, /^[a-f0-9]{40}$/);
const pkg = JSON.parse(await readFile("apps/desktop/package.json", "utf8"));
assert.match(pkg.version, /^0\.\d+\.\d+-preview\.[1-9]\d*$/);
assert.equal(JSON.parse(await readFile("package.json", "utf8")).version, pkg.version);
const tag = `v${pkg.version}`;
const directory = "release-artifacts";
const manifest = JSON.parse(await readFile(join(directory, "release-manifest.json"), "utf8"));
assert.equal(manifest.version, pkg.version);
assert.equal(manifest.commit, sourceSha);
assert.equal(manifest.signing, "self-signed");
assert.equal(manifest.architecture, "arm64");
assert.equal(manifest.notarized, false);
assert.equal(
  manifest.certificateSha256,
  JSON.parse(await readFile("apps/desktop/resources/signing/identity.json", "utf8")).sha256,
);
const expected = ["dmg", "zip"]
  .map((ext) => `Codex-Coco-${pkg.version}-macOS-arm64-self-signed.${ext}`)
  .concat(["release-manifest.json", "THIRD_PARTY_LICENSES.txt", "preview-mac.yml"]);
const zipName = `Codex-Coco-${pkg.version}-macOS-arm64-self-signed.zip`;
verifyUpdateInfo(
  await readFile(join(directory, "preview-mac.yml"), "utf8"),
  pkg.version,
  zipName,
  await readFile(join(directory, zipName)),
);
assert.deepEqual((await readdir(directory)).sort(), [...expected, "SHA256SUMS.txt"].sort());
const lines = (await readFile(join(directory, "SHA256SUMS.txt"), "utf8")).trim().split("\n");
assert.equal(lines.length, expected.length);
const hashes = new Map();
for (const name of expected) {
  const sum = createHash("sha256")
    .update(await readFile(join(directory, name)))
    .digest("hex");
  assert(lines.includes(`${sum}  ${name}`));
  hashes.set(name, sum);
}
hashes.set(
  "SHA256SUMS.txt",
  createHash("sha256")
    .update(await readFile(join(directory, "SHA256SUMS.txt")))
    .digest("hex"),
);
const gh = async (args) => (await exec("gh", args, { maxBuffer: 4 * 1024 * 1024 })).stdout;
const api = async (path) => {
  try {
    return JSON.parse(await gh(["api", `repos/${repository}/${path}`]));
  } catch (error) {
    if (String(error.stderr).includes("HTTP 404")) return null;
    throw error;
  }
};
const existingTag = await api(`git/ref/tags/${tag}`);
if (existingTag) {
  assert.equal(existingTag.object.type, "commit");
  assert.equal(existingTag.object.sha, sourceSha);
} else
  await gh([
    "api",
    "--method",
    "POST",
    `repos/${repository}/git/refs`,
    "-f",
    `ref=refs/tags/${tag}`,
    "-f",
    `sha=${sourceSha}`,
  ]);
// Draft releases are intentionally absent from the by-tag REST endpoint.
const findRelease = async () =>
  (await api("releases?per_page=100")).find((value) => value.tag_name === tag) ?? null;
let release = await findRelease();
if (!release) {
  await gh([
    "release",
    "create",
    tag,
    "--repo",
    repository,
    "--verify-tag",
    "--target",
    sourceSha,
    "--draft",
    "--prerelease",
    "--latest=false",
    "--title",
    `Codex Coco ${pkg.version}`,
    "--notes-file",
    `docs/releases/${pkg.version}.md`,
  ]);
  release = await findRelease();
}
assert.equal(release.prerelease, true);
for (const [name, hash] of hashes) {
  const asset = release.assets.find((item) => item.name === name);
  if (asset)
    assert.equal(
      asset.digest,
      `sha256:${hash}`,
      `Existing ${name} differs; refusing to overwrite.`,
    );
  else {
    assert.equal(
      release.draft,
      true,
      "A published release is missing assets; prepare a new preview version.",
    );
    await gh(["release", "upload", tag, join(directory, name), "--repo", repository]);
  }
}
if (release.draft)
  await gh([
    "release",
    "edit",
    tag,
    "--repo",
    repository,
    "--draft=false",
    "--prerelease",
    "--latest=false",
  ]);
const published = await findRelease();
assert.equal(published.draft, false);
assert.equal(published.prerelease, true);
for (const [name, hash] of hashes)
  assert.equal(published.assets.find((asset) => asset.name === name)?.digest, `sha256:${hash}`);
console.log(`Published ${tag} as a self-signed prerelease; stable latest remains unchanged.`);
