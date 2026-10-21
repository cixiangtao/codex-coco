import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { createDesktopSession } from "./verify-desktop.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const output = join(root, "work/menu-bar-verification");
const getMode = (page) => page.evaluate(() => document.documentElement.dataset.theme);
async function toggle(application) {
  await application.evaluate(({ Menu }) => {
    const action = Menu.getApplicationMenu()
      .items.flatMap((item) => item.submenu?.items ?? [])
      .find((item) => item.label === "显示或收起速览");
    assertAction(action);
    function assertAction(item) {
      if (!item) throw new Error("MISSING_GLANCE_MENU_ACTION");
    }
    action.click();
  });
}
async function nativeVisible(application, page, expected) {
  const window = await application.browserWindow(page);
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    if ((await window.evaluate((win) => win.isVisible())) === expected) return;
    await new Promise((resume) => setTimeout(resume, 30));
  }
  assert.fail(`Popover visibility did not become ${expected}`);
}
async function openPopover(application, existing) {
  const event = existing ? undefined : application.waitForEvent("window");
  await toggle(application);
  const page = existing ?? (await event);
  await page.getByRole("heading", { name: "Codex Coco", exact: true }).waitFor();
  await nativeVisible(application, page, true);
  return page;
}

/** Exercises native menu-bar callbacks through the matching application-menu action, with isolated data. */
export async function verifyMenuBar(packagedExecutable) {
  const directory = await mkdtemp(join(tmpdir(), "codex-coco-menu-bar-"));
  let session;
  try {
    await mkdir(output, { recursive: true });
    session = await createDesktopSession(
      directory,
      { ...process.env, CODEX_COCO_FIXTURES: "1" },
      packagedExecutable,
    );
    const { application, page: main, errors } = session;
    assert.equal(
      application.windows().length,
      1,
      "The popover must remain lazy until explicitly opened",
    );
    let popup = await openPopover(application);
    assert.deepEqual(await popup.evaluate(() => window.codexCoco.windowContext()), {
      ok: true,
      value: { kind: "glance" },
    });
    const summary = await popup.evaluate(() => window.codexCoco.glance());
    assert.equal(summary.ok, true);
    assert.deepEqual(
      summary.value.items.slice(0, 3).map((item) => item.phase),
      ["disabled", "disabled", "disabled"],
    );
    assert.equal(summary.value.items.length, packagedExecutable ? 3 : 5);
    const bounds = await application.evaluate(({ BrowserWindow, screen }) => {
      const win = BrowserWindow.getAllWindows().find((entry) => !entry.isResizable());
      const bounds = win.getBounds();
      return { bounds, work: screen.getDisplayMatching(bounds).workArea };
    });
    assert(bounds.bounds.x >= bounds.work.x && bounds.bounds.y >= bounds.work.y);
    assert(bounds.bounds.x + bounds.bounds.width <= bounds.work.x + bounds.work.width);
    assert(bounds.bounds.y + bounds.bounds.height <= bounds.work.y + bounds.work.height);
    assert.equal(await popup.evaluate(() => typeof process), "undefined");
    await popup.screenshot({
      path: join(output, packagedExecutable ? "packaged.png" : "light.png"),
      animations: "disabled",
      scale: "css",
    });

    console.log("QA: read-only permissions, fixed routes and subscription boundaries");
    await popup.evaluate(() => {
      window.__moduleEvents = [];
      window.codexCoco.onModuleChanged((value) => window.__moduleEvents.push(value));
    });
    const forbidden = await popup.evaluate(async () => {
      document.body.dataset.window = "main";
      return Promise.all([
        window.codexCoco.modules(),
        window.codexCoco.saveTheme({
          expectedRevision: 0,
          theme: { mode: "dark", presetId: "neutral", primaryColor: null },
        }),
        window.codexCoco.resetSettings(),
        window.codexCoco.enableModule({ moduleId: "foundation-fixture", enabled: true }),
        window.codexCoco.runModuleOperation({
          moduleId: "foundation-fixture",
          operation: "count",
          input: { steps: 1 },
        }),
        window.codexCoco.saveModuleConfig({
          moduleId: "foundation-fixture",
          expectedRevision: 0,
          value: {},
        }),
        window.codexCoco.resetModuleConfig({ moduleId: "foundation-fixture" }),
        window.codexCoco.cancelModuleOperation({
          moduleId: "foundation-fixture",
          operationId: "invalid",
        }),
      ]);
    });
    assert(forbidden.every((result) => !result.ok && result.error.code === "FORBIDDEN"));
    const invalid = await popup.evaluate(() =>
      window.codexCoco.openMainPage({ page: "https://example.com/", url: "file:///private" }),
    );
    assert.equal(invalid.error.code, "INVALID_INPUT");
    assert.equal(
      (await main.evaluate(() => window.codexCoco.dismissGlance())).error.code,
      "FORBIDDEN",
    );

    if (!packagedExecutable) {
      await main.evaluate(async () => {
        await window.codexCoco.saveModuleConfig({
          moduleId: "foundation-fixture",
          expectedRevision: 0,
          value: { label: "PRIVATE_TEST_VALUE" },
        });
        await window.codexCoco.enableModule({ moduleId: "foundation-fixture", enabled: true });
      });
      await popup
        .getByRole("region", { name: "模块验收示例", exact: true })
        .getByText("运行中", { exact: true })
        .waitFor();
      const exposed = await popup.evaluate(async () => ({
        summary: await window.codexCoco.glance(),
        events: window.__moduleEvents,
      }));
      assert(!JSON.stringify(exposed.summary).includes("PRIVATE_TEST_VALUE"));
      assert.deepEqual(exposed.events, []);
    }
    await popup.getByRole("button", { name: "打开用量", exact: true }).click();
    await nativeVisible(application, popup, false);
    await main.getByRole("heading", { name: "按需读取用量", exact: true }).waitFor();
    assert.equal(application.windows().length, 2, "Jumping must reuse the existing main window");

    console.log("QA: saved-theme sync without preview leakage");
    await main.getByRole("navigation").getByRole("button", { name: "设置", exact: true }).click();
    const initialMode = await getMode(popup);
    const preview = initialMode === "dark" ? "浅色" : "深色";
    await main.getByRole("button", { name: preview, exact: true }).click();
    assert.equal(await getMode(popup), initialMode);
    await main.getByLabel("自定义主色", { exact: true }).fill("#123abc");
    await openPopover(application, popup);
    await popup.getByRole("button", { name: "打开外观", exact: true }).click();
    await main.getByText("布景尚未连接", { exact: true }).waitFor();
    await main.getByRole("navigation").getByRole("button", { name: "设置", exact: true }).click();
    assert.equal(await main.getByLabel("自定义主色", { exact: true }).inputValue(), "#123abc");
    await main.getByRole("button", { name: "保存主题", exact: true }).click();
    await popup.waitForFunction(
      (expected) => document.documentElement.dataset.theme === expected,
      preview === "深色" ? "dark" : "light",
    );
    await openPopover(application, popup);
    await popup.screenshot({
      path: join(output, packagedExecutable ? "packaged-theme.png" : "saved-theme.png"),
      animations: "disabled",
      scale: "css",
    });
    await popup.keyboard.press("Escape");
    await nativeVisible(application, popup, false);
    await openPopover(application, popup);
    const primary = await application.browserWindow(main);
    await primary.evaluate((window) => {
      window.show();
      window.focus();
    });
    await nativeVisible(application, popup, false);

    console.log("QA: rapid toggling, no-main reopen and popover recreation");
    const popoverWindow = await application.browserWindow(popup);
    await popoverWindow.evaluate((window) => window.destroy());
    const newPopover = application.waitForEvent("window");
    await application.evaluate(({ Menu }) => {
      const action = Menu.getApplicationMenu()
        .items.flatMap((item) => item.submenu?.items ?? [])
        .find((item) => item.label === "显示或收起速览");
      action.click();
      action.click();
    });
    popup = await newPopover;
    await popup.getByRole("heading", { name: "Codex Coco", exact: true }).waitFor();
    await nativeVisible(application, popup, false);
    await openPopover(application, popup);
    await primary.evaluate((window) => window.close());
    const newMain = application.waitForEvent("window");
    await popup.getByRole("button", { name: "打开设置", exact: true }).click();
    const reopened = await newMain;
    await reopened.getByRole("heading", { name: "设置", exact: true }).waitFor();
    await nativeVisible(application, popup, false);
    assert.equal(
      application.windows().length,
      2,
      "Hidden popovers must not be mistaken for main windows",
    );
    assert.equal(
      (await reopened.evaluate(() => window.codexCoco.windowContext())).value.kind,
      "main",
    );

    console.log("QA: read failure hides stale summaries and supports recovery");
    await openPopover(application, popup);
    const last = await popup.evaluate(() => window.codexCoco.glance());
    await application.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler("codex-coco:glance");
      ipcMain.handle("codex-coco:glance", () => ({
        ok: false,
        error: { code: "STORAGE_ERROR", message: "test failure" },
      }));
    });
    await popup.getByRole("button", { name: "刷新速览", exact: true }).click();
    await popup.getByText("暂时无法读取速览", { exact: true }).waitFor();
    assert.equal(await popup.locator(".glance-item").count(), 0);
    await popup.screenshot({
      path: join(output, packagedExecutable ? "packaged-error.png" : "error.png"),
      animations: "disabled",
      scale: "css",
    });
    await application.evaluate(({ ipcMain }, value) => {
      ipcMain.removeHandler("codex-coco:glance");
      ipcMain.handle("codex-coco:glance", () => value);
    }, last);
    await popup.getByRole("button", { name: "重新读取", exact: true }).click();
    await popup.getByRole("heading", { name: "用量", exact: true }).waitFor();
    console.log("QA: an older read cannot overwrite a newer pushed summary");
    await application.evaluate(({ ipcMain, BrowserWindow }, value) => {
      ipcMain.removeHandler("codex-coco:glance");
      globalThis.__glanceReadFinished = false;
      ipcMain.handle("codex-coco:glance", async () => {
        const popup = BrowserWindow.getAllWindows().find((window) => !window.isResizable());
        popup.webContents.send("codex-coco:glance-changed", {
          revision: value.value.revision + 1,
          items: value.value.items.map((item, index) =>
            index ? item : { ...item, description: "已收到更新的模块状态" },
          ),
        });
        await new Promise((resume) => setTimeout(resume, 80));
        globalThis.__glanceReadFinished = true;
        return value;
      });
    }, last);
    await popup.getByRole("button", { name: "刷新速览", exact: true }).click();
    await popup.getByText("已收到更新的模块状态", { exact: true }).waitFor();
    await application.evaluate(async () => {
      const deadline = Date.now() + 8000;
      while (!globalThis.__glanceReadFinished && Date.now() < deadline)
        await new Promise((resume) => setTimeout(resume, 20));
      if (!globalThis.__glanceReadFinished) throw new Error("READ_DID_NOT_FINISH");
    });
    await popup.evaluate(() => window.codexCoco.windowContext());
    await popup.waitForFunction(() => !document.querySelector('[aria-label="刷新速览"]').disabled);
    assert.equal(await popup.getByText("已收到更新的模块状态", { exact: true }).isVisible(), true);
    assert.equal(errors.length, 0, errors.join("\n"));
    await application.close();
    session = undefined;
    const logs = await readFile(join(directory, "diagnostics/events.jsonl"), "utf8");
    assert(!logs.includes("TRAY_UNAVAILABLE"), "The real native tray must be created successfully");
    assert(!logs.includes("PRIVATE_TEST_VALUE"));
    return {
      ok: true,
      packaged: Boolean(packagedExecutable),
      lazyPopover: true,
      readOnly: true,
      themeSync: true,
      reopen: true,
      recovery: true,
      bounds: bounds.bounds,
    };
  } finally {
    await session?.application.close();
    await rm(directory, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(
    JSON.stringify(
      await verifyMenuBar(
        process.argv.includes("--packaged")
          ? join(root, "apps/desktop/release/mac-arm64/Codex Coco.app/Contents/MacOS/Codex Coco")
          : undefined,
      ),
      null,
      2,
    ),
  );
}
