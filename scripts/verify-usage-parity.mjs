import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { createDesktopSession } from "./verify-desktop.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const directory = await mkdtemp(join(tmpdir(), "codex-coco-usage-parity-"));
const home = join(directory, "account-a");
const other = join(directory, "account-b");
const bin = join(directory, "bin");
const trace = join(directory, "trace");
const packaged = process.argv.includes("--packaged");
await mkdir(bin);
await writeFile(
  join(bin, "codex"),
  `#!${process.execPath}\n${await readFile(join(root, "tests/fixtures/usage-server.mjs"), "utf8")}`,
  { mode: 0o700 },
);
async function record(home, id, daysAgo, tokens) {
  await mkdir(join(home, "sessions"), { recursive: true });
  const time = new Date();
  time.setDate(time.getDate() - daysAgo);
  time.setSeconds(time.getSeconds() - 2);
  const lines = [
    { type: "session_meta", payload: { id } },
    {
      type: "event_msg",
      timestamp: time.toISOString(),
      payload: {
        type: "token_count",
        info: {
          total_token_usage: { total_tokens: tokens },
          last_token_usage: { total_tokens: tokens },
        },
        rate_limits: { limit_id: "codex_spark" },
      },
    },
  ];
  await writeFile(
    join(home, "sessions", `${id}.jsonl`),
    lines.map((v) => JSON.stringify(v)).join("\n") + "\n",
  );
}
await record(home, "today", 0, 100);
await record(home, "week-before", 8, 200);
await record(home, "month-before", 20, 300);
await record(other, "other-today", 0, 2000);
let session;
async function state(page, moduleId = "usage") {
  return page.evaluate(
    async (id) => (await window.codexCoco.modules()).value.find((m) => m.id === id),
    moduleId,
  );
}
async function task(page, operation, input = {}, moduleId = "usage") {
  const response = await page.evaluate(
    ({ operation, input, moduleId }) =>
      window.codexCoco.runModuleOperation({ moduleId, operation, input }),
    { operation, input, moduleId },
  );
  assert.equal(response.ok, true);
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    const current = await state(page, moduleId);
    if (current.operation?.id === response.value.operation.id) {
      if (current.operation.phase === "succeeded") return current;
      if (current.operation.phase === "failed") assert.fail(`${operation} failed`);
    }
    await delay(30);
  }
  assert.fail(`${operation} timed out`);
}
async function configure(page, moduleId, patch) {
  const s = await state(page, moduleId);
  const response = await page.evaluate(
    ({ moduleId, revision, value }) =>
      window.codexCoco.saveModuleConfig({ moduleId, expectedRevision: revision, value }),
    { moduleId, revision: s.config.revision, value: { ...s.config.value, ...patch } },
  );
  assert.equal(response.ok, true);
}
try {
  session = await createDesktopSession(
    join(directory, "data"),
    {
      ...process.env,
      CODEX_COCO_FIXTURES: "0",
      CODEX_HOME: home,
      PATH: `${bin}:${process.env.PATH ?? ""}`,
      FAKE_USAGE_MODE: "ready",
      FAKE_USAGE_TRACE: trace,
      // Production builds must ignore an inherited development server URL.
      ELECTRON_RENDERER_URL: "http://127.0.0.1:1",
    },
    packaged
      ? join(root, "apps/desktop/release/mac-arm64/Codex Coco.app/Contents/MacOS/Codex Coco")
      : undefined,
  );
  const { page, application, errors } = session;
  assert.equal(page.url(), "app://codex-coco/index.html");
  await application.evaluate(({ Tray }) => {
    globalThis.parityImages = [];
    globalThis.parityTitles = [];
    const setTitle = Tray.prototype.setTitle;
    Tray.prototype.setTitle = function (...args) {
      const result = setTitle.apply(this, args);
      globalThis.parityTitles.push(this.getTitle());
      return result;
    };
    const original = Tray.prototype.setImage;
    Tray.prototype.setImage = function (image) {
      globalThis.parityTitles.push(this.getTitle());
      globalThis.parityImages.push({ template: image.isTemplateImage(), size: image.getSize() });
      return original.call(this, image);
    };
    globalThis.fetch = async () =>
      new Response(JSON.stringify({ tag_name: "rust-v1.2.3", draft: false, prerelease: false }));
  });
  await page.evaluate(() =>
    window.codexCoco.enableModule({ moduleId: "desktop-tools", enabled: true }),
  );
  await task(page, "apply-menu-bar", {}, "desktop-tools");
  assert.equal(await application.evaluate(() => globalThis.parityTitles.at(-1)), "");
  await page.getByRole("navigation").getByRole("button", { name: "用量", exact: true }).click();
  await page.getByRole("button", { name: "启用并读取用量", exact: true }).click();
  await page.getByText("30 天 · 600 tokens", { exact: true }).waitFor();
  await page
    .getByLabel("账号信息", { exact: true })
    .getByText("p***e@example.com", { exact: true })
    .waitFor();
  await page.getByText("ChatGPT Plus", { exact: true }).waitFor();
  assert.equal((await state(page)).state.trend.points.at(-1).tokens, 100);
  await page.getByRole("button", { name: "7 天", exact: true }).click();
  await page.getByText("7 天 · 100 tokens", { exact: true }).waitFor();
  await page.getByRole("button", { name: "14 天", exact: true }).click();
  await page.getByText("14 天 · 300 tokens", { exact: true }).waitFor();
  await page.getByText("查看每日计数", { exact: true }).click();
  assert.equal(await page.getByRole("table").getByRole("row").count(), 15);
  await page.getByRole("tab", { name: "辅助工具", exact: true }).click();
  await page.getByRole("button", { name: "读取可用模型", exact: true }).click();
  await page.getByRole("button", { name: "受控模型", exact: true }).waitFor();
  await page.getByRole("tab", { name: "总览", exact: true }).click();
  await page.getByText("剩余 75%", { exact: true }).waitFor();
  await page.getByText("14 天 · 300 tokens", { exact: true }).waitFor();
  await task(page, "check-cli");
  const run = await page.evaluate(() =>
    window.codexCoco.runModuleOperation({
      moduleId: "usage",
      operation: "run-intelligence",
      input: { model: null, effort: null, runs: 1 },
    }),
  );
  assert.equal(run.ok, true);
  const until = Date.now() + 5000;
  while (Date.now() < until) {
    if ((await readFile(trace, "utf8")).includes('"method":"exec"')) break;
    await delay(30);
  }
  await page.getByText("剩余 75%", { exact: true }).waitFor();
  await page.getByRole("button", { name: "取消任务", exact: true }).click();
  await page.getByText("任务已取消，已读取的数据已保留。", { exact: true }).waitFor();
  await page.getByText("剩余 75%", { exact: true }).waitFor();
  await page.getByText("14 天 · 300 tokens", { exact: true }).waitFor();
  const newWindow = application.waitForEvent("window");
  await application.evaluate(({ Menu }) =>
    Menu.getApplicationMenu()
      .items.flatMap((item) => item.submenu?.items ?? [])
      .find((item) => item.label === "新建窗口")
      .click(),
  );
  const another = await newWindow;
  await another.getByRole("navigation").getByRole("button", { name: "用量", exact: true }).click();
  await another.getByText("剩余 75%", { exact: true }).waitFor();
  await another.getByText("14 天 · 300 tokens", { exact: true }).waitFor();
  await (await application.browserWindow(another)).evaluate((window) => window.close());
  await page.bringToFront();
  const popupEvent = application.waitForEvent("window");
  await application.evaluate(({ Menu }) =>
    Menu.getApplicationMenu()
      .items.flatMap((item) => item.submenu?.items ?? [])
      .find((item) => item.label === "显示或收起速览")
      .click(),
  );
  const popup = await popupEvent;
  const glance = await popup.evaluate(() => window.codexCoco.glance());
  const usage = glance.value.items.find((item) => item.id === "usage");
  assert.equal(usage.phase, "running");
  assert.equal(usage.statusText, "5h 75% · 7d 40%");
  assert.equal(await application.evaluate(() => globalThis.parityTitles.at(-1)), usage.statusText);
  assert.equal(usage.metrics.find((metric) => metric.id === "tokens:today").value, "100 tokens");
  assert.match(usage.description, /p\*\*\*e@example\.com.*Plus/);
  assert(!JSON.stringify(glance).match(/private@example|private-token|account-a/));
  await popup.keyboard.press("Escape");
  await page.bringToFront();
  // Break only local source metadata: quota remains ready, stale trend disappears everywhere.
  const localSource = join(directory, "data/usage-local/source.json");
  await writeFile(localSource, "invalid-source");
  await page.evaluate(() =>
    window.codexCoco.runModuleOperation({
      moduleId: "usage",
      operation: "scan-trend",
      input: { force: false },
    }),
  );
  await page.getByText("本地统计未完成", { exact: true }).waitFor();
  await page.getByText("剩余 75%", { exact: true }).waitFor();
  assert.equal((await state(page)).state.trend, null);
  await task(page, "check-cli");
  await page.getByText("本地统计未完成", { exact: true }).waitFor();
  const failedTrendGlance = await popup.evaluate(() => window.codexCoco.glance());
  assert(
    !failedTrendGlance.value.items
      .find((item) => item.id === "usage")
      .metrics.some((metric) => metric.id.startsWith("tokens:")),
  );
  await rm(localSource);
  await task(page, "scan-trend", { force: false });
  assert.equal((await state(page)).state.trendFailed, false);
  await application.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] });
  }, other);
  await task(page, "choose-local-home");
  await page.getByText("14 天 · 2K tokens", { exact: true }).waitFor();
  await task(page, "list-models");
  const commands = (await readFile(trace, "utf8"))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  assert.equal(
    commands.filter((item) => item.method === "account/rateLimits/read").at(-1).home,
    other,
  );
  assert.equal(commands.findLast((item) => item.method === "model/list").home, other);
  await page.evaluate(() =>
    window.codexCoco.enableModule({ moduleId: "desktop-tools", enabled: true }),
  );
  for (const [iconId, template] of [
    ["builtin:zhiyin_basketball", true],
    ["builtin:zhiyin", true],
    ["builtin:pink_cat", false],
  ]) {
    await configure(page, "desktop-tools", { iconId, animate: false, followsCpu: false });
    await task(page, "apply-menu-bar", {}, "desktop-tools");
    for (const theme of ["light", "dark"]) {
      await application.evaluate(({ nativeTheme }, theme) => {
        nativeTheme.themeSource = theme;
      }, theme);
      const image = await application.evaluate(() => globalThis.parityImages.at(-1));
      assert.equal(image.template, template);
      assert.deepEqual(image.size, { width: 18, height: 18 });
    }
  }
  const output = join(root, packaged ? "work/usage-parity-packaged" : "work/usage-parity");
  await mkdir(output, { recursive: true });
  await page.screenshot({ path: join(output, "usage.png"), scale: "css", animations: "disabled" });
  const disabled = await page.evaluate(() =>
    window.codexCoco.enableModule({ moduleId: "usage", enabled: false }),
  );
  assert.equal(disabled.ok, true);
  assert.equal(await application.evaluate(() => globalThis.parityTitles.at(-1)), "");
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify(
      {
        ok: true,
        packaged,
        statisticsAndRanges: true,
        accountAndPlan: true,
        stateSurvivesAuxiliaryAndCancel: true,
        newWindow: true,
        glance: true,
        selectedHome: true,
        nativeTemplateAndColor: true,
        compactNativeTitle: true,
        productionIgnoresDevUrl: true,
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
