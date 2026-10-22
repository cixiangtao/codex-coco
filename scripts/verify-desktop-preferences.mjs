import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { createDesktopSession } from "./verify-desktop.mjs";
const root = fileURLToPath(new URL("../", import.meta.url));
const directory = await mkdtemp(join(tmpdir(), "codex-coco-desktop-preferences-"));
const packaged = process.argv.includes("--packaged");
const settingsOutput = join(
  root,
  packaged ? "work/settings-groups-packaged" : "work/settings-groups",
);
await mkdir(settingsOutput, { recursive: true });
let session;
async function task(page, name, input = {}) {
  const response = await page.evaluate(
    ({ name, input }) =>
      window.codexCoco.runModuleOperation({ moduleId: "desktop-tools", operation: name, input }),
    { name, input },
  );
  assert.equal(response.ok, true);
  const id = response.value.operation.id;
  const end = Date.now() + 20_000;
  do {
    const state = await page.evaluate(
      async () =>
        (await window.codexCoco.modules()).value.find((m) => m.id === "desktop-tools").operation,
    );
    if (state?.id === id && state.phase === "succeeded") return state.result;
    if (state?.id === id && state.phase === "failed") assert.fail("Desktop preference task failed");
    await delay(30);
  } while (Date.now() < end);
  assert.fail("Desktop preference task timed out");
}
async function config(page, patch) {
  const response = await page.evaluate(async (patch) => {
    const s = (await window.codexCoco.modules()).value.find((m) => m.id === "desktop-tools");
    return window.codexCoco.saveModuleConfig({
      moduleId: "desktop-tools",
      expectedRevision: s.config.revision,
      value: { ...s.config.value, ...patch },
    });
  }, patch);
  assert.equal(response.ok, true);
}
async function native(application) {
  return application.evaluate(() => ({
    loginCalls: globalThis.preferenceQa.loginCalls,
    frames: globalThis.preferenceQa.frames.length,
    unique: new Set(globalThis.preferenceQa.frames).size,
    cpuCalls: globalThis.preferenceQa.cpuCalls,
  }));
}
try {
  session = await createDesktopSession(
    join(directory, "data"),
    { ...process.env, CODEX_COCO_FIXTURES: "0" },
    packaged
      ? join(root, "apps/desktop/release/mac-arm64/Codex Coco.app/Contents/MacOS/Codex Coco")
      : undefined,
  );
  const { application, page, errors } = session;
  await application.evaluate(({ app, Tray }) => {
    globalThis.preferenceQa = { loginCalls: 0, openAtLogin: false, frames: [], cpuCalls: 0 };
    app.getLoginItemSettings = () => ({ openAtLogin: globalThis.preferenceQa.openAtLogin });
    app.setLoginItemSettings = (options) => {
      globalThis.preferenceQa.loginCalls++;
      globalThis.preferenceQa.openAtLogin = options.openAtLogin;
    };
    const setImage = Tray.prototype.setImage;
    Tray.prototype.setImage = function (image) {
      globalThis.preferenceQa.frames.push(image.toPNG().toString("base64"));
      return setImage.call(this, image);
    };
    const os = process.getBuiltinModule("node:os");
    const cpus = os.cpus;
    os.cpus = () => {
      globalThis.preferenceQa.cpuCalls++;
      return cpus();
    };
    process.getBuiltinModule("node:module").syncBuiltinESMExports();
  });
  await page.getByRole("navigation").getByRole("button", { name: "设置", exact: true }).click();
  await page.getByRole("button", { name: "启用系统与菜单栏", exact: true }).click();
  await delay(800);
  assert.equal((await native(application)).loginCalls, 0);
  const animationSwitch = page.getByRole("switch", { name: "播放图标动画", exact: true });
  const originalAnimation = await animationSwitch.isChecked();
  await animationSwitch.focus();
  await page.keyboard.press("Space");
  assert.equal(await animationSwitch.isChecked(), !originalAnimation);
  assert.equal(
    (
      await page.evaluate(async () =>
        (await window.codexCoco.modules()).value.find((m) => m.id === "desktop-tools"),
      )
    ).config.value.animate,
    originalAnimation,
  );
  await page.screenshot({
    path: join(settingsOutput, "system-behavior-light.png"),
    scale: "css",
    animations: "disabled",
  });
  const mainWindow = await application.browserWindow(page);
  await mainWindow.evaluate((window) => window.setSize(720, 640));
  const row = page.locator('[data-slot="settings-row"]').filter({ has: animationSwitch });
  const labelBox = await row.locator('[data-slot="field-label"]').boundingBox();
  const switchBox = await animationSwitch.boundingBox();
  assert(
    switchBox.x > labelBox.x + labelBox.width,
    "Compact settings retain the switch in the right column",
  );
  await animationSwitch.scrollIntoViewIfNeeded();
  await page.screenshot({
    path: join(settingsOutput, "system-behavior-compact.png"),
    scale: "css",
    animations: "disabled",
  });
  await mainWindow.evaluate((window) => window.setSize(980, 800));
  await page.getByRole("button", { name: "取消偏好修改", exact: true }).click();
  assert.equal(await animationSwitch.isChecked(), originalAnimation);
  assert.equal((await native(application)).loginCalls, 0);
  const integrationGroup = page.getByRole("group", { name: "系统集成", exact: true });
  await integrationGroup.evaluate((node) => node.scrollIntoView({ block: "start" }));
  await page.screenshot({
    path: join(settingsOutput, "system-integration-light.png"),
    scale: "css",
    animations: "disabled",
  });
  await mainWindow.evaluate((window) => window.setSize(720, 640));
  assert(
    await page.locator(".desktop-content").evaluate((node) => node.scrollWidth <= node.clientWidth),
  );
  await page.screenshot({
    path: join(settingsOutput, "system-integration-compact.png"),
    scale: "css",
    animations: "disabled",
  });
  await mainWindow.evaluate((window) => window.setSize(980, 800));
  await config(page, { iconId: "builtin:everonecat0", animate: false, followsCpu: true });
  const initial = await task(page, "apply-menu-bar");
  assert.equal(initial.status, "ready");
  assert.equal(initial.frameCount, 121);
  const staticState = await native(application);
  await delay(500);
  assert.equal((await native(application)).frames, staticState.frames);
  assert.equal((await native(application)).cpuCalls, 0);
  await config(page, { animate: true, followsCpu: true, speed: 2 });
  await task(page, "apply-menu-bar");
  await delay(3300);
  const animated = await native(application);
  assert(animated.frames > staticState.frames + 2);
  assert(animated.unique > 1);
  assert(animated.cpuCalls >= 2);
  await config(page, { launchAtLogin: true, shareWidgetSnapshot: true });
  await task(page, "apply-menu-bar");
  assert.equal((await native(application)).loginCalls, 0);
  if (packaged) {
    await page.getByRole("button", { name: "应用开机启动设置", exact: true }).click();
    await page.getByRole("dialog").getByRole("button", { name: "确认应用", exact: true }).click();
    await page.getByText("系统登录项：已开启", { exact: false }).waitFor();
  } else {
    assert.equal((await task(page, "apply-login")).status, "error");
    assert.equal(
      await page.getByRole("button", { name: "应用开机启动设置", exact: true }).isDisabled(),
      true,
    );
  }
  const expectedLoginCalls = packaged ? 1 : 0;
  assert.equal((await native(application)).loginCalls, expectedLoginCalls);
  await task(page, "apply-sharing");
  let shared = JSON.parse(
    await readFile(join(directory, "data/shared/codex-coco-widget.json"), "utf8"),
  );
  assert.equal(shared.appRunning, true);
  assert(!JSON.stringify(shared).match(/config|operation|accessToken|email|history|samples/));
  const importedPath = join(root, "apps/desktop/resources/tray/jerry.gif");
  await application.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] });
  }, importedPath);
  await page.getByRole("button", { name: "导入自定义菜单栏图标", exact: true }).click();
  await page.getByAltText("自定义菜单栏图标预览", { exact: true }).waitFor();
  const imported = await page.evaluate(
    async () =>
      (await window.codexCoco.modules()).value.find((module) => module.id === "desktop-tools")
        .operation.result,
  );
  assert(imported.imported.endsWith(".gif"));
  assert(imported.preview.startsWith("data:image/png;base64,"));
  const popoverEvent = application.waitForEvent("window");
  await application.evaluate(({ Menu }) =>
    Menu.getApplicationMenu()
      .items.flatMap((item) => item.submenu?.items ?? [])
      .find((item) => item.label === "显示或收起速览")
      .click(),
  );
  const popover = await popoverEvent;
  const forbidden = await popover.evaluate(() =>
    window.codexCoco.runModuleOperation({
      moduleId: "desktop-tools",
      operation: "apply-login",
      input: {},
    }),
  );
  assert.equal(forbidden.error.code, "FORBIDDEN");
  assert.equal((await native(application)).loginCalls, expectedLoginCalls);
  await popover.keyboard.press("Escape");
  await page.bringToFront();
  const output = join(
    root,
    packaged ? "work/desktop-preferences-packaged" : "work/desktop-preferences",
  );
  await mkdir(output, { recursive: true });
  await page.screenshot({
    path: join(output, "settings.png"),
    scale: "css",
    animations: "disabled",
  });
  const disabled = await page.evaluate(() =>
    window.codexCoco.enableModule({ moduleId: "desktop-tools", enabled: false }),
  );
  assert.equal(disabled.ok, true);
  const stopped = await native(application);
  await delay(3300);
  assert.equal((await native(application)).frames, stopped.frames);
  assert.equal((await native(application)).cpuCalls, stopped.cpuCalls);
  assert.equal((await native(application)).loginCalls, expectedLoginCalls);
  shared = JSON.parse(
    await readFile(join(directory, "data/shared/codex-coco-widget.json"), "utf8"),
  );
  assert.equal(shared.appRunning, false);
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify(
      {
        ok: true,
        packaged,
        licensedFrames121: true,
        staticWithoutCpu: true,
        animationAndCpu: true,
        systemLoginIntercepted: true,
        noLoginOnSaveOrDisable: true,
        customGif: true,
        publicSharedSnapshot: true,
        stopTimersAndSharing: true,
      },
      null,
      2,
    ),
  );
} finally {
  await session?.application.close();
  await rm(directory, { recursive: true, force: true });
}
