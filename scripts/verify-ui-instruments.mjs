import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { createDesktopSession } from "./verify-desktop.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const directory = await mkdtemp(join(tmpdir(), "codex-coco-ui-"));
const home = join(directory, "codex");
const bin = join(directory, "bin");
const mode = join(directory, "mode");
const trace = join(directory, "trace");
const packaged = process.argv.includes("--packaged");
const output = join(root, packaged ? "work/ui-instruments-packaged" : "work/ui-instruments");
await mkdir(output, { recursive: true });
await mkdir(bin);
await mkdir(join(home, "sessions"), { recursive: true });
await writeFile(mode, "ready");
await writeFile(
  join(bin, "codex"),
  `#!${process.execPath}\n${await readFile(join(root, "tests/fixtures/usage-server.mjs"), "utf8")}`,
  { mode: 0o700 },
);
for (let index = 0; index < 30; index++) {
  const time = new Date();
  time.setDate(time.getDate() - index);
  const count = index === 29 ? 0 : 24000 + ((index * 7919) % 26000);
  await writeFile(
    join(home, "sessions", `${index}.jsonl`),
    [
      { type: "session_meta", payload: { id: `synthetic-${index}` } },
      {
        type: "event_msg",
        timestamp: time.toISOString(),
        payload: {
          type: "token_count",
          info: {
            total_token_usage: { total_tokens: count },
            last_token_usage: { total_tokens: count },
          },
        },
      },
    ]
      .map((value) => JSON.stringify(value))
      .join("\n") + "\n",
  );
}
let session;
async function snapshot() {
  return session.page.evaluate(async () =>
    (await window.codexCoco.modules()).value.find((module) => module.id === "usage"),
  );
}
async function settle(id) {
  const until = Date.now() + 15_000;
  while (Date.now() < until) {
    const state = await snapshot();
    if (state.operation?.phase === "succeeded" && (!id || state.operation.id === id)) return state;
    await delay(30);
  }
  assert.fail("UI task did not settle");
}
async function toggle() {
  await session.application.evaluate(({ Menu }) =>
    Menu.getApplicationMenu()
      .items.flatMap((item) => item.submenu?.items ?? [])
      .find((item) => item.label === "显示或收起速览")
      .click(),
  );
}
async function capture(page, name) {
  await page.screenshot({
    path: join(output, `${name}.png`),
    scale: "css",
    animations: "disabled",
  });
}
async function assertFits(page) {
  const fits = await page.evaluate(() =>
    [
      document.documentElement,
      ...document.querySelectorAll(".desktop-content, .glance-content"),
    ].every((element) => element.scrollWidth <= element.clientWidth),
  );
  assert.equal(fits, true, "Content must not overflow horizontally");
}
async function refresh() {
  const response = await session.page.evaluate(() =>
    window.codexCoco.runModuleOperation({ moduleId: "usage", operation: "refresh", input: {} }),
  );
  assert.equal(response.ok, true);
  return settle(response.value.operation.id);
}
try {
  session = await createDesktopSession(
    join(directory, "data"),
    {
      ...process.env,
      CODEX_COCO_FIXTURES: "0",
      CODEX_HOME: home,
      PATH: `${bin}:${process.env.PATH ?? ""}`,
      FAKE_USAGE_MODE_FILE: mode,
      FAKE_USAGE_TRACE: trace,
    },
    packaged
      ? join(root, "apps/desktop/release/mac-arm64/Codex Coco.app/Contents/MacOS/Codex Coco")
      : undefined,
  );
  const { page, application, errors } = session;
  const nav = page.getByRole("navigation", { name: "应用导航" });
  await nav.getByRole("button", { name: "用量", exact: true }).click();
  assert.equal(await page.getByRole("meter").count(), 0, "Disabled is not an empty quota");
  await page.getByRole("button", { name: "启用并读取用量", exact: true }).click();
  await settle();
  await page.getByRole("button", { name: "14 天", exact: true }).click();
  const meters = page.getByRole("meter");
  assert.equal(await meters.count(), 2);
  assert.equal(await meters.first().getAttribute("value"), "75");
  assert.equal(await meters.first().getAttribute("aria-valuetext"), "剩余 75%");
  const ring = await page.locator(".coco-progress-ring").first().boundingBox();
  assert(ring.width >= 96 && ring.width <= 112);
  const corners = await page
    .locator(".usage-quota-card")
    .first()
    .evaluate((node) => getComputedStyle(node).borderRadius);
  assert.equal(corners, "18px");
  for (const days of [7, 14, 30]) {
    await page.getByRole("button", { name: `${days} 天`, exact: true }).click();
    await page.waitForFunction(
      (count) => document.querySelectorAll(".usage-chart-dates > span").length === count,
      days,
    );
    const aligned = await page.evaluate(() => {
      const bars = [...document.querySelectorAll(".usage-chart-bar")];
      return [...document.querySelectorAll(".usage-chart-dates > span")].every((label, index) => {
        const a = label.getBoundingClientRect();
        const b = bars[index].getBoundingClientRect();
        return Math.abs(a.x + a.width / 2 - b.x - b.width / 2) < 1;
      });
    });
    assert.equal(aligned, true, "Date labels must match their actual bar columns");
  }
  await page.locator(".usage-chart-point").first().hover();
  await page
    .getByRole("tooltip")
    .locator(".usage-chart-tooltip-value strong")
    .getByText("0", { exact: true })
    .waitFor();
  await page.waitForFunction(() => {
    const node = document.querySelector(".usage-chart-tooltip")?.closest('[role="tooltip"]');
    return node && getComputedStyle(node).opacity === "1";
  });
  await page.waitForTimeout(200);
  await page.screenshot({ path: join(output, "chart-zero-tooltip.png"), scale: "css" });
  await page.mouse.move(0, 0);
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "14 天", exact: true }).click();
  await assertFits(page);
  await capture(page, "main-light");

  const lastPoint = page.locator(".usage-chart-point").last();
  await lastPoint.hover();
  await page.getByRole("tooltip").getByText("24K", { exact: true }).waitFor();
  assert.equal(await page.getByRole("tooltip").locator("dd").first().textContent(), "24,000");
  await page.waitForFunction(() => {
    const node = document.querySelector(".usage-chart-tooltip")?.closest('[role="tooltip"]');
    if (!node) return false;
    const rect = node.getBoundingClientRect();
    return (
      getComputedStyle(node).opacity === "1" &&
      rect.top >= 0 &&
      rect.right <= innerWidth &&
      rect.bottom <= innerHeight
    );
  });
  await page.waitForTimeout(200);
  await page.screenshot({ path: join(output, "chart-hover-tooltip.png"), scale: "css" });
  await page.mouse.move(0, 0);
  const firstPoint = page.locator(".usage-chart-point").first();
  const firstDate = (
    await page.locator(".usage-chart-point").nth(1).getAttribute("aria-label")
  ).split(" · ")[0];
  await firstPoint.focus();
  await page.keyboard.press("Tab");
  await page
    .getByRole("tooltip")
    .getByText(firstDate.replaceAll("-", "/"), { exact: true })
    .waitFor();
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => document.querySelectorAll('[role="tooltip"]').length === 0);
  await page.getByRole("button", { name: "添加到速览：每日用量趋势", exact: true }).click();
  await page.getByRole("button", { name: "从速览移除每日用量趋势", exact: true }).waitFor();
  assert(
    (await page.evaluate(() => window.codexCoco.glanceLayout())).value.value.blocks.includes(
      "usage.trend",
    ),
  );
  await page.getByRole("button", { name: "从速览移除每日用量趋势", exact: true }).click();
  await page.getByRole("button", { name: "添加到速览：每日用量趋势", exact: true }).waitFor();
  for (const label of ["今日消耗", "近 7 天消耗", "近 30 天消耗"]) {
    assert.equal(
      await page.getByRole("button", { name: `从速览移除${label}`, exact: true }).count(),
      1,
    );
  }
  const beforeTokenPin = (await page.evaluate(() => window.codexCoco.glanceLayout())).value;
  await page.getByRole("button", { name: "从速览移除近 7 天消耗", exact: true }).click();
  await page.getByRole("button", { name: "添加到速览：近 7 天消耗", exact: true }).waitFor();
  assert(
    !(await page.evaluate(() => window.codexCoco.glanceLayout())).value.value.blocks.includes(
      "usage.week",
    ),
  );
  const restoredPin = await page.evaluate(async (value) => {
    const current = (await window.codexCoco.glanceLayout()).value;
    return window.codexCoco.saveGlanceLayout({ expectedRevision: current.revision, value });
  }, beforeTokenPin.value);
  assert.equal(restoredPin.ok, true);
  await page.getByRole("button", { name: "从速览移除近 7 天消耗", exact: true }).waitFor();
  const beforeTabs = (await readFile(trace, "utf8")).split('"method":"spawn"').length;
  await page.getByRole("tab", { name: "辅助工具", exact: true }).click();
  await page.getByRole("button", { name: "开始样本检测", exact: true }).waitFor();
  assert.equal(
    await page.getByRole("meter").count(),
    0,
    "Core overview is not duplicated in tools",
  );
  await page.getByRole("tab", { name: "用量设置", exact: true }).click();
  const interval = page.getByLabel("自动刷新间隔（秒）", { exact: true });
  await interval.fill("60");
  const notifications = page.getByRole("switch", { name: "用量通知", exact: true });
  await notifications.focus();
  await page.keyboard.press("Space");
  assert.equal(await notifications.isChecked(), true);
  assert.equal(
    (await snapshot()).config.value.notificationsEnabled,
    false,
    "Switch previews do not persist before save",
  );
  await capture(page, "preferences-light");
  await page.getByRole("tab", { name: "总览", exact: true }).click();
  await page.getByRole("tab", { name: "用量设置", exact: true }).click();
  assert.equal(await interval.inputValue(), "60", "Changing tabs preserves an unsaved draft");
  assert.equal((await snapshot()).config.value.refreshIntervalSeconds, 0);
  await page.getByRole("button", { name: "取消修改", exact: true }).click();
  assert.equal(await notifications.isChecked(), false);
  await page.getByRole("tab", { name: "总览", exact: true }).focus();
  await page.keyboard.press("ArrowRight");
  assert.equal(
    await page
      .getByRole("tab", { name: "辅助工具", exact: true })
      .evaluate((node) => node === document.activeElement),
    true,
  );
  await page.keyboard.press("Enter");
  await page.getByRole("tab", { name: "辅助工具", exact: true }).waitFor({ state: "visible" });
  assert.equal(
    await page.getByRole("tab", { name: "辅助工具", exact: true }).getAttribute("aria-selected"),
    "true",
  );
  await page.getByRole("tab", { name: "总览", exact: true }).click();
  assert.equal(
    (await readFile(trace, "utf8")).split('"method":"spawn"').length,
    beforeTabs,
    "Tabs do not start extra reads or paid tools",
  );

  const popupEvent = application.waitForEvent("window");
  await toggle();
  const popup = await popupEvent;
  await popup.waitForFunction(() => {
    const shell = document.querySelector(".glance-shell");
    return shell && getComputedStyle(shell).opacity === "1";
  });
  assert.equal(await popup.getByRole("meter").count(), 2);
  assert.equal(await popup.getByRole("meter").first().getAttribute("value"), "75");
  const summariesVisible = await popup.evaluate(() => {
    const viewport = document.querySelector(".glance-content").getBoundingClientRect();
    return {
      bottom: viewport.bottom,
      items: [...document.querySelectorAll(".glance-item")].map((node) => ({
        title: node.getAttribute("aria-label"),
        bottom: node.getBoundingClientRect().bottom,
      })),
    };
  });
  assert.equal(await popup.locator("[data-sort-handle]").count(), 7);
  assert.equal(await popup.getByRole("button", { name: "调整速览顺序", exact: true }).count(), 0);
  await capture(popup, "glance-light");
  assert(
    summariesVisible.items.every((item) => item.bottom <= summariesVisible.bottom),
    `Ordinary summaries fit below the core quota overview: ${JSON.stringify(summariesVisible)}`,
  );
  await assertFits(popup);
  // The real data cells are drag targets; no editor or manual completion is involved.
  const originalOrder = (await page.evaluate(() => window.codexCoco.glanceLayout())).value.value
    .blocks;
  const today = popup.locator('[data-sort-handle="usage.today"]');
  const week = popup.locator('[data-sort-id="usage.week"]');
  const weekBox = await week.boundingBox();
  await today.dragTo(week, { targetPosition: { x: weekBox.width - 3, y: weekBox.height / 2 } });
  await popup.waitForFunction(
    () =>
      document.querySelector(".glance-reorder")?.getAttribute("aria-busy") === "false" &&
      document
        .querySelector(".glance-token-grid > div:first-child")
        ?.getAttribute("data-sort-id") === "usage.week",
  );
  const directOrder = (await page.evaluate(() => window.codexCoco.glanceLayout())).value.value
    .blocks;
  assert.deepEqual(directOrder.slice(2, 5), ["usage.week", "usage.today", "usage.month"]);
  assert.equal(await popup.getByRole("meter").count(), 2);
  await capture(popup, "glance-inline-drag");
  await today.press("ArrowUp");
  await popup.waitForFunction(
    () =>
      document.querySelector(".glance-reorder")?.getAttribute("aria-busy") === "false" &&
      document
        .querySelector(".glance-token-grid > div:first-child")
        ?.getAttribute("data-sort-id") === "usage.today",
  );
  assert.deepEqual(
    (await page.evaluate(() => window.codexCoco.glanceLayout())).value.value.blocks,
    originalOrder,
  );
  await popup.getByRole("button", { name: "刷新速览", exact: true }).click();
  assert.equal((await readFile(trace, "utf8")).split('"method":"spawn"').length, beforeTabs);
  const denied = await popup.evaluate(() =>
    window.codexCoco.runModuleOperation({ moduleId: "usage", operation: "refresh", input: {} }),
  );
  assert.equal(denied.error.code, "FORBIDDEN");
  await popup.keyboard.press("Escape");
  await page.bringToFront();
  await page.getByRole("button", { name: "添加到速览：每日用量趋势", exact: true }).click();
  await toggle();
  await popup.locator(".glance-trend-block").waitFor();
  await popup.locator(".glance-trend-block").scrollIntoViewIfNeeded();
  await capture(popup, "glance-custom-trend");
  await popup.keyboard.press("Escape");
  await page.bringToFront();
  await page.getByRole("button", { name: "从速览移除每日用量趋势", exact: true }).click();
  await toggle();
  await popup.emulateMedia({ reducedMotion: "reduce" });
  assert.equal(
    await popup
      .locator(".coco-ring-value")
      .first()
      .evaluate((node) => getComputedStyle(node).transitionDuration.split(",")[0].trim()),
    "1e-05s",
  );
  await popup.keyboard.press("Escape");
  await page.bringToFront();

  const window = await application.browserWindow(page);
  await window.evaluate((window) => window.setSize(720, 640));
  await page.waitForFunction(() => innerWidth === 720);
  await assertFits(page);
  await capture(page, "main-compact");
  await page.getByRole("tab", { name: "用量设置", exact: true }).click();
  await assertFits(page);
  await capture(page, "preferences-compact");
  await page.getByRole("tab", { name: "总览", exact: true }).click();
  await window.evaluate((window) => window.setSize(980, 800));
  await nav.getByRole("button", { name: "模块管理", exact: true }).click();
  await assertFits(page);
  await capture(page, "modules-light");
  await window.evaluate((window) => window.setSize(720, 640));
  await assertFits(page);
  await capture(page, "modules-compact");
  await window.evaluate((window) => window.setSize(980, 800));
  await nav.getByRole("button", { name: "设置", exact: true }).click();
  await assertFits(page);
  await capture(page, "settings-light");
  await page
    .getByRole("region", { name: "速览面板设置", exact: true })
    .locator(".glance-editor")
    .evaluate((node) => node.scrollIntoView({ block: "start" }));
  await capture(page, "glance-editor-data-light");
  await page.getByRole("button", { name: "深色", exact: true }).click();
  await page.getByRole("button", { name: "保存主题", exact: true }).click();
  await nav.getByRole("button", { name: "用量", exact: true }).click();
  await page.waitForFunction(() => document.documentElement.dataset.theme === "dark");
  await capture(page, "main-dark");
  await nav.getByRole("button", { name: "设置", exact: true }).click();
  await capture(page, "settings-dark");
  await nav.getByRole("button", { name: "用量", exact: true }).click();
  await page.getByRole("tab", { name: "用量设置", exact: true }).click();
  await capture(page, "preferences-dark");
  await page.getByRole("tab", { name: "总览", exact: true }).click();
  await toggle();
  await popup.waitForFunction(
    () =>
      document.documentElement.dataset.theme === "dark" &&
      getComputedStyle(document.querySelector(".glance-shell")).opacity === "1",
  );
  await capture(popup, "glance-dark");
  await popup.keyboard.press("Escape");
  await page.bringToFront();
  await nav.getByRole("button", { name: "设置", exact: true }).click();
  await page.getByLabel("自定义主色", { exact: true }).fill("#ffff00");
  await page.getByRole("button", { name: "保存主题", exact: true }).click();
  await nav.getByRole("button", { name: "用量", exact: true }).click();
  await assertFits(page);
  await capture(page, "main-custom-color");
  await writeFile(mode, "multi-quota");
  await refresh();
  assert.equal(await page.getByRole("meter").count(), 4);
  await toggle();
  await popup.getByRole("meter").nth(3).waitFor({ state: "attached" });
  assert.equal(await popup.locator(".glance-capacity-groups > section").count(), 2);
  assert.equal(await popup.locator('[data-sort-handle="usage.primary"]').count(), 1);
  assert.equal(await popup.locator('[data-sort-handle="usage.secondary"]').count(), 1);
  await popup.getByText("恢复时间未知", { exact: true }).waitFor();
  await popup.getByText("等待刷新确认", { exact: true }).waitFor();
  await assertFits(popup);
  await capture(popup, "glance-multiple");
  await popup.keyboard.press("Escape");
  await page.bringToFront();
  await writeFile(mode, "primary-only");
  await refresh();
  await toggle();
  await popup.getByText("其他额度窗口 · 暂无数据", { exact: true }).waitFor();
  assert.equal(await popup.locator('[data-sort-handle="usage.primary"]').count(), 1);
  assert.equal(await popup.locator('[data-sort-handle="usage.secondary"]').count(), 1);
  assert.equal(await popup.getByRole("meter").count(), 1);
  await popup.keyboard.press("Escape");
  await page.bringToFront();
  await writeFile(mode, "exhausted");
  await refresh();
  assert.equal(await page.getByRole("meter").first().getAttribute("value"), "0");
  await writeFile(mode, "error");
  await refresh();
  await page.getByText("暂时无法更新用量", { exact: true }).waitFor();
  assert.equal(await page.getByRole("meter").count(), 0);
  assert.equal(await page.locator(".usage-previous").getAttribute("open"), null);
  await capture(page, "main-error");
  await toggle();
  await popup.getByText("暂时无法更新用量", { exact: true }).waitFor();
  assert.equal(await popup.getByRole("meter").count(), 0);
  await capture(popup, "glance-error");
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify(
      {
        ok: true,
        packaged,
        capacitySemantics: true,
        compactSurfaces: true,
        tabsAndDraftRetention: true,
        readOnlyGlance: true,
        lightDarkAndCustomColor: true,
        reducedMotion: true,
        failureFirst: true,
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
