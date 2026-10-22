import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, writeFile, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { createDesktopSession } from "./verify-desktop.mjs";
const root = fileURLToPath(new URL("../", import.meta.url));
const directory = await mkdtemp(join(tmpdir(), "codex-coco-glance-layout-"));
const data = join(directory, "data");
const packaged = process.argv.includes("--packaged");
const executable = packaged
  ? join(root, "apps/desktop/release/mac-arm64/Codex Coco.app/Contents/MacOS/Codex Coco")
  : undefined;
const output = join(root, packaged ? "work/glance-layout-packaged" : "work/glance-layout");
await mkdir(output, { recursive: true });
let session;
async function launch() {
  session = await createDesktopSession(
    data,
    { ...process.env, CODEX_COCO_FIXTURES: "0" },
    executable,
  );
  await session.page
    .getByRole("navigation")
    .getByRole("button", { name: "设置", exact: true })
    .click();
  return session;
}
const read = (page) => page.evaluate(() => window.codexCoco.glanceLayout());
try {
  let { application, page, errors } = await launch();
  const initial = await read(page);
  assert.equal(initial.ok, true);
  await application.evaluate(({ BrowserWindow }) => {
    globalThis.layoutQaNotificationFailures = 0;
    globalThis.layoutQaObservers = BrowserWindow.getAllWindows().map((window) => {
      const contents = window.webContents;
      const send = contents.send;
      contents.send = function (channel, ...args) {
        if (["codex-coco:glance-layout-changed", "codex-coco:glance-changed"].includes(channel)) {
          globalThis.layoutQaNotificationFailures++;
          throw new Error("CONTROLLED_OBSERVER_FAILURE");
        }
        return send.call(this, channel, ...args);
      };
      return { contents, send };
    });
  });
  const observerSaved = await page.evaluate(
    (snapshot) =>
      window.codexCoco.saveGlanceLayout({
        expectedRevision: snapshot.revision,
        value: { blocks: snapshot.value.blocks.slice(1) },
      }),
    initial.value,
  );
  assert.equal(
    observerSaved.ok,
    true,
    "A failed notification cannot report a persisted save as failed",
  );
  assert.equal((await read(page)).value.revision, observerSaved.value.revision);
  assert((await application.evaluate(() => globalThis.layoutQaNotificationFailures)) >= 2);
  await application.evaluate(() => {
    for (const { contents, send } of globalThis.layoutQaObservers) contents.send = send;
    delete globalThis.layoutQaObservers;
  });
  const restoredObservers = await page.evaluate(
    ({ revision, value }) =>
      window.codexCoco.saveGlanceLayout({ expectedRevision: revision, value }),
    { revision: observerSaved.value.revision, value: initial.value.value },
  );
  assert.equal(restoredObservers.ok, true);
  const section = page.getByRole("region", { name: "速览面板设置", exact: true });
  await section.getByRole("button", { name: "移除近 30 天消耗", exact: true }).click();
  await section.getByRole("button", { name: "添加每日用量趋势", exact: true }).click();
  await section.getByRole("button", { name: "上移每日用量趋势", exact: true }).click();
  assert.deepEqual(
    (await read(page)).value.value,
    initial.value.value,
    "Drafts do not change the saved panel",
  );
  await section.getByRole("button", { name: "取消速览修改", exact: true }).click();
  assert.equal(
    await section.getByRole("button", { name: "移除近 30 天消耗", exact: true }).count(),
    1,
  );
  await section.getByRole("button", { name: "移除近 30 天消耗", exact: true }).click();
  await section.getByRole("button", { name: "添加每日用量趋势", exact: true }).click();
  await section.getByRole("button", { name: "上移每日用量趋势", exact: true }).click();
  await section.getByRole("button", { name: "保存速览组合", exact: true }).click();
  await section.getByText("速览组合已保存。", { exact: true }).waitFor();
  const saved = (await read(page)).value;
  assert(!saved.value.blocks.includes("usage.month"));
  assert.equal(saved.value.blocks.at(-2), "usage.trend");
  assert.equal(
    (await page.evaluate(() => window.codexCoco.modules())).value.every(
      (module) => module.phase === "disabled",
    ),
    true,
  );
  await section
    .locator(".glance-editor")
    .evaluate((node) => node.scrollIntoView({ block: "start" }));
  await page.screenshot({
    path: join(output, "editor-light.png"),
    scale: "css",
    animations: "disabled",
  });
  const window = await application.browserWindow(page);
  await window.evaluate((window) => window.setSize(720, 640));
  assert(
    await page.locator(".desktop-content").evaluate((node) => node.scrollWidth <= node.clientWidth),
  );
  await page.screenshot({
    path: join(output, "editor-compact.png"),
    scale: "css",
    animations: "disabled",
  });
  await window.evaluate((window) => window.setSize(980, 800));
  // A window-local draft survives a concurrent update and cannot overwrite the latest revision.
  await section.getByRole("button", { name: "添加近 30 天消耗", exact: true }).click();
  const secondEvent = application.waitForEvent("window");
  await application.evaluate(({ Menu }) =>
    Menu.getApplicationMenu()
      .items.flatMap((item) => item.submenu?.items ?? [])
      .find((item) => item.label === "新建窗口")
      .click(),
  );
  const second = await secondEvent;
  await second.getByRole("heading", { name: "Codex Coco", exact: true }).waitFor();
  assert.deepEqual((await read(second)).value.value, saved.value);
  const concurrent = await second.evaluate(
    (snapshot) =>
      window.codexCoco.saveGlanceLayout({
        expectedRevision: snapshot.revision,
        value: { blocks: ["appearance.status"] },
      }),
    saved,
  );
  assert.equal(concurrent.ok, true);
  await section.getByText("速览组合已在其他窗口更新", { exact: true }).waitFor();
  assert.equal(
    await section.getByRole("button", { name: "保存速览组合", exact: true }).isDisabled(),
    true,
  );
  await section.getByRole("button", { name: "取消速览修改", exact: true }).click();
  const stale = await page.evaluate(
    (snapshot) =>
      window.codexCoco.saveGlanceLayout({
        expectedRevision: snapshot.revision,
        value: snapshot.value,
      }),
    saved,
  );
  assert.equal(stale.error.code, "CONFLICT");
  await second.close();
  await page.evaluate(() => {
    window.__glanceVisibility = [];
    window.codexCoco.onGlanceVisibilityChanged((visible) =>
      window.__glanceVisibility.push(visible),
    );
  });
  const popupEvent = application.waitForEvent("window");
  await application.evaluate(({ Menu }) =>
    Menu.getApplicationMenu()
      .items.flatMap((item) => item.submenu?.items ?? [])
      .find((item) => item.label === "显示或收起速览")
      .click(),
  );
  const popup = await popupEvent;
  assert.equal(
    await popup.evaluate(() => {
      const off = window.codexCoco.onGlanceVisibilityChanged(() => {});
      return typeof off();
    }),
    "undefined",
    "Unsubscribing must not return an Electron object",
  );
  const nativePopup = await application.browserWindow(popup);
  const ensurePopupVisible = async () => {
    if (!(await nativePopup.evaluate((window) => window.isVisible())))
      await application.evaluate(({ Menu }) =>
        Menu.getApplicationMenu()
          .items.flatMap((item) => item.submenu?.items ?? [])
          .find((item) => item.label === "显示或收起速览")
          .click(),
      );
    await popup.waitForFunction(
      () => document.querySelector(".glance-shell")?.getAttribute("data-visible") === "true",
    );
  };
  await popup.evaluate(() => {
    window.__glanceVisibility = [];
    window.codexCoco.onGlanceVisibilityChanged((visible) =>
      window.__glanceVisibility.push(visible),
    );
  });
  await popup.getByRole("button", { name: "打开外观", exact: true }).waitFor();
  assert.equal(
    await popup.getByRole("button", { name: "打开系统与菜单栏", exact: true }).count(),
    0,
  );
  for (const method of ["glanceLayout", "resetGlanceLayout", "glancePreview"]) {
    const denied = await popup.evaluate((method) => window.codexCoco[method](), method);
    assert.equal(denied.error.code, "FORBIDDEN");
  }
  const deniedSave = await popup.evaluate(() =>
    window.codexCoco.saveGlanceLayout({ expectedRevision: 0, value: { blocks: [] } }),
  );
  assert.equal(deniedSave.error.code, "FORBIDDEN");
  await popup.screenshot({
    path: join(output, "custom-panel.png"),
    scale: "css",
    animations: "disabled",
  });
  assert.equal(
    await popup.locator("[data-sort-handle]").count(),
    0,
    "A singleton needs no sorting control",
  );
  const fullBlocks = [...initial.value.value.blocks, "usage.trend", "usage.reset"];
  const setBlocks = async (blocks) => {
    const snapshot = (await read(page)).value;
    const result = await page.evaluate(
      ({ revision, blocks }) =>
        window.codexCoco.saveGlanceLayout({ expectedRevision: revision, value: { blocks } }),
      { revision: snapshot.revision, blocks },
    );
    assert.equal(result.ok, true);
    return result.value;
  };
  const reorderBase = await setBlocks(fullBlocks);
  const order = () =>
    popup
      .locator("[data-sort-id]")
      .evaluateAll((rows) => rows.map((row) => row.getAttribute("data-sort-id")));
  const waitSaved = async (blocks) => {
    await popup.waitForFunction((blocks) => {
      const board = document.querySelector(".glance-reorder");
      return (
        board?.getAttribute("aria-busy") === "false" &&
        JSON.stringify(
          [...document.querySelectorAll("[data-sort-id]")].map((node) =>
            node.getAttribute("data-sort-id"),
          ),
        ) === JSON.stringify(blocks)
      );
    }, blocks);
    assert.deepEqual((await read(page)).value.value.blocks, blocks);
  };
  await popup.locator('[data-sort-handle="usage.primary"]').waitFor();
  assert.deepEqual(await order(), fullBlocks);
  assert.equal(await popup.getByRole("button", { name: "调整速览顺序", exact: true }).count(), 0);
  const primaryHandle = popup.getByRole("button", { name: "拖动主要额度窗口排序", exact: true });
  const todayBlock = popup.locator('[data-sort-id="usage.today"]');
  await primaryHandle.dragTo(todayBlock, { targetPosition: { x: 80, y: 24 } });
  const dragged = ["usage.secondary", "usage.today", "usage.primary", ...fullBlocks.slice(3)];
  await waitSaved(dragged);
  await primaryHandle.press("ArrowUp");
  const reordered = ["usage.secondary", "usage.primary", ...fullBlocks.slice(2)];
  await waitSaved(reordered);
  assert.equal(await primaryHandle.evaluate((node) => node === document.activeElement), true);
  await popup.screenshot({
    path: join(output, "popup-order-light.png"),
    scale: "css",
    animations: "disabled",
  });
  const previousTheme = (await page.evaluate(() => window.codexCoco.bootstrap())).value.settings
    .theme;
  const previousMode = await popup.evaluate(() => document.documentElement.dataset.theme);
  const theme = async (value) => {
    const snapshot = (await page.evaluate(() => window.codexCoco.bootstrap())).value;
    const result = await page.evaluate(
      ({ revision, value }) =>
        window.codexCoco.saveTheme({ expectedRevision: revision, theme: value }),
      { revision: snapshot.settings.revision, value },
    );
    assert.equal(result.ok, true);
  };
  await theme({ ...previousTheme, mode: "dark", primaryColor: "#e54673" });
  await popup.waitForFunction(() => document.documentElement.dataset.theme === "dark");
  assert.deepEqual(await order(), reordered);
  await popup.screenshot({
    path: join(output, "popup-order-dark.png"),
    scale: "css",
    animations: "disabled",
  });
  assert(
    await popup.locator(".glance-content").evaluate((node) => node.scrollWidth <= node.clientWidth),
  );
  const footerBounds = await popup
    .getByRole("button", { name: "打开主窗口", exact: true })
    .boundingBox();
  assert(
    footerBounds && footerBounds.y + footerBounds.height <= 520,
    "Main-window action remains outside the scrolling board",
  );
  const reorderedSnapshot = (await read(page)).value;
  assert.equal(reorderedSnapshot.revision, reorderBase.revision + 2);
  assert.deepEqual(
    JSON.parse(await readFile(join(data, "glance-layout.json"), "utf8")).value.blocks,
    reordered,
  );
  const staleReorder = await popup.evaluate(
    (base) =>
      window.codexCoco.reorderGlanceLayout({
        expectedRevision: base.revision,
        blocks: base.value.blocks,
      }),
    reorderBase,
  );
  assert.equal(staleReorder.error.code, "CONFLICT");
  for (const blocks of [
    [],
    [...reordered, "usage.today"],
    reordered.slice(1),
    ["private.script"],
  ]) {
    const rejected = await popup.evaluate(
      ({ revision, blocks }) =>
        window.codexCoco.reorderGlanceLayout({ expectedRevision: revision, blocks }),
      { revision: reorderedSnapshot.revision, blocks },
    );
    assert.equal(rejected.error.code, "INVALID_INPUT");
  }
  const forbiddenReorder = await page.evaluate(
    (base) =>
      window.codexCoco.reorderGlanceLayout({
        expectedRevision: base.revision,
        blocks: base.value.blocks,
      }),
    reorderedSnapshot,
  );
  assert.equal(forbiddenReorder.error.code, "FORBIDDEN");
  await theme(previousTheme);
  await popup.waitForFunction(
    (mode) => document.documentElement.dataset.theme === mode,
    previousMode,
  );
  await ensurePopupVisible();
  await primaryHandle.press("End");
  await waitSaved([...reordered.filter((id) => id !== "usage.primary"), "usage.primary"]);
  await primaryHandle.press("Home");
  const homeOrder = ["usage.primary", ...reordered.filter((id) => id !== "usage.primary")];
  await waitSaved(homeOrder);
  // Dropping nowhere and a native drag cancellation never write a new revision.
  const cancelRevision = (await read(page)).value.revision;
  await primaryHandle.dragTo(popup.locator(".glance-toolbar"));
  assert.equal((await read(page)).value.revision, cancelRevision);
  assert.deepEqual(await order(), homeOrder);
  await primaryHandle.scrollIntoViewIfNeeded();
  const dragStart = await primaryHandle.boundingBox();
  await popup.mouse.move(dragStart.x + dragStart.width / 2, dragStart.y + dragStart.height / 2);
  await popup.mouse.down();
  await popup.mouse.move(dragStart.x + dragStart.width / 2, dragStart.y + dragStart.height + 12, {
    steps: 4,
  });
  await popup.locator('[data-sort-id="usage.primary"][data-dragging="true"]').waitFor();
  await popup.keyboard.press("Escape");
  await popup.mouse.up();
  await popup.waitForFunction(() => !document.querySelector('[data-dragging="true"]'));
  assert.equal(await nativePopup.evaluate((window) => window.isVisible()), true);
  assert.equal(
    (await read(page)).value.revision,
    cancelRevision,
    "Escape during a native drag does not persist",
  );
  // A failed automatic save retains the visible order and exposes inline retry/recovery.
  const layoutPath = join(data, "glance-layout.json");
  await rename(layoutPath, `${layoutPath}.qa`);
  await mkdir(layoutPath);
  const retryOrder = [homeOrder[1], homeOrder[0], ...homeOrder.slice(2)];
  try {
    await primaryHandle.press("ArrowDown");
    await popup.getByText("顺序未能保存", { exact: true }).waitFor();
    assert.deepEqual(await order(), retryOrder);
    assert.equal((await read(page)).value.revision, cancelRevision);
    assert.equal(await primaryHandle.isDisabled(), true);
    await popup.screenshot({
      path: join(output, "popup-order-retry.png"),
      scale: "css",
      animations: "disabled",
    });
  } finally {
    await rm(layoutPath, { recursive: true, force: true });
    await rename(`${layoutPath}.qa`, layoutPath);
  }
  await popup.getByRole("button", { name: "重试保存", exact: true }).click();
  await waitSaved(retryOrder);
  // An unsaved inline move cannot overwrite a newer selection from the main window.
  await rename(layoutPath, `${layoutPath}.qa`);
  await mkdir(layoutPath);
  try {
    await primaryHandle.press("ArrowDown");
    await popup.getByText("顺序未能保存", { exact: true }).waitFor();
  } finally {
    await rm(layoutPath, { recursive: true, force: true });
    await rename(`${layoutPath}.qa`, layoutPath);
  }
  await setBlocks(fullBlocks.slice(0, -1));
  await popup.getByText("组合已在主窗口更新", { exact: true }).waitFor();
  assert.equal(await popup.getByRole("button", { name: "重试保存", exact: true }).count(), 0);
  await popup.getByRole("button", { name: "载入最新顺序", exact: true }).click();
  assert.deepEqual(await order(), fullBlocks.slice(0, -1));
  // Native blur hides the panel; a completed move has already been persisted.
  await application.evaluate(({ app }) => app.focus({ steal: true }));
  await nativePopup.evaluate((window) => {
    window.show();
    window.focus();
  });
  const focusDeadline = Date.now() + 8000;
  while (!(await nativePopup.evaluate((window) => window.isFocused()))) {
    assert(
      Date.now() < focusDeadline,
      "The native popover must acquire focus before blur is tested",
    );
    await new Promise((resolve) => setTimeout(resolve, 30));
  }
  await window.evaluate((window) => {
    window.show();
    window.focus();
  });
  await popup.waitForFunction(
    () => document.querySelector(".glance-shell")?.getAttribute("data-visible") === "false",
    undefined,
    { polling: 50 },
  );
  assert.equal(await nativePopup.evaluate((window) => window.isVisible()), false);
  await ensurePopupVisible();
  assert.deepEqual(await order(), fullBlocks.slice(0, -1));
  assert.deepEqual((await read(page)).value.value.blocks, fullBlocks.slice(0, -1));
  const visibilityEvents = await popup.evaluate(() => window.__glanceVisibility);
  assert(visibilityEvents.includes(false) && visibilityEvents.at(-1) === true);
  assert(visibilityEvents.every((value) => typeof value === "boolean"));
  assert.deepEqual(await page.evaluate(() => window.__glanceVisibility), []);
  await popup.reload();
  await popup.waitForFunction(
    () => document.querySelector(".glance-shell")?.getAttribute("data-visible") === "true",
  );
  await popup.locator('[data-sort-handle="usage.primary"]').waitFor();
  await setBlocks(["appearance.status"]);
  assert.equal(
    (await page.evaluate(() => window.codexCoco.modules())).value.every(
      (module) => module.phase === "disabled",
    ),
    true,
  );
  await popup.keyboard.press("Escape");
  await page.bringToFront();
  await page.getByRole("navigation").getByRole("button", { name: "外观", exact: true }).click();
  await page.getByRole("button", { name: "从速览移除布景连接状态", exact: true }).click();
  await page.getByRole("button", { name: "添加到速览：布景连接状态", exact: true }).waitFor();
  assert.deepEqual((await read(page)).value.value.blocks, []);
  await page.getByRole("button", { name: "添加到速览：布景连接状态", exact: true }).click();
  await page.getByRole("button", { name: "从速览移除布景连接状态", exact: true }).waitFor();
  assert.deepEqual(errors, []);
  await application.close();
  ({ application, page, errors } = await launch());
  assert.deepEqual((await read(page)).value.value.blocks, ["appearance.status"]);
  await application.close();
  const path = join(data, "glance-layout.json");
  await writeFile(path, "damaged-glance-layout");
  ({ application, page, errors } = await launch());
  await page.getByRole("button", { name: "备份并恢复速览设置", exact: true }).click();
  await page.getByText("速览设置已备份并恢复。", { exact: true }).waitFor();
  const backup = (await readdir(data)).find((entry) =>
    entry.startsWith("glance-layout.json.backup-"),
  );
  assert.equal(await readFile(join(data, backup), "utf8"), "damaged-glance-layout");
  assert.deepEqual((await read(page)).value.value, initial.value.value);
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify(
      {
        ok: true,
        packaged,
        draftAndCancel: true,
        orderedPersistence: true,
        conflictProtection: true,
        sourcePinning: true,
        restrictedPanelReordering: true,
        nativeDragAndKeyboard: true,
        inlineAutoSaveCancelBlurAndConflict: true,
        persistenceFailureRetry: true,
        restartAndRecovery: true,
        noModuleActivation: true,
        observerFailureIsolation: true,
        output,
      },
      null,
      2,
    ),
  );
} finally {
  await session?.application.close();
  await rm(directory, { recursive: true, force: true });
}
