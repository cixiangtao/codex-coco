import assert from "node:assert/strict";
import { mkdtemp, writeFile, mkdir, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { createServer } from "node:net";
import { rgbaPng } from "../apps/desktop/src/application/png.ts";
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
const pixels = new Uint8Array(100 * 50 * 4);
for (let y = 0; y < 50; y++)
  for (let x = 0; x < 100; x++)
    pixels.set(x < 50 ? [230, 40, 60, 255] : [240, 190, 30, 255], (y * 100 + x) * 4);
pixels[3] = 0;
await writeFile(image, rgbaPng(100, 50, pixels));
// Authored fixture models current stable data attributes and an older fallback layout.
const fixtureHtml = `<!doctype html><html data-codex-window-type="electron" style="--color-surface:#fff;--app-color-background-shell:#ddd"><head><title>Controlled Codex surface</title><style>
html,body{margin:0;height:100%;font:14px sans-serif}#shell{position:fixed;inset:0;background:var(--app-color-background-shell)}
header{height:40px}#workspace{position:absolute;inset:40px 0 0;display:flex;background:white}
#rail{width:48px;flex:none}#sidebar{position:relative;width:260px;flex:none;background:#eee}
main{position:relative;flex:1;min-width:0;height:100%;background:var(--color-surface)}
#viewport{position:absolute;inset:0;background:var(--color-surface);overflow:auto}.long{height:1400px;padding:12px}
main::before{content:'client decoration';position:absolute;right:10px;top:12px;color:#777;pointer-events:none}
</style></head><body><div id="shell" data-app-shell-frame data-app-shell-page-surface="true"><header>Controlled titlebar</header><div id="workspace" data-app-shell-workspace-row><nav id="rail">Rail</nav><aside id="sidebar" data-slate-sidebar-content class="sidebar-navigation">Sidebar</aside><main data-app-shell-main-surface="default"><div id="viewport" data-app-shell-main-content-layout="default"><div class="long"><button onclick="this.textContent='Clicked'">Test action</button></div></div></main></div></div></body></html>`;
await writeFile(
  fixture,
  `const {app, BrowserWindow, protocol} = require('electron');
app.setName('Codex Coco Appearance Test Target'); app.setPath('userData', ${JSON.stringify(join(directory, "target-data"))});
app.commandLine.appendSwitch('remote-debugging-port', ${JSON.stringify(String(port))});
protocol.registerSchemesAsPrivileged([{scheme:'app',privileges:{standard:true,secure:true,supportFetchAPI:true}}]);
app.whenReady().then(async () => { protocol.handle('app', () => new Response(${JSON.stringify(fixtureHtml)}, {headers:{'content-type':'text/html'}})); const w = new BrowserWindow({width:1000,height:720,webPreferences:{nodeIntegration:false,contextIsolation:true}}); await w.loadURL('app://-/index.html'); });`,
);
let target, session;
async function operation(page, name, input = {}) {
  let response;
  const start = Date.now();
  do {
    response = await page.evaluate(
      ({ name, input }) =>
        window.codexCoco.runModuleOperation({ moduleId: "appearance", operation: name, input }),
      { name, input },
    );
    if (!response.ok) await delay(100);
  } while (!response.ok && Date.now() - start < 5000);
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
async function configure(page, update) {
  const response = await page.evaluate(async (update) => {
    const snapshot = (await window.codexCoco.modules()).value.find((m) => m.id === "appearance");
    const value = snapshot.config.value;
    for (const [key, patch] of Object.entries(update)) value[key] = { ...value[key], ...patch };
    return window.codexCoco.saveModuleConfig({
      moduleId: "appearance",
      expectedRevision: snapshot.config.revision,
      value,
    });
  }, update);
  assert.equal(response.ok, true);
  const result = await operation(page, "apply");
  assert.equal(result.status, "ready", JSON.stringify(result));
  return result;
}
async function verifyQuietMaintenance(page, targetPage) {
  await page.getByAltText("主面板插画图片预览", { exact: true }).waitFor();
  await page.waitForFunction(async () => {
    const snapshot = (await window.codexCoco.modules()).value.find((m) => m.id === "appearance");
    return !["running", "cancelling"].includes(snapshot.operation?.phase);
  });
  await targetPage.evaluate(() => {
    const original = document.getElementById.bind(document);
    window.maintenanceChecks = 0;
    document.getElementById = (id) => {
      if (id === "codex-coco-appearance") window.maintenanceChecks++;
      return original(id);
    };
    window.restoreLookup = () => {
      document.getElementById = original;
    };
  });
  await page.evaluate(() => {
    const footer = document.querySelector(".appearance-save-bar");
    window.maintenanceEvents = 0;
    window.maintenanceMutations = 0;
    window.stopMaintenanceEvents = window.codexCoco.onModuleChanged((snapshot) => {
      if (snapshot.id === "appearance") window.maintenanceEvents++;
    });
    window.maintenanceObserver = new MutationObserver((records) => {
      window.maintenanceMutations += records.length;
    });
    window.maintenanceObserver.observe(footer, {
      subtree: true,
      attributes: true,
      childList: true,
      characterData: true,
    });
  });
  // Observe at least two real scheduled CDP checks, not just a static screenshot between them.
  await targetPage.waitForFunction(() => window.maintenanceChecks >= 2, undefined, {
    timeout: 12000,
  });
  await delay(150);
  const quiet = await page.evaluate(() => {
    window.stopMaintenanceEvents();
    window.maintenanceObserver.disconnect();
    return { events: window.maintenanceEvents, mutations: window.maintenanceMutations };
  });
  await targetPage.evaluate(() => window.restoreLookup());
  assert.deepEqual(quiet, { events: 0, mutations: 0 });
  assert.equal(
    await page.getByRole("button", { name: "保存并应用布景", exact: true }).isEnabled(),
    true,
  );
  await page
    .getByText("已应用到 1 个 Codex 窗口，停用模块或退出时撤销。", { exact: true })
    .waitFor();
  await page.screenshot({ path: join(output, "quiet-maintenance.png"), scale: "css" });
  // Genuine maintenance failures and recovery must still reach the page.
  await targetPage.evaluate(() => {
    delete document.documentElement.dataset.codexWindowType;
  });
  await page.waitForFunction(
    async () => {
      const state = (await window.codexCoco.modules()).value.find(
        (m) => m.id === "appearance",
      ).state;
      return state.status === "error" && !state.active;
    },
    undefined,
    { timeout: 10000 },
  );
  await page.getByText("布景应用未完成，请检查连接后重试或撤销。", { exact: true }).waitFor();
  await targetPage.evaluate(() => {
    document.documentElement.dataset.codexWindowType = "electron";
  });
  await page
    .getByText("已应用到 1 个 Codex 窗口，停用模块或退出时撤销。", { exact: true })
    .waitFor({ timeout: 15000 });
}
async function verifyEditorUi(page, application, targetPage) {
  const capture = async (name) => {
    await page.locator(".desktop-content").evaluate((node) => {
      node.scrollTop = 0;
    });
    assert(
      await page.evaluate(() => {
        const node = document.querySelector(".desktop-content");
        return node.scrollWidth <= node.clientWidth;
      }),
      "Appearance content must not overflow horizontally",
    );
    await page.screenshot({
      path: join(output, `${name}.png`),
      scale: "css",
      animations: "disabled",
    });
  };
  const tabs = page.getByRole("tab");
  const layer = page.getByLabel("预览定位图层", { exact: true });
  await page.locator("#main-x").focus();
  await page.locator("#main-x").press("ArrowRight");
  assert.equal(await page.locator("#main-x").inputValue(), "61");
  // Keep editing while a native picker is pending; import completion must merge into the latest draft.
  await application.evaluate(({ dialog }) => {
    globalThis.restoreImagePicker = dialog.showOpenDialog;
    dialog.showOpenDialog = () =>
      new Promise((resolve) => {
        globalThis.finishImagePicker = resolve;
      });
  });
  await page.getByRole("button", { name: "导入主面板插画", exact: true }).click();
  await page.waitForFunction(
    async () =>
      (await window.codexCoco.modules()).value.find((m) => m.id === "appearance").operation
        ?.name === "import-image",
  );
  await page.locator("#main-x").press("ArrowRight");
  assert.equal(await page.locator("#main-x").inputValue(), "62");
  await application.evaluate(({ dialog }, path) => {
    globalThis.finishImagePicker({ canceled: false, filePaths: [path] });
    dialog.showOpenDialog = globalThis.restoreImagePicker;
  }, image);
  await page
    .getByRole("button", { name: "导入主面板插画", exact: true })
    .waitFor({ state: "visible" });
  await page.waitForFunction(
    async () =>
      (await window.codexCoco.modules()).value.find((m) => m.id === "appearance").operation
        ?.phase === "succeeded",
  );
  assert.equal(
    await page.locator("#main-x").inputValue(),
    "62",
    "Import must preserve intervening edits",
  );
  await layer.getByRole("button", { name: "全局壁纸", exact: true }).click();
  assert.equal(await page.locator("#wallpaper-x").inputValue(), "50");
  await layer.getByRole("button", { name: "侧栏插画", exact: true }).click();
  await page.locator("#sidebar-y").focus();
  await page.locator("#sidebar-y").press("ArrowRight");
  assert.equal(await page.locator("#sidebar-y").inputValue(), "81");
  await tabs.filter({ hasText: "图片与预设" }).click();
  await page.getByRole("textbox", { name: "预设名称", exact: true }).fill("尚未保存的名称");
  await capture("library-light");
  await tabs.filter({ hasText: "连接设置" }).click();
  await page.getByRole("button", { name: "明确重启所选应用", exact: true }).waitFor();
  await capture("connection-light");
  await tabs.filter({ hasText: "图片与预设" }).click();
  assert.equal(
    await page.getByRole("textbox", { name: "预设名称", exact: true }).inputValue(),
    "尚未保存的名称",
  );
  await tabs.filter({ hasText: "布景编辑" }).click();
  assert.equal(await page.locator("#sidebar-y").inputValue(), "81");
  await layer.getByRole("button", { name: "主面板插画", exact: true }).click();
  assert.equal(await page.locator("#main-x").inputValue(), "62");
  assert.equal(
    await targetPage.locator("#codex-coco-appearance").count(),
    0,
    "Tab and layer changes never apply to the target",
  );
  await capture("editor-light");
  const window = await application.browserWindow(page);
  await window.evaluate((window) => window.setSize(720, 640));
  await page.waitForFunction(() => innerWidth === 720);
  await capture("editor-compact");
  await window.evaluate((window) => window.setSize(980, 800));
  const nav = page.getByRole("navigation", { name: "应用导航" });
  await nav.getByRole("button", { name: "设置", exact: true }).click();
  await page.getByRole("button", { name: "深色", exact: true }).click();
  await page.getByRole("button", { name: "保存主题", exact: true }).click();
  await nav.getByRole("button", { name: "外观", exact: true }).click();
  await capture("editor-dark");
  await page.getByRole("button", { name: "放弃修改", exact: true }).click();
  assert.equal(await page.locator("#main-x").inputValue(), "60");
  await layer.getByRole("button", { name: "侧栏插画", exact: true }).click();
  assert.equal(await page.locator("#sidebar-y").inputValue(), "80");
  await layer.getByRole("button", { name: "主面板插画", exact: true }).click();
  await tabs.filter({ hasText: "连接设置" }).click();
  await page.getByRole("button", { name: "明确重启所选应用", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "取消", exact: true }).click();
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  await tabs.filter({ hasText: "布景编辑" }).click();
  await nav.getByRole("button", { name: "设置", exact: true }).click();
  await page.getByRole("button", { name: "浅色", exact: true }).click();
  await page.getByRole("button", { name: "保存主题", exact: true }).click();
  await nav.getByRole("button", { name: "外观", exact: true }).click();
}
function expectPixel(actual, expected) {
  assert(
    actual.every((channel, index) => Math.abs(channel - expected[index]) <= 2),
    `Pixel ${actual} does not match ${expected}`,
  );
}
async function pixel(target, targetPage, x, y) {
  const screenshot = await targetPage.screenshot({ scale: "css", animations: "disabled" });
  return target.evaluate(
    ({ nativeImage }, { png, x, y }) => {
      const image = nativeImage.createFromBuffer(Buffer.from(png, "base64"));
      const size = image.getSize();
      const bitmap = image.toBitmap();
      const offset = (Math.floor(y) * size.width + Math.floor(x)) * 4;
      return [bitmap[offset + 2], bitmap[offset + 1], bitmap[offset], bitmap[offset + 3]];
    },
    { png: screenshot.toString("base64"), x, y },
  );
}
async function verifyLayout(page, targetPage, target, image, output) {
  await configure(page, {
    wallpaper: { enabled: false },
    main: { enabled: true, image, size: 200, x: 0, y: 0, opacity: 1, blur: 0 },
    sidebar: { enabled: true, image, size: 140, x: 100, y: 100, opacity: 1, blur: 0 },
  });
  let main = await targetPage.locator("main").boundingBox(),
    sidebar = await targetPage.locator("#sidebar").boundingBox();
  expectPixel(await pixel(target, targetPage, main.x + 30, main.y + 60), [230, 40, 60, 255]);
  expectPixel(await pixel(target, targetPage, main.x + 170, main.y + 60), [240, 190, 30, 255]);
  expectPixel(
    await pixel(
      target,
      targetPage,
      sidebar.x + sidebar.width - 25,
      sidebar.y + sidebar.height - 25,
    ),
    [240, 190, 30, 255],
  );
  await targetPage.locator("#viewport").evaluate((e) => {
    e.scrollTop = 700;
  });
  expectPixel(await pixel(target, targetPage, main.x + 30, main.y + 60), [230, 40, 60, 255]);
  await configure(page, { main: { size: 1200, x: 100, y: 100 } });
  expectPixel(
    await pixel(target, targetPage, main.x + main.width - 20, main.y + main.height - 20),
    [240, 190, 30, 255],
  );
  await target.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0].setSize(1100, 800);
  });
  assert.equal((await operation(page, "verify")).status, "ready");
  await target.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(1.25);
  });
  assert.equal((await operation(page, "verify")).status, "ready");
  await target.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(1);
  });
  await configure(page, {
    main: { enabled: false },
    sidebar: { enabled: false },
    wallpaper: { enabled: true, image, fit: "contain", x: 50, y: 50, transparency: 1 },
  });
  expectPixel(await pixel(target, targetPage, 400, 300), [230, 40, 60, 255]);
  await configure(page, { wallpaper: { fit: "contain", y: 100 } });
  expectPixel(await pixel(target, targetPage, 400, 80), [255, 255, 255, 255]);
  await configure(page, { wallpaper: { fit: "cover" } });
  expectPixel(await pixel(target, targetPage, 400, 80), [230, 40, 60, 255]);
  await configure(page, { wallpaper: { transparency: 0 } });
  expectPixel(await pixel(target, targetPage, 400, 300), [255, 255, 255, 255]);
  await configure(page, {
    main: { enabled: true, size: 200, x: 0, y: 0 },
    sidebar: { enabled: true },
    wallpaper: { transparency: 0.5 },
  });
  // Same attributes can be replaced by client navigation without duplicate layers.
  await targetPage.locator("#viewport").evaluate((e) => {
    e.replaceWith(e.cloneNode(true));
  });
  await targetPage.locator('[data-codex-coco-surface="main"]').waitFor({ state: "attached" });
  assert.equal((await operation(page, "verify")).status, "ready");
  assert.equal(await targetPage.locator('[data-codex-coco-surface="main"]').count(), 1);
  await targetPage.screenshot({ path: join(output, "modern-layout.png"), scale: "css" });
  // Missing requested surfaces must fail validation, while revoke remains available.
  await targetPage.locator("#sidebar").evaluate((e) => {
    e.removeAttribute("data-slate-sidebar-content");
  });
  assert.equal((await operation(page, "apply")).status, "error");
  assert.equal((await operation(page, "remove")).status, "ready");
  // The old sidebar class remains a fallback; absolute positioning must survive injection.
  await targetPage.locator("#sidebar").evaluate((e) => {
    e.removeAttribute("data-slate-sidebar-content");
    e.className = "app-shell-left-panel";
  });
  assert.equal((await operation(page, "apply")).status, "ready");
  assert.equal(
    await targetPage.locator("main").evaluate((e) => getComputedStyle(e).position),
    "relative",
  );
  assert.equal((await operation(page, "verify")).status, "ready");
  await targetPage.locator("main").evaluate((e) => {
    e.style.position = "absolute";
    e.style.inset = "0 0 0 308px";
  });
  await operation(page, "apply");
  assert.equal(
    await targetPage.locator("main").evaluate((e) => getComputedStyle(e).position),
    "absolute",
  );
  assert.equal((await operation(page, "verify")).status, "ready");
  await operation(page, "remove");
  assert.equal(
    await targetPage.locator("main").evaluate((e) => getComputedStyle(e).position),
    "absolute",
  );
  await operation(page, "apply");
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
  assert(library.gallery.every((item) => item.preview.startsWith("data:image/png;base64,")));
  assert(!JSON.stringify(library).includes(directory));
  await page.getByRole("tab", { name: "图片与预设", exact: true }).click();
  await page
    .getByRole("button")
    .filter({ has: page.getByAltText(library.gallery[0].title, { exact: true }) })
    .click();
  await page.getByRole("tab", { name: "布景编辑", exact: true }).click();
  const drag = page.getByRole("slider", { name: "主面板插画拖动定位", exact: true });
  await drag.focus();
  await drag.press("ArrowLeft");
  assert.equal(await page.locator("#main-x").inputValue(), "81");
  for (const axis of ["x", "y"]) {
    const range = page.locator(`#main-${axis}`);
    await range.focus();
    await range.press("Home");
    for (let i = 0; i < 20; i++) await range.press("ArrowRight");
  }
  await drag.scrollIntoViewIfNeeded();
  const dragBounds = await page.locator('[data-preview-surface="main"]').boundingBox();
  assert(dragBounds);
  await page.mouse.move(
    dragBounds.x + dragBounds.width * 0.3,
    dragBounds.y + dragBounds.height * 0.3,
  );
  await page.mouse.down();
  await page.mouse.move(
    dragBounds.x + dragBounds.width * 0.7,
    dragBounds.y + dragBounds.height * 0.6,
  );
  await page.mouse.up();
  assert.equal(await page.locator("#main-x").inputValue(), "60");
  assert.equal(await page.locator("#main-y").inputValue(), "50");
  await page.mouse.click(
    dragBounds.x + dragBounds.width * 0.2,
    dragBounds.y + dragBounds.height * 0.2,
  );
  assert.equal(await page.locator("#main-x").inputValue(), "60");
  const sideBounds = await page.locator('[data-preview-surface="sidebar"]').boundingBox();
  await page.mouse.move(sideBounds.x + 10, sideBounds.y + 10);
  await page.mouse.down();
  await page.mouse.move(sideBounds.x + 30, sideBounds.y + 30);
  await page.mouse.up();
  assert.equal(await page.locator("#main-x").inputValue(), "60");
  await page.getByRole("tab", { name: "图片与预设", exact: true }).click();
  await page.getByRole("textbox", { name: "预设名称", exact: true }).fill("受控布景预设");
  await page.getByRole("button", { name: "保存为预设", exact: true }).click();
  await page.getByRole("button", { name: "仅保存配置", exact: true }).click();
  await page.getByText("布景配置已保存。", { exact: true }).waitFor();
  await page.getByRole("tab", { name: "布景编辑", exact: true }).click();
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
  await verifyEditorUi(page, application, targetPage);
  const imported = await operation(page, "import-image");
  assert(imported.imported);
  const previewDimensions = await target.evaluate(
    ({ nativeImage }, preview) => nativeImage.createFromDataURL(preview).getSize(),
    imported.preview,
  );
  assert.equal(previewDimensions.width / previewDimensions.height, 2);
  assert.equal(
    await target.evaluate(
      ({ nativeImage }, preview) => nativeImage.createFromDataURL(preview).toBitmap()[3],
      imported.preview,
    ),
    0,
  );
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
  await verifyQuietMaintenance(page, targetPage);
  assert.equal(await targetPage.locator("#codex-coco-appearance").count(), 1);
  const pointer = await targetPage
    .locator('[data-codex-coco-surface="main"]')
    .evaluate((e) => getComputedStyle(e).pointerEvents);
  assert.equal(pointer, "none");
  await targetPage
    .locator('[data-codex-coco-surface="main"]')
    .evaluate((e) => e.style.setProperty("background-size", "1px", "important"));
  assert.equal((await operation(page, "verify")).status, "error");
  assert.equal((await operation(page, "apply")).status, "ready");
  assert.equal(await targetPage.locator("[data-codex-coco-surface]").count(), 3);
  assert.equal(
    await targetPage.locator("main").evaluate((e) => getComputedStyle(e, "::before").content),
    '"client decoration"',
  );
  await targetPage.getByRole("button", { name: "Test action", exact: true }).click();
  await targetPage.getByRole("button", { name: "Clicked", exact: true }).waitFor();
  await verifyLayout(page, targetPage, target, imported.imported, output);
  await targetPage.reload();
  await targetPage.locator("#codex-coco-appearance").waitFor({ state: "attached", timeout: 8000 });
  const nextEvent = target.waitForEvent("window");
  await target.evaluate(async ({ BrowserWindow }) => {
    const w = new BrowserWindow({ show: false });
    await w.loadURL("app://-/index.html?second=1");
  });
  const second = await nextEvent;
  await second.locator("#codex-coco-appearance").waitFor({ state: "attached", timeout: 8000 });
  await page
    .getByText("已应用到 2 个 Codex 窗口，停用模块或退出时撤销。", { exact: true })
    .waitFor();
  await page.getByRole("region", { name: "布景交互预览", exact: true }).scrollIntoViewIfNeeded();
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
  // Turning every layer off is an explicit removal, including DOM markers.
  await page.evaluate(async () => {
    const snapshot = (await window.codexCoco.modules()).value.find((m) => m.id === "appearance");
    const value = snapshot.config.value;
    for (const layer of ["wallpaper", "main", "sidebar"]) value[layer].enabled = false;
    return window.codexCoco.saveModuleConfig({
      moduleId: "appearance",
      expectedRevision: snapshot.config.revision,
      value,
    });
  });
  assert.equal((await operation(page, "apply")).active, false);
  assert.equal(
    await targetPage
      .locator(
        "[data-codex-coco-surface],[data-codex-coco-host],[data-codex-coco-clear],[data-codex-coco-paper]",
      )
      .count(),
    0,
  );
  await page.evaluate(async () => {
    const snapshot = (await window.codexCoco.modules()).value.find((m) => m.id === "appearance");
    const value = snapshot.config.value;
    for (const layer of ["wallpaper", "main", "sidebar"]) value[layer].enabled = true;
    return window.codexCoco.saveModuleConfig({
      moduleId: "appearance",
      expectedRevision: snapshot.config.revision,
      value,
    });
  });
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
  await session.page
    .getByRole("navigation", { name: "应用导航" })
    .getByRole("button", { name: "外观", exact: true })
    .click();
  await session.page
    .getByAltText("主面板插画图片预览", { exact: true })
    .waitFor({ state: "attached" });
  assert.deepEqual(session.errors, []);
  console.log(
    JSON.stringify(
      {
        ok: true,
        packaged,
        controlledTargetOnly: true,
        layers: 3,
        modernAndLegacyLayout: true,
        pixelPlacement: true,
        scrollResizeAndZoom: true,
        clientPseudoElementPreserved: true,
        allLayersOffCleanup: true,
        gallery: true,
        keyboardPositioning: true,
        pointerPositioning: true,
        namedPresets: true,
        computedStyleVerification: true,
        quietMaintenance: true,
        maintenanceFailureAndRecovery: true,
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
