import { expect, it } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
const exec = promisify(execFile);
it.each(["success", "failed-build", "foreign-repository"])(
  "validates reused release provenance: %s",
  async (scenario) => {
    const directory = await mkdtemp(join(tmpdir(), "codex-coco-release-source-"));
    const output = join(directory, "environment");
    const source = "a".repeat(40);
    const gh = `#!${process.execPath}\nconst path=process.argv[3];\nlet value;\nif(path.includes('/jobs?'))value={jobs:[{name:'build',conclusion:${JSON.stringify(scenario === "failed-build" ? "failure" : "success")}},{name:'verify',conclusion:'success'}]};\nelse if(path.includes('/compare/'))value={status:'ahead'};\nelse value={path:'.github/workflows/preview-release.yml',event:'workflow_dispatch',head_branch:'main',head_sha:${JSON.stringify(source)},head_repository:{full_name:${JSON.stringify(scenario === "foreign-repository" ? "elsewhere/project" : "cixiangtao/codex-coco")}}};\nprocess.stdout.write(JSON.stringify(value));\n`;
    await writeFile(join(directory, "gh"), gh, { mode: 0o700 });
    try {
      const request = exec(process.execPath, [resolve("scripts/resolve-release-source.mjs")], {
        env: {
          ...process.env,
          PATH: `${directory}:/usr/bin:/bin`,
          GITHUB_ACTIONS: "true",
          GITHUB_REPOSITORY: "cixiangtao/codex-coco",
          GITHUB_REF: "refs/heads/main",
          GITHUB_SHA: "b".repeat(40),
          GITHUB_ENV: output,
          VERIFIED_RUN: "12345",
        },
      });
      if (scenario === "success") {
        await request;
        expect(await readFile(output, "utf8")).toContain(`CODEX_COCO_RELEASE_SOURCE_SHA=${source}`);
      } else await expect(request).rejects.toBeDefined();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  },
);
