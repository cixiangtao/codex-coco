import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, writeFile, rm } from "node:fs/promises";
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
  const popupEvent = application.waitForEvent("window");
  await application.evaluate(({ Menu }) =>
    Menu.getApplicationMenu()
      .items.flatMap((item) => item.submenu?.items ?? [])
      .find((item) => item.label === "显示或收起速览")
      .click(),
  );
  const popup = await popupEvent;
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
        readOnlyPanel: true,
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
