import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { createDesktopSession } from "./verify-desktop.mjs";
const root = fileURLToPath(new URL("../", import.meta.url));
const directory = await mkdtemp(join(tmpdir(), "codex-coco-tools-desktop-"));
const packaged = process.argv.includes("--packaged");
const bin = join(directory, "bin");
await mkdir(bin);
const mode = join(directory, "mode");
const trace = join(directory, "trace");
const version = join(directory, "version");
await writeFile(mode, "ready");
await writeFile(
  join(bin, "codex"),
  `#!${process.execPath}\n${await readFile(join(root, "tests/fixtures/usage-tools.mjs"), "utf8")}`,
  { mode: 0o700 },
);
let session;
try {
  session = await createDesktopSession(
    join(directory, "data"),
    {
      ...process.env,
      CODEX_COCO_FIXTURES: "0",
      CODEX_HOME: join(directory, "codex"),
      PATH: `${bin}:${process.env.PATH ?? ""}`,
      FAKE_TOOL_MODE_FILE: mode,
      FAKE_TOOL_TRACE: trace,
      FAKE_TOOL_VERSION_FILE: version,
    },
    packaged
      ? join(root, "apps/desktop/release/mac-arm64/Codex Coco.app/Contents/MacOS/Codex Coco")
      : undefined,
  );
  const { page, application, errors } = session;
  await application.evaluate(() => {
    globalThis.fetch = async () =>
      new Response(JSON.stringify({ tag_name: "rust-v1.2.4", draft: false, prerelease: false }));
  });
  await page.getByRole("navigation").getByRole("button", { name: "用量", exact: true }).click();
  await page.evaluate(() => window.codexCoco.enableModule({ moduleId: "usage", enabled: true }));
  const startupDeadline = Date.now() + 15_000;
  let startup;
  do {
    startup = await page.evaluate(
      async () =>
        (await window.codexCoco.modules()).value.find((module) => module.id === "usage").operation,
    );
    if (startup?.phase === "succeeded") break;
    await delay(50);
  } while (Date.now() < startupDeadline);
  assert.equal(startup?.name, "refresh");
  assert.equal(startup?.phase, "succeeded");
  await page.getByRole("tab", { name: "辅助工具", exact: true }).click();
  await page.getByRole("button", { name: "读取可用模型", exact: true }).click();
  await page.getByRole("button", { name: "受控模型", exact: true }).waitFor();
  await page.getByText(/已读取 Codex 默认设置：controlled-model · high/).waitFor();
  await page.getByRole("button", { name: "受控模型", exact: true }).click();
  await page.getByRole("button", { name: "high", exact: true }).click();
  await page.getByRole("button", { name: "开始样本检测", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "取消", exact: true }).click();
  let commands = (await readFile(trace, "utf8"))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  assert.equal(commands.filter((command) => command.args.includes("exec")).length, 0);
  await page.getByRole("button", { name: "开始样本检测", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "确认执行", exact: true }).click();
  await page.getByText("已完成 3/3 个样本，正确 3 个，正确率 100%。", { exact: true }).waitFor();
  await page.getByRole("definition").filter({ hasText: "16 tokens" }).waitFor();
  await page.getByLabel("样本次数（1–5）", { exact: true }).fill("1");
  await page.getByRole("button", { name: "开始样本检测", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "确认执行", exact: true }).click();
  await page.getByText("已完成 1/1 个样本，正确 1 个，正确率 100%。", { exact: true }).waitFor();
  await page.getByLabel("历史检测基线", { exact: true }).waitFor();
  const output = join(
    root,
    packaged ? "work/usage-tools-verification-packaged" : "work/usage-tools-verification",
  );
  await mkdir(output, { recursive: true });
  await page.screenshot({
    path: join(output, "samples.png"),
    scale: "css",
    animations: "disabled",
  });
  await page
    .getByRole("group", { name: "样本检测", exact: true })
    .evaluate((node) => node.scrollIntoView({ block: "start" }));
  await page.screenshot({
    path: join(output, "sample-settings.png"),
    scale: "css",
    animations: "disabled",
  });
  const mainWindow = await application.browserWindow(page);
  await mainWindow.evaluate((window) => window.setSize(720, 640));
  assert(
    await page.locator(".desktop-content").evaluate((node) => node.scrollWidth <= node.clientWidth),
  );
  await page.screenshot({
    path: join(output, "sample-settings-compact.png"),
    scale: "css",
    animations: "disabled",
  });
  await mainWindow.evaluate((window) => window.setSize(980, 800));
  await page.getByRole("button", { name: "检查 CLI 版本", exact: true }).click();
  await page.getByText("Codex CLI：1.2.3 · 最新稳定版：1.2.4", { exact: true }).waitFor();
  await page.getByRole("button", { name: "更新 Codex CLI", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "确认执行", exact: true }).click();
  await page.getByText("Codex CLI：1.2.4 · 最新稳定版：1.2.4", { exact: true }).waitFor();
  const history = JSON.parse(
    await readFile(join(directory, "data/usage-tools/intelligence-history.json"), "utf8"),
  );
  assert.equal(history.length, 2);
  assert.equal(history[0].correct, 1);
  assert.equal(history[0].averageReasoningTokens, 16);
  assert(!JSON.stringify(history).match(/private|explanation/));
  await writeFile(mode, "hang");
  await page.getByRole("button", { name: "开始样本检测", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "确认执行", exact: true }).click();
  const until = Date.now() + 5000;
  do {
    commands = (await readFile(trace, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    if (commands.filter((command) => command.args.includes("exec")).length === 5) break;
    await delay(25);
  } while (Date.now() < until);
  await page.getByRole("button", { name: "取消任务", exact: true }).click();
  await page.getByText("任务已取消，已读取的数据已保留。", { exact: true }).waitFor();
  await page.getByText("Codex CLI：1.2.4 · 最新稳定版：1.2.4", { exact: true }).waitFor();
  for (const command of commands.filter((command) => command.args.includes("exec")))
    assert.throws(() => process.kill(command.pid, 0));
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify(
      {
        ok: true,
        packaged,
        modelsAndEfforts: true,
        confirmationWithoutPaidCall: true,
        structuredSamples: true,
        summaryHistory: true,
        controlledCliUpdate: true,
        cancellationAndExit: true,
        noRealInference: true,
      },
      null,
      2,
    ),
  );
} finally {
  await session?.application.close();
  await rm(directory, { recursive: true, force: true });
}
