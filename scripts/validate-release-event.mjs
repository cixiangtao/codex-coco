import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";
const exec = promisify(execFile);

/** Validate the exact published preview and its main-branch source before signing or upload. */
export async function validateReleaseEvent() {
  assert.equal(process.env.GITHUB_ACTIONS, "true");
  assert.equal(process.env.GITHUB_REPOSITORY, "cixiangtao/codex-coco");
  assert.equal(process.env.GITHUB_EVENT_NAME, "release");
  const event = JSON.parse(await readFile(process.env.GITHUB_EVENT_PATH, "utf8"));
  assert.equal(event.action, "published");
  const release = event.release;
  assert(Number.isSafeInteger(release.id) && release.id > 0);
  assert.equal(release.draft, false);
  assert.equal(release.prerelease, true, "Only preview releases are supported.");
  const pkg = JSON.parse(await readFile("apps/desktop/package.json", "utf8"));
  assert.match(pkg.version, /^0\.\d+\.\d+-preview\.[1-9]\d*$/);
  assert.equal(JSON.parse(await readFile("package.json", "utf8")).version, pkg.version);
  assert.equal(release.tag_name, `v${pkg.version}`);
  assert.equal(process.env.GITHUB_REF, `refs/tags/${release.tag_name}`);
  assert.match(process.env.GITHUB_SHA ?? "", /^[a-f0-9]{40}$/);
  const git = async (args) => (await exec("git", args)).stdout.trim();
  assert.equal(await git(["rev-parse", "HEAD"]), process.env.GITHUB_SHA);
  assert.equal(
    await git(["rev-parse", `${process.env.GITHUB_REF}^{commit}`]),
    process.env.GITHUB_SHA,
  );
  await git(["merge-base", "--is-ancestor", process.env.GITHUB_SHA, "refs/remotes/origin/main"]);
  return release;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await validateReleaseEvent();
  console.log("Published preview matches the checked-out tag, version and main ancestry.");
}
