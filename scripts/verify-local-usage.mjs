import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { createDesktopSession } from "./verify-desktop.mjs";
const root = fileURLToPath(new URL("../", import.meta.url));
const directory = await mkdtemp(join(tmpdir(), "codex-coco-local-desktop-"));
const packaged = process.argv.includes("--packaged");
const home = join(directory, "codex");
const bin = join(directory, "bin");
await mkdir(join(home, "sessions"), { recursive: true });
await mkdir(bin);
await writeFile(
  join(bin, "codex"),
  `#!${process.execPath}\n${await readFile(join(root, "tests/fixtures/usage-server.mjs"), "utf8")}`,
  { mode: 0o700 },
);
const now = Date.now();
const event = {
  type: "event_msg",
  timestamp: new Date(now - 60_000).toISOString(),
  payload: {
    type: "token_count",
    info: { total_token_usage: { total_tokens: 1234 }, last_token_usage: { total_tokens: 1234 } },
    rate_limits: {
      primary: { used_percent: 25, window_minutes: 300, resets_at: Math.floor(now / 1000) + 3600 },
    },
    privatePrompt: "PRIVATE_DIALOGUE",
  },
};
await writeFile(
  join(home, "sessions/record.jsonl"),
  JSON.stringify({
    type: "session_meta",
    payload: { id: "private-session-id", cwd: "PRIVATE_DIRECTORY" },
  }) +
    "\n" +
    JSON.stringify(event) +
    "\n",
);
let session;
async function task(page, name, input = {}) {
  const response = await page.evaluate(
    ({ name, input }) =>
      window.codexCoco.runModuleOperation({ moduleId: "usage", operation: name, input }),
    { name, input },
  );
  assert.equal(response.ok, true);
  const deadline = Date.now() + 15_000;
  let operation;
  do {
    operation = await page.evaluate(
      async () => (await window.codexCoco.modules()).value.find((m) => m.id === "usage").operation,
    );
    if (operation?.id === response.value.operation.id && operation.phase === "succeeded")
      return operation.result;
    if (operation?.phase === "failed") assert.fail("Local worker failed");
    await delay(50);
  } while (Date.now() < deadline);
  assert.fail("Local operation timed out");
}
try {
  session = await createDesktopSession(
    join(directory, "data"),
    {
      ...process.env,
      CODEX_COCO_FIXTURES: "0",
      CODEX_HOME: home,
      PATH: `${bin}:${process.env.PATH ?? ""}`,
      FAKE_USAGE_MODE: "error",
    },
    packaged
      ? join(root, "apps/desktop/release/mac-arm64/Codex Coco.app/Contents/MacOS/Codex Coco")
      : undefined,
  );
  const { application, page, errors } = session;
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
  const result = await task(page, "scan-trend", { force: false });
  assert.equal(result.status, "error");
  assert.equal(result.reason, "READ_FAILED");
  assert.equal(
    result.trend.points.reduce((sum, point) => sum + point.tokens, 0),
    1234,
  );
  assert.equal(result.trend.source, "session-events");
  assert(!JSON.stringify(result).match(/PRIVATE|private-session|\.jsonl|email/));
  await page.getByText("30 天 · 1.2K tokens", { exact: true }).waitFor();
  assert(
    (await page.locator(".h-32").boundingBox()).height >= 120,
    "The local activity plot must have a real rendered height",
  );
  const output = join(
    root,
    packaged ? "work/local-usage-verification-packaged" : "work/local-usage-verification",
  );
  await mkdir(output, { recursive: true });
  await page.screenshot({ path: join(output, "trend.png"), scale: "css", animations: "disabled" });
  const config = await page.evaluate(async () => {
    const s = (await window.codexCoco.modules()).value.find((m) => m.id === "usage");
    return window.codexCoco.saveModuleConfig({
      moduleId: "usage",
      expectedRevision: s.config.revision,
      value: { ...s.config.value, localFallbackEnabled: true },
    });
  });
  assert.equal(config.ok, true);
  const fallback = await task(page, "refresh");
  assert.equal(fallback.status, "local");
  assert.equal(fallback.reason, "READ_FAILED");
  assert.equal(fallback.data.source, "local-session");
  assert.equal(await page.locator(".usage-previous").getAttribute("open"), null);
  assert.equal(await page.getByText("剩余 75%", { exact: true }).isVisible(), false);
  const popupEvent = application.waitForEvent("window");
  await application.evaluate(({ Menu }) =>
    Menu.getApplicationMenu()
      .items.flatMap((item) => item.submenu?.items ?? [])
      .find((item) => item.label === "显示或收起速览")
      .click(),
  );
  const popup = await popupEvent;
  await popup.getByText("服务额度读取失败，主窗口可查看本机历史记录。", { exact: true }).waitFor();
  const summary = await popup.evaluate(() => window.codexCoco.glance());
  const usage = summary.value.items.find((item) => item.id === "usage");
  assert.equal(usage.metrics, undefined);
  assert.equal(usage.phase, "error");
  const disabled = await page.evaluate(() =>
    window.codexCoco.enableModule({ moduleId: "usage", enabled: false }),
  );
  assert.equal(disabled.ok, true);
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify(
      {
        ok: true,
        packaged,
        actualWorker: true,
        localTrend: true,
        explicitFallback: true,
        noPrivateMetadata: true,
        historicalQuotaHidden: true,
        glanceFailureFirst: true,
      },
      null,
      2,
    ),
  );
} finally {
  await session?.application.close();
  await rm(directory, { recursive: true, force: true });
}
