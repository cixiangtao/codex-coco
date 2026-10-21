import assert from "node:assert/strict";
import { mkdtemp, writeFile, mkdir, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { createServer } from "node:net";
import { createDesktopSession } from "./verify-desktop.mjs";
const root = fileURLToPath(new URL("../", import.meta.url));
const { _electron } = createRequire(import.meta.url)("playwright");
const electron = createRequire(join(root, "apps/desktop/package.json"))("electron");
const directory = await mkdtemp(join(tmpdir(), "codex-coco-appearance-desktop-"));
const packaged = process.argv.includes("--packaged");
const output = join(
  root,
  packaged ? "work/appearance-verification-packaged" : "work/appearance-verification",
);
await mkdir(output, { recursive: true });
const server = createServer();
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const port = server.address().port;
await new Promise((resolve) => server.close(resolve));
const fixture = join(directory, "target.cjs");
const image = join(directory, "picture.png");
await writeFile(
  image,
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jGv8AAAAASUVORK5CYII=",
    "base64",
  ),
);
await writeFile(
  fixture,
  `const {app, BrowserWindow, protocol} = require('electron');
app.setName('Codex Coco Appearance Test Target'); app.setPath('userData', ${JSON.stringify(join(directory, "target-data"))});
app.commandLine.appendSwitch('remote-debugging-port', ${JSON.stringify(String(port))});
protocol.registerSchemesAsPrivileged([{scheme:'app',privileges:{standard:true,secure:true,supportFetchAPI:true}}]);
app.whenReady().then(async () => { protocol.handle('app', () => new Response('<!doctype html><html data-codex-window-type="electron" style="--codex-base-surface:#fff"><head><title>Controlled Codex surface</title></head><body style="margin:0"><aside class="app-shell-left-panel" style="width:180px;height:600px;float:left">Sidebar</aside><main data-app-shell-main-surface style="margin-left:180px;height:600px">Controlled main surface</main></body></html>', {headers:{'content-type':'text/html'}})); const w = new BrowserWindow({width:900,height:700,webPreferences:{nodeIntegration:false,contextIsolation:true}}); await w.loadURL('app://-/index.html'); });`,
);
let target, session;
async function operation(page, name, input = {}) {
  const response = await page.evaluate(
    ({ name, input }) =>
      window.codexCoco.runModuleOperation({ moduleId: "appearance", operation: name, input }),
    { name, input },
  );
  assert.equal(response.ok, true);
  const id = response.value.operation.id;
  let result;
  const deadline = Date.now() + 15_000;
  do {
    result = await page.evaluate(
      async () =>
        (await window.codexCoco.modules()).value.find((m) => m.id === "appearance").operation,
    );
    if (result?.id === id && ["succeeded", "failed", "cancelled"].includes(result.phase)) break;
    await delay(40);
  } while (Date.now() < deadline);
  assert.equal(result.phase, "succeeded");
  return result.result;
}
try {
  const environment = { ...process.env };
  delete environment.ELECTRON_RUN_AS_NODE;
  target = await _electron.launch({ executablePath: electron, args: [fixture], env: environment });
  const targetPage = await target.firstWindow();
  await targetPage.waitForURL("app://-/index.html");
  session = await createDesktopSession(
    join(directory, "data"),
    { ...process.env, CODEX_COCO_FIXTURES: "0" },
    packaged
      ? join(root, "apps/desktop/release/mac-arm64/Codex Coco.app/Contents/MacOS/Codex Coco")
      : undefined,
  );
  const { page, application, errors } = session;
  await page.getByRole("button", { name: "启用外观模块", exact: true }).click();
  await page.waitForFunction(
    async () =>
      (await window.codexCoco.modules()).value.find((m) => m.id === "appearance").phase ===
      "running",
  );
  await application.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] });
  }, image);
  const library = await operation(page, "list-gallery");
  assert.equal(library.gallery.length, 8);
  assert(library.gallery.every((item) => item.preview.startsWith("data:image/jpeg;base64,")));
  assert(!JSON.stringify(library).includes(directory));
  await page
    .getByRole("button")
    .filter({ has: page.getByAltText(library.gallery[0].title, { exact: true }) })
    .click();
  const drag = page.getByRole("slider", { name: "主面板插画拖动定位", exact: true });
  await drag.focus();
  await drag.press("ArrowLeft");
  assert.equal(await page.locator("#main-x").inputValue(), "81");
  await page.getByRole("textbox", { name: "预设名称", exact: true }).fill("受控布景预设");
  await page.getByRole("button", { name: "保存为预设", exact: true }).click();
  await page.getByRole("button", { name: "仅保存配置", exact: true }).click();
  await page.getByText("布景配置已保存。", { exact: true }).waitFor();
  assert.equal(
    (
      await page.evaluate(
        async () =>
          (await window.codexCoco.modules()).value.find((m) => m.id === "appearance").config.value
            .presets,
      )
    ).length,
    1,
  );
  const imported = await operation(page, "import-image");
  assert(imported.imported);
  assert(!JSON.stringify(imported).includes(directory));
  const updated = await page.evaluate(
    async ({ port, image }) => {
      const snapshot = (await window.codexCoco.modules()).value.find((m) => m.id === "appearance");
      const config = snapshot.config.value;
      config.port = port;
      for (const layer of ["main", "sidebar", "wallpaper"])
        config[layer] = { ...config[layer], enabled: true, image };
      return window.codexCoco.saveModuleConfig({
        moduleId: "appearance",
        expectedRevision: snapshot.config.revision,
        value: config,
      });
    },
    { port, image: imported.imported },
  );
  assert.equal(updated.ok, true);
  assert.equal((await operation(page, "inspect")).targets, 1);
  assert.equal((await operation(page, "apply")).active, true);
  assert.equal((await operation(page, "verify")).targets, 1);
  assert.equal(await targetPage.locator("#codex-coco-appearance").count(), 1);
  const pointer = await targetPage
    .locator("main")
    .evaluate((e) => getComputedStyle(e, "::before").pointerEvents);
  assert.equal(pointer, "none");
  await targetPage.reload();
  await targetPage.locator("#codex-coco-appearance").waitFor({ state: "attached", timeout: 8000 });
  const nextEvent = target.waitForEvent("window");
  await target.evaluate(async ({ BrowserWindow }) => {
    const w = new BrowserWindow({ show: false });
    await w.loadURL("app://-/index.html?second=1");
  });
  const second = await nextEvent;
  await second.locator("#codex-coco-appearance").waitFor({ state: "attached", timeout: 8000 });
  await page.screenshot({
    path: join(output, "settings.png"),
    scale: "css",
    animations: "disabled",
  });
  await targetPage.screenshot({
    path: join(output, "applied.png"),
    scale: "css",
    animations: "disabled",
  });
  const remove = await operation(page, "remove");
  assert.equal(remove.active, false);
  for (const w of [targetPage, second])
    assert.equal(await w.locator("#codex-coco-appearance").count(), 0);
  await operation(page, "apply");
  const disabled = await page.evaluate(() =>
    window.codexCoco.enableModule({ moduleId: "appearance", enabled: false }),
  );
  assert.equal(disabled.ok, true);
  for (const w of [targetPage, second])
    assert.equal(await w.locator("#codex-coco-appearance").count(), 0);
  assert.deepEqual(errors, []);
  await page.evaluate(() =>
    window.codexCoco.enableModule({ moduleId: "appearance", enabled: true }),
  );
  await page.evaluate(async () => {
    const snapshot = (await window.codexCoco.modules()).value.find((m) => m.id === "appearance");
    return window.codexCoco.saveModuleConfig({
      moduleId: "appearance",
      expectedRevision: snapshot.config.revision,
      value: { ...snapshot.config.value, restoreOnEnable: true },
    });
  });
  await operation(page, "apply");
  await session.application.close();
  assert.equal(await targetPage.locator("#codex-coco-appearance").count(), 0);
  session = await createDesktopSession(
    join(directory, "data"),
    { ...process.env, CODEX_COCO_FIXTURES: "0" },
    packaged
      ? join(root, "apps/desktop/release/mac-arm64/Codex Coco.app/Contents/MacOS/Codex Coco")
      : undefined,
  );
  await targetPage.locator("#codex-coco-appearance").waitFor({ state: "attached", timeout: 10000 });
  assert.deepEqual(session.errors, []);
  console.log(
    JSON.stringify(
      {
        ok: true,
        packaged,
        controlledTargetOnly: true,
        layers: 3,
        gallery: true,
        keyboardPositioning: true,
        namedPresets: true,
        computedStyleVerification: true,
        optInRestartRestoration: true,
        reload: true,
        newWindow: true,
        revoke: true,
        disableCleanup: true,
        errors,
      },
      null,
      2,
    ),
  );
} finally {
  await session?.application.close();
  await target?.close();
  await rm(directory, { recursive: true, force: true });
}
