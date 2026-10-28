import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { appendFile } from "node:fs/promises";
const exec = promisify(execFile);
const repository = "cixiangtao/codex-coco";
assert.equal(process.env.GITHUB_ACTIONS, "true");
assert.equal(process.env.GITHUB_REPOSITORY, repository);
assert.equal(process.env.GITHUB_REF, "refs/heads/main");
let runId = process.env.VERIFIED_RUN || process.env.GITHUB_RUN_ID;
let source = process.env.GITHUB_SHA;
assert.match(runId, /^[1-9]\d{0,14}$/);
if (process.env.VERIFIED_RUN) {
  const api = async (path) =>
    JSON.parse((await exec("gh", ["api", `repos/${repository}/${path}`])).stdout);
  const run = await api(`actions/runs/${runId}`);
  assert.equal(run.path, ".github/workflows/preview-release.yml");
  assert.equal(run.event, "workflow_dispatch");
  assert.equal(run.head_branch, "main");
  assert.equal(run.head_repository.full_name, repository);
  source = run.head_sha;
  const jobs = (await api(`actions/runs/${runId}/jobs?per_page=100`)).jobs;
  for (const name of ["build", "verify"])
    assert.equal(
      jobs.find((job) => job.name === name)?.conclusion,
      "success",
      `${name} must have passed for the source artifacts.`,
    );
  const comparison = await api(`compare/${source}...${process.env.GITHUB_SHA}`);
  assert(
    ["identical", "ahead"].includes(comparison.status),
    "Source commit must be in the current main ancestry.",
  );
}
assert.match(source, /^[a-f0-9]{40}$/);
await appendFile(
  process.env.GITHUB_ENV,
  `CODEX_COCO_RELEASE_RUN_ID=${runId}\nCODEX_COCO_RELEASE_SOURCE_SHA=${source}\n`,
);
console.log(`Release source: validated run ${runId}, commit ${source}.`);
