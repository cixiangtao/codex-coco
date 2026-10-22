import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { createDesktopSession } from "./verify-desktop.mjs";
const root = fileURLToPath(new URL("../", import.meta.url));
const directory = await mkdtemp(join(tmpdir(), "codex-coco-usage-policy-"));
const packaged = process.argv.includes("--packaged");
const bin = join(directory, "bin");
await mkdir(bin);
const mode = join(directory, "mode");
const trace = join(directory, "trace");
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
  CODEX_HOME: join(directory, "codex"),
  FAKE_USAGE_MODE_FILE: mode,
  FAKE_USAGE_TRACE: trace,
};
let session;
async function poll(read, accept, timeout = 10_000) {
  const until = Date.now() + timeout;
  let value;
  do {
    value = await read();
    if (accept(value)) return value;
    await delay(50);
  } while (Date.now() < until);
  assert.fail("Timed out waiting for expected state");
}
async function spawns() {
  try {
    return (await readFile(trace, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line))
      .filter((event) => event.method === "spawn").length;
  } catch {
    return 0;
  }
}
async function configure(page, patch) {
  const result = await page.evaluate(async (patch) => {
    const snapshot = (await window.codexCoco.modules()).value.find((m) => m.id === "usage");
    return window.codexCoco.saveModuleConfig({
      moduleId: "usage",
      expectedRevision: snapshot.config.revision,
      value: { ...snapshot.config.value, ...patch },
    });
  }, patch);
  assert.equal(result.ok, true);
}
async function refresh(page) {
  const response = await page.evaluate(() =>
    window.codexCoco.runModuleOperation({ moduleId: "usage", operation: "refresh", input: {} }),
  );
  assert.equal(response.ok, true);
  return poll(
    () =>
      page.evaluate(
        async () =>
          (await window.codexCoco.modules()).value.find((m) => m.id === "usage").operation,
      ),
    (task) => task?.id === response.value.operation.id && task.phase === "succeeded",
  );
}
try {
  session = await createDesktopSession(
    join(directory, "data"),
    environment,
    packaged
      ? join(root, "apps/desktop/release/mac-arm64/Codex Coco.app/Contents/MacOS/Codex Coco")
      : undefined,
  );
  const { application, page, errors } = session;
  await application.evaluate(({ Notification }) => {
    globalThis.usageNotifications = [];
    Notification.prototype.show = function () {
      globalThis.usageNotifications.push({ title: this.title, body: this.body });
    };
  });
  await page.evaluate(() => window.codexCoco.enableModule({ moduleId: "usage", enabled: true }));
  await poll(
    () =>
      page.evaluate(
        async () =>
          (await window.codexCoco.modules()).value.find((m) => m.id === "usage").operation?.phase,
      ),
    (phase) => phase === "succeeded",
  );
  assert.equal(await spawns(), 1);
  await configure(page, {
    notificationsEnabled: true,
    warningThreshold: 80,
    criticalThreshold: 5,
  });
  await refresh(page);
  await refresh(page);
  let notifications = await application.evaluate(() => globalThis.usageNotifications);
  assert.equal(notifications.length, 1);
  assert.equal(notifications[0].title, "Codex 剩余额度偏低");
  await writeFile(mode, "error");
  await refresh(page);
  await refresh(page);
  notifications = await application.evaluate(() => globalThis.usageNotifications);
  assert.equal(notifications.length, 2);
  assert.equal(notifications[1].title, "Codex 用量刷新失败");
  await configure(page, { warningThreshold: 20, criticalThreshold: 5 });
  await writeFile(mode, "ready");
  await refresh(page);
  notifications = await application.evaluate(() => globalThis.usageNotifications);
  assert.equal(notifications.length, 3);
  assert.equal(notifications[2].title, "Codex 额度已恢复");
  assert(!JSON.stringify(notifications).match(/private|token|email/));
  await configure(page, { refreshIntervalSeconds: 30, notificationsEnabled: false });
  const before = await spawns();
  await application.evaluate(({ BrowserWindow }) => {
    for (const window of BrowserWindow.getAllWindows()) window.close();
  });
  await poll(
    () => application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length),
    (count) => count === 0,
  );
  await poll(spawns, (count) => count > before, 38_000);
  const nextWindow = application.waitForEvent("window");
  await application.evaluate(({ app }) => app.emit("activate"));
  const reopened = await nextWindow;
  await reopened.getByRole("navigation").getByRole("button", { name: "用量", exact: true }).click();
  await reopened.getByText("剩余 75%", { exact: true }).waitFor();
  await configure(reopened, { refreshIntervalSeconds: 0 });
  const state = await reopened.evaluate(async () =>
    (await window.codexCoco.modules()).value.find((m) => m.id === "usage"),
  );
  assert.equal(state.config.value.refreshIntervalSeconds, 0);
  const disabled = await reopened.evaluate(() =>
    window.codexCoco.enableModule({ moduleId: "usage", enabled: false }),
  );
  assert.equal(disabled.ok, true);
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify(
      {
        ok: true,
        packaged,
        singleStartupRead: true,
        notificationTransitions: true,
        notificationDeduplication: true,
        backgroundWithoutWindow: true,
        disableAndOptOut: true,
      },
      null,
      2,
    ),
  );
} finally {
  await session?.application.close();
  await rm(directory, { recursive: true, force: true });
}
