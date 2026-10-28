import { expect, it } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createRequire } from "node:module";
import { resolve } from "node:path";
const exec = promisify(execFile);
const require = createRequire(resolve("apps/desktop/package.json"));
const { parseUpdateInfo } = require("electron-updater/out/providers/Provider");

it("produces metadata accepted by the pinned native updater and rejects mismatched files", async () => {
  const { stdout } = await exec(process.execPath, [
    "--input-type=module",
    "-e",
    `
    import assert from 'node:assert/strict';
    import {createUpdateInfo,verifyUpdateInfo} from './scripts/release-update-info.mjs';
    const bytes=Buffer.from('signed-zip-fixture');
    const version='0.1.0-preview.2';
    const name='Codex-Coco-'+version+'-macOS-arm64-self-signed.zip';
    const text=createUpdateInfo(version,name,bytes);
    verifyUpdateInfo(text,version,name,bytes);
    assert.throws(()=>verifyUpdateInfo(text,version,name,Buffer.from('tampered')));
    const data=JSON.parse(text);data.files[0].url='https://evil.invalid/file.zip';
    assert.throws(()=>verifyUpdateInfo(JSON.stringify(data),version,name,bytes));
    assert.throws(()=>verifyUpdateInfo(text,'0.1.0-preview.3',name,bytes));
    process.stdout.write(text);
  `,
  ]);
  const info = parseUpdateInfo(
    stdout,
    "preview-mac.yml",
    "https://github.com/cixiangtao/codex-coco/releases/download/v0.1.0-preview.2/",
  );
  expect(info.version).toBe("0.1.0-preview.2");
  expect(info.files[0].url).toBe("Codex-Coco-0.1.0-preview.2-macOS-arm64-self-signed.zip");
});
