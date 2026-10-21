import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, writeFile, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
const { _electron } = createRequire(import.meta.url)("playwright");

const root = fileURLToPath(new URL("../", import.meta.url));
const appRoot = join(root, "apps/desktop");
const requireFromApp = createRequire(join(appRoot, "package.json"));

/** Launches only the rebuilt application, with its own temporary settings directory. */
export async function createDesktopSession(dataDirectory, environment = {}, packagedExecutable) {
  const env = { ...environment, CODEX_COCO_DATA_DIR: dataDirectory };
  delete env.ELECTRON_RUN_AS_NODE;
  const application = await _electron.launch({
    colorScheme: null,
    executablePath: packagedExecutable ?? requireFromApp("electron"),
    args: packagedExecutable ? [] : [appRoot],
    cwd: appRoot,
    env,
    timeout: 30000,
  });
  const errors = [];
  const page = await application.firstWindow();
  page.setDefaultTimeout(8000);
  page.on("pageerror", (error) => errors.push(error.message));
  await page.getByRole("heading", { name: "Codex Coco", exact: true }).waitFor();
  application.on("window", (window) =>
    window.on("pageerror", (error) => errors.push(error.message)),
  );
  return { application, page, errors, packaged: Boolean(packagedExecutable) };
}

async function waitTheme(page, mode) {
  await page.waitForFunction((value) => document.documentElement.dataset.theme === value, mode);
}
async function primary(page) {
  return page.evaluate(() => document.documentElement.style.getPropertyValue("--primary"));
}
async function saved(page) {
  const result = await page.evaluate(() => window.codexCoco.bootstrap());
  assert.equal(result.ok, true);
  return result.value;
}

