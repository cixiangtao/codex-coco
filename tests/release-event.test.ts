import { expect, it } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
const exec = promisify(execFile);

it.each([
  "valid",
  "annotated-tag",
  "wrong-version",
  "wrong-root-version",
  "stable",
  "draft",
  "wrong-action",
  "wrong-ref",
  "wrong-sha",
  "outside-main",
  "moved-tag",
  "foreign-repository",
])("validates the published release against real Git ancestry: %s", async (scenario) => {
  const directory = await mkdtemp(join(tmpdir(), "codex-coco-release-event-"));
  const version = "0.1.0-preview.3";
  const tag = `v${version}`;
  const git = async (...args: string[]) =>
    (await exec("git", args, { cwd: directory })).stdout.trim();
  try {
    await git("init", "--initial-branch=main");
    await mkdir(join(directory, "apps/desktop"), { recursive: true });
    for (const file of ["package.json", "apps/desktop/package.json"])
      await writeFile(join(directory, file), JSON.stringify({ version }));
    await git("add", "package.json", "apps/desktop/package.json");
    const commit = async () =>
      git(
        "-c",
        "user.name=Fixture",
        "-c",
        "user.email=fixture@example.invalid",
        "commit",
        "--allow-empty",
        "-m",
        "fixture",
      );
    await commit();
    const main = await git("rev-parse", "HEAD");
    await commit();
    const source = await git("rev-parse", "HEAD");
    await git(
      "update-ref",
      "refs/remotes/origin/main",
      scenario === "outside-main" ? main : source,
    );
    if (scenario === "annotated-tag")
      await git(
        "-c",
        "user.name=Fixture",
        "-c",
        "user.email=fixture@example.invalid",
        "tag",
        "-a",
        tag,
        "-m",
        "fixture",
      );
    else await git("tag", tag, scenario === "moved-tag" ? main : source);
    if (scenario === "wrong-root-version")
      await writeFile(
        join(directory, "package.json"),
        JSON.stringify({ version: "0.1.0-preview.4" }),
      );
    const event = {
      action: scenario === "wrong-action" ? "edited" : "published",
      release: {
        id: 7,
        tag_name: scenario === "wrong-version" ? "v0.1.0-preview.4" : tag,
        prerelease: scenario !== "stable",
        draft: scenario === "draft",
      },
    };
    const eventFile = join(directory, "event.json");
    const output = join(directory, "environment");
    await writeFile(eventFile, JSON.stringify(event));
    const env = {
      ...process.env,
      GITHUB_ACTIONS: "true",
      GITHUB_REPOSITORY:
        scenario === "foreign-repository" ? "elsewhere/project" : "cixiangtao/codex-coco",
      GITHUB_EVENT_NAME: "release",
      GITHUB_EVENT_PATH: eventFile,
      GITHUB_REF: scenario === "wrong-ref" ? "refs/heads/main" : `refs/tags/${tag}`,
      GITHUB_SHA: scenario === "wrong-sha" ? main : source,
      GITHUB_ENV: output,
      GITHUB_RUN_ID: "12345",
      VERIFIED_RUN: "",
    };
    for (const script of ["validate-release-event.mjs", "resolve-release-source.mjs"]) {
      const request = exec(process.execPath, [resolve("scripts", script)], { cwd: directory, env });
      if (scenario === "valid" || scenario === "annotated-tag") await request;
      else await expect(request).rejects.toBeDefined();
    }
    if (scenario === "valid" || scenario === "annotated-tag") {
      const stored = await readFile(output, "utf8");
      expect(stored).toContain("CODEX_COCO_RELEASE_RUN_ID=12345");
      expect(stored).toContain(`CODEX_COCO_RELEASE_SOURCE_SHA=${source}`);
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
