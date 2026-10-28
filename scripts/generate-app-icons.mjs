import { execFile } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

// Regenerate committed assets only when the editable SVG changes. No added dependencies.
if (process.platform !== "darwin") throw new Error("Icon generation requires macOS iconutil.");
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(join(root, "apps/desktop/package.json"));
const directory = await mkdtemp(join(tmpdir(), "codex-coco-icon-"));
const runner = join(directory, "render.cjs");
try {
  await writeFile(
    runner,
    `const { app, BrowserWindow, nativeImage } = require("electron");
const { readFile, writeFile, mkdir } = require("node:fs/promises");
const { join } = require("node:path");
app.setPath("userData", join(${JSON.stringify(directory)}, "data"));
app.whenReady().then(async () => {
  app.dock.hide();
  const output = process.argv[2];
  const iconset = process.argv[3];
  await mkdir(iconset, { recursive: true });
  const svg = await readFile(process.argv[4], "utf8");
  const window = new BrowserWindow({
    width: 1024, height: 1024, useContentSize: true, show: false,
    transparent: true, backgroundColor: "#00000000",
    webPreferences: { sandbox: true, contextIsolation: true, offscreen: true },
  });
  await window.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(
    '<style>html,body{margin:0;width:1024px;height:1024px;overflow:hidden;background:transparent}svg{display:block}</style>' + svg
  ));
  const captured = await window.webContents.capturePage();
  const image = nativeImage.createFromBuffer(captured.toPNG()).resize({ width: 1024, height: 1024 });
  await writeFile(join(output, "icon.png"), image.toPNG());
  for (const size of [16, 32, 128, 256, 512]) {
    for (const scale of [1, 2]) {
      const name = "icon_" + size + "x" + size + (scale === 2 ? "@2x" : "") + ".png";
      await writeFile(join(iconset, name), image.resize({ width: size * scale, height: size * scale }).toPNG());
    }
  }
  window.destroy();
  app.quit();
}).catch(() => { console.error("Icon rendering failed."); app.exit(1); });
`,
  );
  const output = join(root, "apps/desktop/resources/branding");
  const iconset = join(directory, "CodexCoco.iconset");
  const environment = { ...process.env };
  delete environment.ELECTRON_RUN_AS_NODE;
  const exec = promisify(execFile);
  await exec(
    require("electron"),
    [runner, output, iconset, join(root, "apps/desktop/src/renderer/assets/icon.svg")],
    {
      env: environment,
      timeout: 30_000,
    },
  );
  await exec("iconutil", ["-c", "icns", iconset, "-o", join(output, "icon.icns")], {
    timeout: 30_000,
  });
  console.log("Generated 1024px PNG and ten-size macOS ICNS from the original SVG.");
} finally {
  await rm(directory, { recursive: true, force: true });
}
