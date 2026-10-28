import { expect, it } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
const exec = promisify(execFile);

it("publishes using the create response and resource ID even when the release list stays stale", async () => {
  const directory = await mkdtemp(join(tmpdir(), "codex-coco-publisher-"));
  const version = "0.1.0-preview.2";
  const source = "a".repeat(40);
  const state = join(directory, "state.json");
  const calls = join(directory, "calls.jsonl");
  try {
    await mkdir(join(directory, "apps/desktop/resources/signing"), { recursive: true });
    await mkdir(join(directory, "docs/releases"), { recursive: true });
    await mkdir(join(directory, "release-artifacts"));
    for (const file of ["package.json", "apps/desktop/package.json"])
      await writeFile(join(directory, file), JSON.stringify({ version }));
    await writeFile(
      join(directory, "apps/desktop/resources/signing/identity.json"),
      JSON.stringify({ sha256: "public-pin" }),
    );
    await writeFile(join(directory, `docs/releases/${version}.md`), "Public release notes\n");
    const zip = `Codex-Coco-${version}-macOS-arm64-self-signed.zip`;
    const bytes = Buffer.from("signed-archive-fixture");
    const sha512 = createHash("sha512").update(bytes).digest("base64");
    const assets: Record<string, Buffer> = {
      [zip]: bytes,
      [zip.replace(/zip$/, "dmg")]: Buffer.from("dmg-fixture"),
      "THIRD_PARTY_LICENSES.txt": Buffer.from("Fixture notices"),
      "preview-mac.yml": Buffer.from(
        JSON.stringify({
          version,
          files: [{ url: zip, sha512, size: bytes.length }],
          path: zip,
          sha512,
        }),
      ),
      "release-manifest.json": Buffer.from(
        JSON.stringify({
          version,
          commit: source,
          signing: "self-signed",
          architecture: "arm64",
          notarized: false,
          certificateSha256: "public-pin",
        }),
      ),
    };
    for (const [name, data] of Object.entries(assets))
      await writeFile(join(directory, "release-artifacts", name), data);
    await writeFile(
      join(directory, "release-artifacts/SHA256SUMS.txt"),
      Object.entries(assets)
        .map(([name, data]) => `${createHash("sha256").update(data).digest("hex")}  ${name}`)
        .join("\n") + "\n",
    );
    const gh = `#!${process.execPath}
const fs=require('node:fs');const path=require('node:path');const crypto=require('node:crypto');
const args=process.argv.slice(2), state=${JSON.stringify(state)}, calls=${JSON.stringify(calls)};
fs.appendFileSync(calls,JSON.stringify(args)+'\\n');
let result;const resource=args.find(value=>value.startsWith('repos/'));
if(args[0]==='api'&&resource.includes('git/ref/')) result={object:{type:'commit',sha:${JSON.stringify(source)}}};
else if(args[0]==='api'&&resource.includes('releases?'))result=[];
else if(args[0]==='api'&&args.includes('POST')) {result={id:7,draft:true,prerelease:true,assets:[]};fs.writeFileSync(state,JSON.stringify(result));}
else if(args[0]==='api'&&resource.endsWith('/releases/7'))result=JSON.parse(fs.readFileSync(state,'utf8'));
else if(args[0]==='release'&&args[1]==='upload') {result=JSON.parse(fs.readFileSync(state,'utf8'));result.assets.push({name:path.basename(args[3]),digest:'sha256:'+crypto.createHash('sha256').update(fs.readFileSync(args[3])).digest('hex')});fs.writeFileSync(state,JSON.stringify(result));}
else if(args[0]==='release'&&args[1]==='edit') {result=JSON.parse(fs.readFileSync(state,'utf8'));result.draft=false;fs.writeFileSync(state,JSON.stringify(result));}
else throw new Error('Unexpected gh operation');
process.stdout.write(JSON.stringify(result));
`;
    await writeFile(join(directory, "gh"), gh, { mode: 0o700 });
    await exec(process.execPath, [resolve("scripts/publish-preview.mjs")], {
      cwd: directory,
      env: {
        ...process.env,
        PATH: `${directory}:/usr/bin:/bin`,
        GH_TOKEN: "fixture",
        GITHUB_ACTIONS: "true",
        GITHUB_REPOSITORY: "cixiangtao/codex-coco",
        GITHUB_REF: "refs/heads/main",
        GITHUB_SHA: source,
        CODEX_COCO_RELEASE_SOURCE_SHA: source,
      },
    });
    const published = JSON.parse(await readFile(state, "utf8"));
    expect(published.draft).toBe(false);
    expect(published.assets).toHaveLength(6);
    const trace = (await readFile(calls, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as string[]);
    expect(trace.filter((args) => args.some((value) => value.includes("releases?")))).toHaveLength(
      1,
    );
    expect(trace.at(-1)).toEqual(["api", "repos/cixiangtao/codex-coco/releases/7"]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
