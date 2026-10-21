import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, writeFile, rm, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { createDesktopSession } from "./verify-desktop.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const id = "foundation-fixture";
const peerId = "foundation-peer";

async function snapshots(page) {
  const result = await page.evaluate(() => window.codexCoco.modules());
  assert.equal(result.ok, true);
  return result.value;
}
async function waitModules(page, predicate) {
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    const values = await snapshots(page);
    if (predicate(values)) return values;
    await delay(30);
  }
  assert.fail("Timed out waiting for module state");
}
async function waitTask(page, moduleId, phase) {
  await waitModules(
    page,
    (values) => values.find((item) => item.id === moduleId)?.operation?.phase === phase,
  );
}
async function newWindow(application) {
  const event = application.waitForEvent("window");
  await application.evaluate(({ Menu }) => {
    Menu.getApplicationMenu()
      .items.flatMap((entry) => entry.submenu?.items ?? [])
      .find((item) => item.label === "新建窗口")
      .click();
  });
  const page = await event;
  await page.getByRole("heading", { name: "Codex Coco", exact: true }).waitFor();
  return page;
}

const directory = await mkdtemp(join(tmpdir(), "codex-coco-module-desktop-"));
let session;
const environment = { ...process.env, CODEX_COCO_FIXTURES: "1" };
try {
  session = await createDesktopSession(directory, { ...process.env, CODEX_COCO_FIXTURES: "0" });
  assert.deepEqual(await snapshots(session.page), []);
  await session.application.close();
  session = await createDesktopSession(directory, environment);
  const { application, page, errors } = session;
  const panel = page.getByRole("region", { name: "模块验收示例", exact: true });
  const peer = page.getByRole("region", { name: "独立模块示例", exact: true });
  await panel.getByRole("button", { name: "启用模块", exact: true }).click();
  await peer.getByRole("button", { name: "启用模块", exact: true }).click();
  await waitModules(page, (values) => values.every((item) => item.phase === "running"));
  console.log("QA: whitelist, progress, independent tasks and config");
  const invalid = await page.evaluate(
    async (moduleId) => [
      await window.codexCoco.runModuleOperation({ moduleId, operation: "unknown", input: {} }),
      await window.codexCoco.runModuleOperation({
        moduleId,
        operation: "count",
        input: { steps: -1 },
      }),
      await window.codexCoco.enableModule({ moduleId: "../outside", enabled: true }),
    ],
    id,
  );
  assert.deepEqual(
    invalid.map((result) => result.error.code),
    ["UNKNOWN_OPERATION", "INVALID_INPUT", "INVALID_INPUT"],
  );
  await page.evaluate(() => {
    window.__moduleEvents = [];
    window.__stopModuleEvents = window.codexCoco.onModuleChanged((value) =>
      window.__moduleEvents.push(value),
    );
  });
  await panel.getByRole("button", { name: "运行合成任务", exact: true }).click();
  await waitModules(
    page,
    (values) => values.find((item) => item.id === id)?.operation?.progress > 0,
  );
  await panel.getByLabel("合成任务名称", { exact: true }).fill("下一次任务");
  await panel.getByRole("button", { name: "保存模块配置", exact: true }).click();
  await peer.getByLabel("合成任务名称", { exact: true }).fill("独立配置");
  await peer.getByRole("button", { name: "保存模块配置", exact: true }).click();
  await peer.getByRole("button", { name: "运行合成任务", exact: true }).click();
  await waitTask(page, id, "succeeded");
  assert.equal(
    (await snapshots(page)).find((item) => item.id === id).operation.result.label,
    "合成任务",
  );
  await waitTask(page, peerId, "succeeded");
  assert.equal(
    (await snapshots(page)).find((item) => item.id === peerId).operation.result.label,
    "独立配置",
  );
  const events = await page.evaluate(() => {
    window.__stopModuleEvents();
    return window.__moduleEvents;
  });
  assert.ok(events.some((item) => item.operation?.progress > 0 && item.operation.progress < 100));
  for (const moduleId of [id, peerId]) {
    const values = events.filter((item) => item.id === moduleId);
    assert.ok(
      values.every((item, index) => index === 0 || item.revision > values[index - 1].revision),
    );
  }
  const eventCount = events.length;
  await panel.getByRole("button", { name: "运行合成任务", exact: true }).click();
  await panel.getByRole("button", { name: "取消合成任务", exact: true }).click();
  await waitTask(page, id, "cancelled");
  assert.equal((await snapshots(page)).find((item) => item.id === id).operation.result, null);
  assert.equal(await page.evaluate(() => window.__moduleEvents.length), eventCount);
  await panel.getByRole("button", { name: "运行合成任务", exact: true }).click();
  await panel.getByRole("button", { name: "停用模块", exact: true }).click();
  await panel.getByRole("button", { name: "启用模块", exact: true }).waitFor();
  await panel.getByRole("button", { name: "启用模块", exact: true }).click();
  await panel.getByRole("button", { name: "运行合成任务", exact: true }).click();
  await waitTask(page, id, "succeeded");
  let current = (await snapshots(page)).find((item) => item.id === id);
  assert.equal(current.generation, 2);
  assert.equal(current.operation.result.label, "下一次任务");

  console.log("QA: multiple windows, local drafts, stale revision");
  const second = await newWindow(application);
  const secondPanel = second.getByRole("region", { name: "模块验收示例", exact: true });
  await panel.getByLabel("合成任务名称", { exact: true }).fill("未保存草稿");
  assert.equal(
    await secondPanel.getByLabel("合成任务名称", { exact: true }).inputValue(),
    "下一次任务",
  );
  await secondPanel.getByLabel("合成任务名称", { exact: true }).fill("跨窗保存");
  await secondPanel.getByRole("button", { name: "保存模块配置", exact: true }).click();
  await panel.getByText("配置已在其他窗口更新，请取消草稿后重试。", { exact: true }).waitFor();
  assert.equal(await panel.getByLabel("合成任务名称", { exact: true }).inputValue(), "未保存草稿");
  assert.equal(
    await panel.getByRole("button", { name: "保存模块配置", exact: true }).isDisabled(),
    true,
  );
  const stale = await page.evaluate(
    ({ moduleId, revision }) =>
      window.codexCoco.saveModuleConfig({
        moduleId,
        expectedRevision: revision,
        value: { label: "旧写入" },
      }),
    { moduleId: id, revision: current.config.revision },
  );
  assert.equal(stale.error.code, "CONFLICT");
  await panel.getByRole("button", { name: "取消模块草稿", exact: true }).click();
  assert.equal(await panel.getByLabel("合成任务名称", { exact: true }).inputValue(), "跨窗保存");

  console.log("QA: no-window background, reopen, restart and damaged config");
  await page.evaluate(
    (moduleId) =>
      window.codexCoco.runModuleOperation({ moduleId, operation: "count", input: { steps: 20 } }),
    id,
  );
  const closed = application.windows().map((window) => window.waitForEvent("close"));
  await application.evaluate(({ BrowserWindow }) => {
    for (const window of BrowserWindow.getAllWindows()) window.close();
  });
  await Promise.all(closed);
  const reopen = application.waitForEvent("window");
  await application.evaluate(({ app }) => app.emit("activate"));
  const reopened = await reopen;
  await reopened.getByRole("heading", { name: "Codex Coco", exact: true }).waitFor();
  current = (await snapshots(reopened)).find((item) => item.id === id);
  assert.equal(current.operation.name, "count");
  assert.equal(current.config.value.label, "跨窗保存");
  await waitTask(reopened, id, "succeeded");
  await reopened.evaluate(
    (moduleId) =>
      window.codexCoco.runModuleOperation({ moduleId, operation: "count", input: { steps: 20 } }),
    id,
  );
  assert.deepEqual(errors, []);
  const screenshotDirectory = join(root, "work/module-verification");
  await mkdir(screenshotDirectory, { recursive: true });
  await reopened
    .getByRole("region", { name: "模块验收示例", exact: true })
    .scrollIntoViewIfNeeded();
  await reopened.screenshot({ path: join(screenshotDirectory, "module-loop.png"), scale: "css" });
  await application.close();
  session = await createDesktopSession(directory, environment);
  current = (await snapshots(session.page)).find((item) => item.id === id);
  assert.equal(current.phase, "running");
  assert.equal(current.config.value.label, "跨窗保存");
  assert.equal(current.operation, null);
  assert.deepEqual(session.errors, []);
  await session.application.close();
  await writeFile(join(directory, "modules", `${id}.json`), "damaged module config");
  session = await createDesktopSession(directory, environment);
  const damaged = session.page.getByRole("region", { name: "模块验收示例", exact: true });
  assert.equal((await snapshots(session.page)).find((item) => item.id === peerId).phase, "running");
  assert.equal(
    await readFile(join(directory, "modules", `${id}.json`), "utf8"),
    "damaged module config",
  );
  await damaged.getByRole("button", { name: "备份并恢复模块配置", exact: true }).click();
  await damaged.getByRole("button", { name: "启用模块", exact: true }).waitFor();
  const backup = (await readdir(join(directory, "modules"))).find((name) =>
    name.startsWith(`${id}.json.backup-`),
  );
  assert.ok(backup);
  assert.equal(await readFile(join(directory, "modules", backup), "utf8"), "damaged module config");
  assert.deepEqual(session.errors, []);
  console.log(
    JSON.stringify(
      {
        ok: true,
        moduleLoop: true,
        crossWindow: true,
        restartPersistence: true,
        isolatedRecovery: true,
        screenshot: join(screenshotDirectory, "module-loop.png"),
      },
      null,
      2,
    ),
  );
} finally {
  await session?.application.close();
  await rm(directory, { recursive: true, force: true });
}
