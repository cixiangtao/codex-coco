import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { createDesktopSession } from "./verify-desktop.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const packaged = process.argv.includes("--packaged");
const directory = await mkdtemp(join(tmpdir(), "codex-coco-usage-desktop-"));
const bin = join(directory, "bin");
const mode = join(directory, "mode");
const trace = join(directory, "trace.jsonl");
const output = join(
  root,
  packaged ? "work/usage-verification-packaged" : "work/usage-verification",
);
await mkdir(bin);
await mkdir(output, { recursive: true });
await writeFile(mode, "ready");
await writeFile(
  join(bin, "codex"),
  `#!${process.execPath}\n${await readFile(join(root, "tests/fixtures/usage-server.mjs"), "utf8")}`,
  { mode: 0o700 },
);
const environment = {
  ...process.env,
  CODEX_COCO_FIXTURES: "0",
  PATH: `${bin}:${process.env.PATH ?? ""}`,
  FAKE_USAGE_MODE_FILE: mode,
  FAKE_USAGE_TRACE: trace,
  CODEX_HOME: join(directory, "isolated-codex"),
};
let session;
async function traces() {
  try {
    return (await readFile(trace, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
  } catch {
    return [];
  }
}
async function snapshot(page) {
  const response = await page.evaluate(() => window.codexCoco.modules());
  assert.equal(response.ok, true);
  return response.value.find((item) => item.id === "usage");
}
async function task(page, phase, previousId) {
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    const current = await snapshot(page);
    if (current.operation?.phase === phase && (!previousId || current.operation.id !== previousId))
      return current;
    await delay(30);
  }
  assert.fail(`Usage did not reach ${phase}`);
}
async function capture(page, name) {
  await page.screenshot({ path: join(output, name), scale: "css", animations: "disabled" });
}
async function toggle(application) {
  await application.evaluate(({ Menu }) =>
    Menu.getApplicationMenu()
      .items.flatMap((item) => item.submenu?.items ?? [])
      .find((item) => item.label === "显示或收起速览")
      .click(),
  );
}
async function assertChildrenExited() {
  for (const pid of new Set((await traces()).map((item) => item.pid)))
    assert.throws(() => process.kill(pid, 0));
}
try {
  session = await createDesktopSession(
    join(directory, "data"),
    environment,
    packaged
      ? join(root, "apps/desktop/release/mac-arm64/Codex Coco.app/Contents/MacOS/Codex Coco")
      : undefined,
  );
  const { page, application, errors } = session;
  const nav = page.getByRole("navigation", { name: "应用导航" });
  await nav.getByRole("button", { name: "用量", exact: true }).click();
  await page.getByRole("heading", { name: "按需读取用量", exact: true }).waitFor();
  assert.deepEqual(await traces(), []);
  await writeFile(mode, "hang");
  await page.getByRole("button", { name: "启用并读取用量", exact: true }).click();
  await page.getByLabel("正在读取用量", { exact: true }).waitFor();
  await page.getByRole("button", { name: "取消读取", exact: true }).click();
  await task(page, "cancelled");
  await page.getByRole("heading", { name: "读取已取消", exact: true }).waitFor();
  await assertChildrenExited();
  await writeFile(mode, "ready");
  await page.getByRole("button", { name: "刷新用量", exact: true }).click();
  await page.getByText("剩余 75%", { exact: true }).waitFor();
  await page.getByText("剩余 40%", { exact: true }).waitFor();
  assert.equal((await snapshot(page)).phase, "running");
  assert.equal((await snapshot(page)).config.value.refreshIntervalSeconds, 0);
  assert.equal((await snapshot(page)).config.value.notificationsEnabled, false);
  await assertChildrenExited();
  await capture(page, "ready.png");
  const calls = (await traces()).filter((item) => item.method === "spawn").length;

  const popupEvent = application.waitForEvent("window");
  await toggle(application);
  const popup = await popupEvent;
  await popup.getByText("剩余 75%", { exact: true }).waitFor();
  const summary = await popup.evaluate(() => window.codexCoco.glance());
  assert.equal(summary.ok, true);
  assert(!JSON.stringify(summary).match(/private|email|accessToken|operation|config/));
  const forbidden = await popup.evaluate(() =>
    window.codexCoco.runModuleOperation({ moduleId: "usage", operation: "refresh", input: {} }),
  );
  assert.equal(forbidden.error.code, "FORBIDDEN");
  await capture(popup, "glance.png");
  await popup.keyboard.press("Escape");
  await page.bringToFront();

  const anotherEvent = application.waitForEvent("window");
  await application.evaluate(({ Menu }) =>
    Menu.getApplicationMenu()
      .items.flatMap((item) => item.submenu?.items ?? [])
      .find((item) => item.label === "新建窗口")
      .click(),
  );
  const another = await anotherEvent;
  await another.getByRole("navigation").getByRole("button", { name: "用量", exact: true }).click();
  await another.getByText("剩余 75%", { exact: true }).waitFor();
  assert.equal((await traces()).filter((item) => item.method === "spawn").length, calls);
  await (await application.browserWindow(another)).evaluate((window) => window.close());
  await page.bringToFront();

  console.log("QA: failure first, hidden previous records, read-only glance and recovery");
  await writeFile(mode, "error");
  await page.getByRole("button", { name: "刷新用量", exact: true }).click();
  await page.getByText("暂时无法更新用量", { exact: true }).waitFor();
  assert.equal(await page.locator(".usage-previous").getAttribute("open"), null);
  assert.equal(await page.getByText("剩余 75%", { exact: true }).isVisible(), false);
  await capture(page, "failure.png");
  await toggle(application);
  await popup.getByText("暂时无法更新用量", { exact: true }).waitFor();
  const failedSummary = await popup.evaluate(() => window.codexCoco.glance());
  const usage = failedSummary.value.items.find((item) => item.id === "usage");
  assert.equal(usage.phase, "error");
  assert.equal(usage.metrics, undefined);
  assert.equal(await popup.getByText("剩余 75%", { exact: true }).count(), 0);
  await capture(popup, "glance-failure.png");
  await popup.keyboard.press("Escape");
  await page.bringToFront();
  await page.getByText("查看上次成功记录（非当前状态）", { exact: true }).click();
  await page.getByText("剩余 75%", { exact: true }).waitFor();
  await writeFile(mode, "ready");
  const failedOperationId = (await snapshot(page)).operation.id;
  await page.getByRole("button", { name: "重新读取", exact: true }).click();
  await page.getByText("剩余 75%", { exact: true }).waitFor();
  const recovered = await task(page, "succeeded", failedOperationId);
  assert.equal(recovered.operation.result.status, "ready");

  await nav.getByRole("button", { name: "设置", exact: true }).click();
  await page.getByRole("button", { name: "深色", exact: true }).click();
  await nav.getByRole("button", { name: "用量", exact: true }).click();
  await capture(page, "dark.png");
  const window = await application.browserWindow(page);
  await window.evaluate((window) => window.setSize(720, 640));
  await page.waitForFunction(() => innerWidth === 720);
  await capture(page, "compact.png");
  assert.equal(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth > innerWidth ||
        document.querySelector(".desktop-content").scrollWidth >
          document.querySelector(".desktop-content").clientWidth,
    ),
    false,
  );

  await writeFile(mode, "signed-out");
  await page.getByRole("button", { name: "刷新用量", exact: true }).click();
  await page.getByText("Codex CLI 尚未登录", { exact: true }).waitFor();
  await writeFile(mode, "hang");
  await page.getByRole("button", { name: "重新读取", exact: true }).click();
  await page.getByRole("button", { name: "取消读取", exact: true }).click();
  await task(page, "cancelled");
  await page.getByText("任务已取消，已读取的数据已保留。", { exact: true }).waitFor();
  await page.getByText("Codex CLI 尚未登录", { exact: true }).waitFor();
  await assertChildrenExited();
  await page.getByRole("button", { name: "重新读取", exact: true }).click();
  await task(page, "running");
  await application.close();
  session = undefined;
  await assertChildrenExited();
  const beforeRestart = (await traces()).length;
  session = await createDesktopSession(
    join(directory, "data"),
    environment,
    packaged
      ? join(root, "apps/desktop/release/mac-arm64/Codex Coco.app/Contents/MacOS/Codex Coco")
      : undefined,
  );
  await session.page
    .getByRole("navigation")
    .getByRole("button", { name: "用量", exact: true })
    .click();
  await session.page.getByRole("heading", { name: "准备读取额度", exact: true }).waitFor();
  assert.equal(
    (await traces()).length,
    beforeRestart,
    "Restoring enable intent must not read an account",
  );
  await writeFile(mode, "ready");
  await session.page.getByRole("button", { name: "刷新用量", exact: true }).click();
  await session.page.getByText("剩余 75%", { exact: true }).waitFor();
  await assertChildrenExited();
  assert.deepEqual(errors, []);
  assert.deepEqual(session.errors, []);
  assert(
    !(await session.page
      .locator("body")
      .innerText()
      .then((text) => /private-token|private@example/.test(text))),
  );
  const logDirectory = join(directory, "data/diagnostics");
  const logs = await Promise.all(
    (await readdir(logDirectory)).map((name) => readFile(join(logDirectory, name), "utf8")),
  );
  assert(!logs.join("\n").match(/private-token|private@example|accessToken/));
  console.log(
    JSON.stringify(
      {
        ok: true,
        packaged,
        optIn: true,
        sharedSnapshot: true,
        failedDataHidden: true,
        cancellation: true,
        restartWithoutRead: true,
        privateDataExcluded: true,
        screenshots: output,
      },
      null,
      2,
    ),
  );
} finally {
  await session?.application.close();
  await rm(directory, { recursive: true, force: true });
}