/** Reusable assertions for production loading, theme ownership, IPC, and window lifecycles. */
export async function verifyDesktopSession(session) {
  const { application, page, errors } = session;
  const output = join(
    root,
    session.packaged ? "work/desktop-verification-packaged" : "work/desktop-verification",
  );
  await mkdir(output, { recursive: true });
  assert.equal(page.url(), "app://codex-coco/index.html");
  const isolation = await page.evaluate(() => ({ node: typeof process, require: typeof require }));
  assert.equal(isolation.node, "undefined");
  assert.equal(isolation.require, "undefined");
  const modules = await page.evaluate(() => window.codexCoco.modules());
  assert.equal(modules.ok, true);
  assert.deepEqual(
    modules.value.map(({ id, phase, config }) => ({ id, phase, enabled: config.enabled })),
    [
      { id: "usage", phase: "disabled", enabled: false },
      { id: "appearance", phase: "disabled", enabled: false },
    ],
    "Normal and packaged launches register business modules without reading accounts",
  );
  const nav = page.getByRole("navigation", { name: "应用导航" });
  assert.deepEqual(await nav.getByRole("button").allTextContents(), [
    "用量",
    "外观",
    "模块管理",
    "设置",
  ]);
  await page.getByText("布景尚未连接", { exact: true }).waitFor();
  assert.equal(await page.getByRole("button", { name: "连接 Codex", exact: true }).count(), 0);
  const columns = await page
    .locator(".grid-cols-2")
    .first()
    .evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(" ").length);
  assert.equal(columns, 2, "Module Tailwind source detection must generate the real form grid");
  assert.equal(
    await page.locator(".traffic-lights").count(),
    0,
    "Native controls must not be faked in HTML",
  );
  assert.equal(
    await page
      .locator(".desktop-titlebar")
      .evaluate((element) => getComputedStyle(element).webkitAppRegion),
    "drag",
  );
  assert.equal(await page.getByRole("button", { name: /展开侧栏|收起侧栏/ }).count(), 0);
  assert.equal((await page.locator(".desktop-sidebar").boundingBox()).width, 56);
  await application.evaluate(({ app, BrowserWindow }) => {
    app.focus({ steal: true });
    const main = BrowserWindow.getAllWindows().find((window) => window.isVisible());
    main?.focus();
  });
  await page.bringToFront();
  await page.mouse.move(400, 200);
  for (const label of ["用量", "外观", "模块管理", "设置"]) {
    const item = nav.getByRole("button", { name: label, exact: true });
    assert.equal(await item.getAttribute("title"), null, "Avoid duplicate native tooltips");
    await item.hover();
    await page.getByRole("tooltip", { name: label, exact: true }).waitFor();
    await page.keyboard.press("Escape");
    await page.getByRole("tooltip").waitFor({ state: "hidden" });
  }
  await page.mouse.move(400, 200);
  await nav.getByRole("button", { name: "用量", exact: true }).focus();
  await page.keyboard.press("Tab");
  await page.getByRole("tooltip", { name: "外观", exact: true }).waitFor();
  await page.screenshot({
    path: join(output, "navigation-tooltip.png"),
    scale: "css",
    animations: "disabled",
  });
  await page.keyboard.press("Enter");
  await page.getByRole("tooltip").waitFor({ state: "hidden" });
  assert.equal(
    await nav.getByRole("button", { name: "外观", exact: true }).getAttribute("aria-current"),
    "page",
  );
  await nav.getByRole("button", { name: "用量", exact: true }).click();
  await page.getByRole("heading", { name: "按需读取用量", exact: true }).waitFor();
  await nav.getByRole("button", { name: "模块管理", exact: true }).click();
  await page.getByRole("heading", { name: "已接入的模块", exact: true }).waitFor();
  await nav.getByRole("button", { name: "设置", exact: true }).click();
  assert.equal(
    await page.getByRole("button", { name: "保存主题", exact: true }).isDisabled(),
    true,
  );
  const buttonDisplay = await page
    .getByRole("button", { name: "保存主题", exact: true })
    .evaluate((element) => getComputedStyle(element).display);
  assert.ok(["flex", "inline-flex"].includes(buttonDisplay));
  assert.equal(
    await page
      .getByRole("button", { name: "保存主题", exact: true })
      .evaluate((element) => getComputedStyle(element).height),
    "32px",
  );
  const initialBounds = await application.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].getBounds(),
  );
  assert.equal(initialBounds.width, 980);
  assert.equal(initialBounds.height, 800);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);

  console.log("QA: mode and color preview");
  await page.getByRole("button", { name: "深色", exact: true }).click();
  await waitTheme(page, "dark");
  await nav.getByRole("button", { name: "设置", exact: true }).hover();
  await page.getByRole("tooltip", { name: "设置", exact: true }).waitFor();
  await page.mouse.move(400, 200);
  await nav.getByRole("button", { name: "模块管理", exact: true }).focus();
  await page.keyboard.press("Tab");
  await page.getByRole("tooltip", { name: "设置", exact: true }).waitFor();
  await page.screenshot({
    path: join(output, "navigation-tooltip-dark.png"),
    scale: "css",
    animations: "disabled",
  });
  await page.keyboard.press("Escape");
  await page.getByRole("tooltip").waitFor({ state: "hidden" });
  await page.getByRole("button", { name: "紫色", exact: true }).click();
  assert.equal(await primary(page), "#c5a4ff");
  await page.getByRole("button", { name: "蓝色", exact: true }).click();
  assert.equal(await primary(page), "#8cafff");
  await waitTheme(page, "dark");
  const color = page.getByLabel("自定义主色", { exact: true });
  await color.fill("#000000");
  assert.equal(
    await page.evaluate(() =>
      document.documentElement.style.getPropertyValue("--primary-foreground"),
    ),
    "#ffffff",
  );
  await color.fill("#ffffff");
  assert.equal(await primary(page), "#ffffff");
  assert.equal(
    await page.evaluate(() =>
      document.documentElement.style.getPropertyValue("--primary-foreground"),
    ),
    "#000000",
  );
  await color.fill("invalid");
  await nav.getByRole("button", { name: "外观", exact: true }).click();
  await page.getByText("布景尚未连接", { exact: true }).waitFor();
  await nav.getByRole("button", { name: "设置", exact: true }).click();
  assert.equal(await color.inputValue(), "invalid", "Page navigation must retain draft input");
  assert.equal(
    await page.getByRole("button", { name: "保存主题", exact: true }).isDisabled(),
    true,
  );
  assert.equal(await primary(page), "#ffffff");
  await page.getByRole("button", { name: "取消预览", exact: true }).click();
  assert.equal((await saved(page)).settings.revision, 0);

  console.log("QA: system mode");
  await application.evaluate(({ nativeTheme }) => {
    nativeTheme.themeSource = "dark";
  });
  await page.getByRole("button", { name: "跟随系统", exact: true }).click();
  await waitTheme(page, "dark");
  await application.evaluate(({ nativeTheme }) => {
    nativeTheme.themeSource = "light";
  });
  await waitTheme(page, "light");
  await page.getByRole("button", { name: "深色", exact: true }).click();
  await waitTheme(page, "dark");
  await application.evaluate(({ nativeTheme }) => {
    nativeTheme.themeSource = "light";
  });
  await waitTheme(page, "dark");
  console.log("QA: saving and portal");
  await color.fill("#335dd8");
  await page.getByRole("button", { name: "保存主题", exact: true }).click();
  await page.getByRole("status").filter({ hasText: "主题已保存" }).waitFor();
  await page.getByRole("button", { name: "关于 Codex Coco", exact: true }).click();
  await page.getByRole("dialog").waitFor();
  assert.equal(
    await page.getByRole("heading", { name: "Codex Coco", exact: true }).isVisible(),
    true,
  );
  assert.equal(
    await page
      .getByRole("dialog")
      .evaluate((element) => getComputedStyle(element).getPropertyValue("--primary").trim()),
    "#335dd8",
  );
  await page.screenshot({
    path: join(output, "dark-dialog.png"),
    scale: "css",
    animations: "disabled",
  });
  await page.keyboard.press("Escape");
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  assert.equal(
    await page
      .getByRole("button", { name: "关于 Codex Coco" })
      .evaluate((element) => element === document.activeElement),
    true,
  );

  console.log("QA: multiple windows");
  const newWindow = application.waitForEvent("window");
  await application.evaluate(({ Menu }) => {
    const item = Menu.getApplicationMenu()
      .items.flatMap((entry) => entry.submenu?.items ?? [])
      .find((entry) => entry.label === "新建窗口");
    item.click();
  });
  const second = await newWindow;
  await second.getByRole("heading", { name: "Codex Coco", exact: true }).waitFor();
  assert.equal(await primary(second), "#335dd8");
  await second.getByRole("navigation").getByRole("button", { name: "设置", exact: true }).click();
  await color.fill("#ff00ff");
  assert.equal(await primary(page), "#ff00ff");
  assert.equal(await primary(second), "#335dd8");
  await second.getByRole("button", { name: "浅色", exact: true }).click();
  await second.getByRole("button", { name: "保存主题", exact: true }).click();
  await page.getByText("其他窗口已更新设置", { exact: true }).waitFor();
  assert.equal(await primary(page), "#ff00ff");
  await page.getByRole("button", { name: "取消预览", exact: true }).click();
  await waitTheme(page, "light");
  assert.equal(await primary(page), "#335dd8");
  const invalid = await page.evaluate(() =>
    window.codexCoco.saveTheme({
      expectedRevision: 2,
      theme: { mode: "unsafe", presetId: "blue", primaryColor: null },
    }),
  );
  assert.equal(invalid.ok, false);
  assert.equal(invalid.error.code, "INVALID_INPUT");
  const conflict = await page.evaluate(() =>
    window.codexCoco.saveTheme({
      expectedRevision: 0,
      theme: { mode: "light", presetId: "blue", primaryColor: null },
    }),
  );
  assert.equal(conflict.ok, false);
  assert.equal(conflict.error.code, "CONFLICT");
  await page.screenshot({ path: join(output, "light.png"), scale: "css", animations: "disabled" });
  const nativeWindow = await application.browserWindow(page);
  await nativeWindow.evaluate((window) => window.setSize(720, 640));
  await page.waitForFunction(() => innerWidth === 720);
  await page.screenshot({
    path: join(output, "compact.png"),
    scale: "css",
    animations: "disabled",
  });
  await nav.getByRole("button", { name: "外观", exact: true }).click();
  await page.screenshot({
    path: join(output, "appearance.png"),
    scale: "css",
    animations: "disabled",
  });
  await nav.getByRole("button", { name: "模块管理", exact: true }).click();
  await page.screenshot({
    path: join(output, "collapsed.png"),
    scale: "css",
    animations: "disabled",
  });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.evaluate(() => {
    location.href = "https://example.com/";
  });
  await page.waitForFunction(
    () =>
      location.href === "app://codex-coco/index.html" &&
      document.querySelector("h1")?.textContent === "Codex Coco",
  );
  assert.equal(page.url(), "app://codex-coco/index.html");
  assert.equal(errors.length, 0, errors.join("\n"));
  const closed = application.windows().map((window) => window.waitForEvent("close"));
  await application.evaluate(({ BrowserWindow }) => {
    for (const window of BrowserWindow.getAllWindows()) window.close();
  });
  await Promise.all(closed);
  const reopenedEvent = application.waitForEvent("window");
  await application.evaluate(({ app }) => app.emit("activate"));
  const reopened = await reopenedEvent;
  await reopened.getByRole("heading", { name: "Codex Coco", exact: true }).waitFor();
  await waitTheme(reopened, "light");
  assert.equal(await primary(reopened), "#335dd8");
  return {
    initialBounds,
    screenshots: [
      "light.png",
      "dark-dialog.png",
      "compact.png",
      "appearance.png",
      "collapsed.png",
      "navigation-tooltip.png",
      "navigation-tooltip-dark.png",
    ].map((name) => join(output, name)),
  };
}

