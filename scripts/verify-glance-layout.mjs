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
    await popup.getByRole("button", { name: "调整速览顺序", exact: true }).isDisabled(),
    true,
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
  await popup.getByRole("button", { name: "调整速览顺序", exact: true }).click();
  assert.deepEqual(await order(), fullBlocks);
  const primaryHandle = popup.getByRole("button", { name: "拖动主要额度窗口排序", exact: true });
  const todayHandle = popup.getByRole("button", { name: "拖动今日消耗排序", exact: true });
  await primaryHandle.dragTo(todayHandle, { targetPosition: { x: 80, y: 44 } });
  assert.deepEqual((await order()).slice(0, 3), [
    "usage.secondary",
    "usage.today",
    "usage.primary",
  ]);
  assert.deepEqual(
    (await read(page)).value.value.blocks,
    fullBlocks,
    "Dragging only edits a local draft",
  );
  await primaryHandle.focus();
  await primaryHandle.press("ArrowUp");
  assert.equal(await primaryHandle.evaluate((node) => node === document.activeElement), true);
  const reordered = await order();
  assert.deepEqual(reordered.slice(0, 3), ["usage.secondary", "usage.primary", "usage.today"]);
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
  assert.deepEqual(await order(), reordered, "Theme changes must not replace the sorting draft");
  await popup.screenshot({
    path: join(output, "popup-order-dark.png"),
    scale: "css",
    animations: "disabled",
  });
  assert(
    await popup.locator(".glance-content").evaluate((node) => node.scrollWidth <= node.clientWidth),
  );
  const footerBounds = await popup
    .getByRole("button", { name: "完成排序", exact: true })
    .boundingBox();
  assert(
    footerBounds && footerBounds.y + footerBounds.height <= 520,
    "Completion stays outside the scrolling list",
  );
  await popup.getByRole("button", { name: "完成排序", exact: true }).click();
  await popup.getByText("速览顺序已保存。", { exact: true }).waitFor();
  const reorderedSnapshot = (await read(page)).value;
  assert.equal(reorderedSnapshot.revision, reorderBase.revision + 1);
  assert.deepEqual(reorderedSnapshot.value.blocks, reordered);
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
  // Keyboard boundary moves and Escape discard the draft without closing the panel.
  await popup.getByRole("button", { name: "调整速览顺序", exact: true }).click();
  await primaryHandle.press("End");
  assert.equal((await order()).at(-1), "usage.primary");
  await primaryHandle.press("Home");
  assert.equal((await order())[0], "usage.primary");
  await popup.keyboard.press("Escape");
  assert.equal(await popup.getByRole("main", { name: "调整速览顺序", exact: true }).count(), 0);
  assert.deepEqual((await read(page)).value.value.blocks, reordered);
  // A persistence failure retains both the draft and the saved revision for an explicit retry.
  await popup.getByRole("button", { name: "调整速览顺序", exact: true }).click();
  await popup.getByRole("button", { name: "下移其他额度窗口", exact: true }).click();
  const retryOrder = await order();
  const layoutPath = join(data, "glance-layout.json");
  await rename(layoutPath, `${layoutPath}.qa`);
  await mkdir(layoutPath);
  try {
    await popup.getByRole("button", { name: "完成排序", exact: true }).click();
    await popup.getByText("顺序未能保存", { exact: true }).waitFor();
    assert.deepEqual(await order(), retryOrder);
    assert.equal((await read(page)).value.revision, reorderedSnapshot.revision);
    await popup.screenshot({
      path: join(output, "popup-order-retry.png"),
      scale: "css",
      animations: "disabled",
    });
  } finally {
    await rm(layoutPath, { recursive: true, force: true });
    await rename(`${layoutPath}.qa`, layoutPath);
  }
  await popup.getByRole("button", { name: "完成排序", exact: true }).click();
  await popup.getByText("速览顺序已保存。", { exact: true }).waitFor();
  assert.deepEqual((await read(page)).value.value.blocks, retryOrder);
  await popup.getByRole("button", { name: "调整速览顺序", exact: true }).click();
  await popup.getByRole("button", { name: "下移主要额度窗口", exact: true }).click();
  const staleDraft = await order();
  await setBlocks(fullBlocks.slice(0, -1));
  await popup.getByText("组合已在主窗口更新", { exact: true }).waitFor();
  assert.deepEqual(await order(), staleDraft);
  assert.equal(
    await popup.getByRole("button", { name: "完成排序", exact: true }).isDisabled(),
    true,
  );
  await popup.getByRole("button", { name: "载入最新顺序", exact: true }).click();
  assert.deepEqual(await order(), fullBlocks.slice(0, -1));
  await popup.getByRole("button", { name: "取消排序", exact: true }).click();
  // Native blur hides the popover and discards unsaved ordering.
  await popup.getByRole("button", { name: "调整速览顺序", exact: true }).click();
  await popup.getByRole("button", { name: "下移主要额度窗口", exact: true }).click();
  await application.evaluate(({ app }) => app.focus({ steal: true }));
  await nativePopup.evaluate((window) => {
    window.show();
    window.focus();
  });
  const focusDeadline = Date.now() + 8000;
  while (!(await nativePopup.evaluate((window) => window.isFocused()))) {
    assert(
      Date.now() < focusDeadline,
      "The native popover must actually acquire focus before blur is tested",
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
    {
      polling: 50,
    },
  );
  assert.equal(await nativePopup.evaluate((window) => window.isVisible()), false);
  await application.evaluate(({ Menu }) =>
    Menu.getApplicationMenu()
      .items.flatMap((item) => item.submenu?.items ?? [])
      .find((item) => item.label === "显示或收起速览")
      .click(),
  );
  await popup.waitForFunction(
    () => document.querySelector(".glance-shell")?.getAttribute("data-visible") === "true",
  );
  assert.equal(await popup.getByRole("main", { name: "调整速览顺序", exact: true }).count(), 0);
  assert.deepEqual((await read(page)).value.value.blocks, fullBlocks.slice(0, -1));
  const visibilityEvents = await popup.evaluate(() => window.__glanceVisibility);
  assert(visibilityEvents.includes(false) && visibilityEvents.at(-1) === true);
  assert(visibilityEvents.every((value) => typeof value === "boolean"));
  assert.deepEqual(await page.evaluate(() => window.__glanceVisibility), []);
  await popup.reload();
  await popup.waitForFunction(
    () => document.querySelector(".glance-shell")?.getAttribute("data-visible") === "true",
  );
  await popup.getByRole("button", { name: "调整速览顺序", exact: true }).waitFor();
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
        draftCancelBlurAndConflict: true,
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