/** Fully isolated repeatable check. The temporary application data is always removed. */
export async function runDesktopVerification(packagedExecutable) {
  const directory = await mkdtemp(join(tmpdir(), "codex-coco-desktop-"));
  let session;
  try {
    session = await createDesktopSession(directory, process.env, packagedExecutable);
    const result = await verifyDesktopSession(session);
    await session.application.close();
    session = undefined;
    const onDisk = JSON.parse(await readFile(join(directory, "settings.json"), "utf8"));
    assert.equal(onDisk.theme.primaryColor, "#335dd8");
    session = await createDesktopSession(directory, process.env, packagedExecutable);
    await waitTheme(session.page, "light");
    assert.equal(await primary(session.page), "#335dd8");
    await session.application.close();
    session = undefined;
    await writeFile(join(directory, "settings.json"), "damaged config");
    session = await createDesktopSession(directory, process.env, packagedExecutable);
    await session.page.getByText("原配置需要处理", { exact: true }).waitFor();
    assert.equal(await readFile(join(directory, "settings.json"), "utf8"), "damaged config");
    await session.page.getByRole("button", { name: "备份并恢复默认设置" }).click();
    await session.page.getByRole("status").filter({ hasText: "默认设置已恢复" }).waitFor();
    const backup = (await readdir(directory)).find((name) =>
      name.startsWith("settings.json.backup-"),
    );
    assert.ok(backup);
    assert.equal(await readFile(join(directory, backup), "utf8"), "damaged config");
    console.log(
      JSON.stringify(
        { ok: true, ...result, restartPersistence: true, backedUpRecovery: true },
        null,
        2,
      ),
    );
    return result;
  } finally {
    await session?.application.close();
    await rm(directory, { recursive: true, force: true });
  }
}

if (
  typeof process !== "undefined" &&
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  await runDesktopVerification(
    process.argv.includes("--packaged")
      ? join(appRoot, "release/mac-arm64/Codex Coco.app/Contents/MacOS/Codex Coco")
      : undefined,
  );
}
