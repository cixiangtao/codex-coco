import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createDesktopSession } from "./verify-desktop.mjs";
const root = fileURLToPath(new URL("../", import.meta.url));
const directory = await mkdtemp(join(tmpdir(), "codex-coco-update-ui-"));
const packaged = process.argv.includes("--packaged");
const output = join(
  root,
  packaged ? "work/update-verification-packaged" : "work/update-verification",
);
await mkdir(output, { recursive: true });
// Start legacy/manual scenarios with an explicit saved preference; defaults are checked separately.
await writeFile(
  join(directory, "updates.json"),
  JSON.stringify({ version: 2, revision: 0, preferences: { intervalHours: 0 } }),
);
let session;
async function launch() {
  session = await createDesktopSession(
    directory,
    { ...process.env, CODEX_COCO_FIXTURES: "0" },
    packaged
      ? join(
          process.env.CODEX_COCO_VERIFY_BUNDLE ??
            join(root, "apps/desktop/release/mac-arm64/Codex Coco.app"),
          "Contents/MacOS/Codex Coco",
        )
      : undefined,
  );
  await session.page
    .getByRole("navigation")
    .getByRole("button", { name: "设置", exact: true })
    .click();
  // Replace transport, not the host or renderer. No GitHub requests or external browser launches occur.
  await session.application.evaluate(({ net, shell }) => {
    globalThis.updateQaRequests = [];
    globalThis.updateQaOpened = [];
    globalThis.updateQaMode = "none";
    const originalFetch = net.fetch.bind(net);
    net.fetch = async (input, options) => {
      if (String(input).startsWith("file:")) return originalFetch(input, options);
      globalThis.updateQaRequests.push({
        url: String(input),
        headers: options.headers,
        credentials: options.credentials,
      });
      if (globalThis.updateQaMode === "slow")
        return new Promise((_, reject) =>
          options.signal.addEventListener(
            "abort",
            () => reject(new Error("PRIVATE cancellation")),
            { once: true },
          ),
        );
      if (globalThis.updateQaMode === "error")
        return new Response("PRIVATE error", { status: 403 });
      if (globalThis.updateQaMode === "none") return new Response(null, { status: 404 });
      const release = {
        tag_name: "v999.0.0",
        draft: false,
        prerelease: false,
        html_url: "https://evil.invalid/PRIVATE",
        body: "PRIVATE_RELEASE_BODY",
      };
      return new Response(
        JSON.stringify(String(input).includes("?per_page=100") ? [release] : release),
      );
    };
    shell.openExternal = async (url) => {
      globalThis.updateQaOpened.push(url);
    };
  });
  return session;
}
try {
  let { application, page } = await launch();
  const section = page.getByRole("region", { name: "应用更新", exact: true });
  await section.getByText("等待检查", { exact: true }).waitFor();
  assert.equal(await section.getByLabel("发布源目录", { exact: true }).count(), 0);
  assert.equal(await application.evaluate(() => globalThis.updateQaRequests.length), 0);
  await section.getByRole("button", { name: "检查 Codex Coco 更新", exact: true }).click();
  await section.getByText("尚无可用版本", { exact: true }).waitFor();
  await section.getByText("当前更新频道尚无可用版本，请稍后再检查。", { exact: true }).waitFor();
  await application.evaluate(() => {
    globalThis.updateQaMode = "available";
  });
  await section.getByRole("button", { name: "检查 Codex Coco 更新", exact: true }).click();
  await section.getByText("发现可用版本", { exact: true }).waitFor();
  await section.getByText("可用版本 999.0.0", { exact: true }).waitFor();
  const state = (await page.evaluate(() => window.codexCoco.updates())).value;
  assert.equal(state.installSupported, false);
  assert.equal(state.releaseUrl, "https://github.com/cixiangtao/codex-coco/releases/tag/v999.0.0");
  assert(!JSON.stringify(state).includes("PRIVATE"));
  assert(
    await section.getByRole("button", { name: "更新并重启 Codex Coco", exact: true }).isDisabled(),
  );
  await section.getByRole("button", { name: "打开 GitHub 发布页面", exact: true }).click();
  await page.waitForFunction(
    () =>
      ![...document.querySelectorAll("button")].find(
        (button) => button.textContent.trim() === "打开 GitHub 发布页面",
      )?.disabled,
  );
  assert.deepEqual(await application.evaluate(() => globalThis.updateQaOpened), [state.releaseUrl]);
  await page.evaluate(() => window.codexCoco.updateAction({ action: "download", confirmed: true }));
  await section.getByText("需要签名的 macOS 安装版", { exact: true }).first().waitFor();
  assert.equal(await application.evaluate(() => globalThis.updateQaRequests.length), 2);
  await application.evaluate(() => {
    globalThis.updateQaMode = "error";
  });
  await section.getByRole("button", { name: "检查 Codex Coco 更新", exact: true }).click();
  await section.getByText("更新操作未完成", { exact: true }).first().waitFor();
  assert.equal(
    (await page.evaluate(() => window.codexCoco.updates())).value.availableVersion,
    null,
  );
  await application.evaluate(() => {
    globalThis.updateQaMode = "slow";
  });
  await section.getByRole("button", { name: "检查 Codex Coco 更新", exact: true }).click();
  await section.getByRole("button", { name: "取消更新任务", exact: true }).click();
  await section.getByText("等待检查", { exact: true }).waitFor();
  await application.evaluate(() => {
    globalThis.updateQaMode = "available";
  });
  await section.getByRole("button", { name: "检查 Codex Coco 更新", exact: true }).click();
  await section.getByText("发现可用版本", { exact: true }).waitFor();
  const requests = await application.evaluate(() => globalThis.updateQaRequests);
  assert(
    requests.every(
      (request) =>
        [
          "https://api.github.com/repos/cixiangtao/codex-coco/releases/latest",
          "https://api.github.com/repos/cixiangtao/codex-coco/releases?per_page=100",
        ].includes(request.url) &&
        request.credentials === "omit" &&
        !Object.keys(request.headers).some((name) => /authorization/i.test(name)),
    ),
  );
  await section.screenshot({
    path: join(output, "github-update-available.png"),
    scale: "css",
    animations: "disabled",
  });
  await section.getByRole("switch", { name: "自动检查更新", exact: true }).click();
  await section.getByRole("button", { name: "保存更新偏好", exact: true }).click();
  await section.getByText("更新偏好已保存。", { exact: true }).waitFor();
  const stale = await page.evaluate(() =>
    window.codexCoco.saveUpdatePreferences({ expectedRevision: 0, value: { intervalHours: 0 } }),
  );
  assert.equal(stale.error.code, "CONFLICT");
  const windowEvent = application.waitForEvent("window");
  await application.evaluate(({ Menu }) =>
    Menu.getApplicationMenu()
      .items.flatMap((item) => item.submenu?.items ?? [])
      .find((item) => item.label === "新建窗口")
      .click(),
  );
  const second = await windowEvent;
  await second.getByRole("heading", { name: "Codex Coco", exact: true }).waitFor();
  await second.getByRole("navigation").getByRole("button", { name: "设置", exact: true }).click();
  assert.equal(
    await second
      .getByRole("switch", { name: "自动检查更新", exact: true })
      .getAttribute("aria-checked"),
    "true",
  );
  const popupEvent = application.waitForEvent("window");
  await application.evaluate(({ Menu }) =>
    Menu.getApplicationMenu()
      .items.flatMap((item) => item.submenu?.items ?? [])
      .find((item) => item.label === "显示或收起速览")
      .click(),
  );
  const popup = await popupEvent;
  const forbidden = await popup.evaluate(async () =>
    Promise.all([
      window.codexCoco.updates(),
      window.codexCoco.saveUpdatePreferences({ expectedRevision: 1, value: { intervalHours: 0 } }),
      window.codexCoco.updateAction({ action: "install", confirmed: true }),
      window.codexCoco.updateAction({ action: "open-release" }),
    ]),
  );
  assert(forbidden.every((result) => !result.ok && result.error.code === "FORBIDDEN"));
  assert.deepEqual(session.errors, []);
  await application.close();
  await launch();
  assert.equal(
    await session.page
      .getByRole("switch", { name: "自动检查更新", exact: true })
      .getAttribute("aria-checked"),
    "true",
  );
  assert.equal(await session.application.evaluate(() => globalThis.updateQaRequests.length), 0);
  await session.application.close();
  await writeFile(join(directory, "updates.json"), "PRIVATE BROKEN UPDATE SETTINGS");
  await launch();
  const damaged = session.page.getByRole("region", { name: "应用更新", exact: true });
  await damaged.getByText("更新设置损坏，重置时会先保留原文件备份。", { exact: true }).waitFor();
  await damaged.getByRole("button", { name: "重置更新设置", exact: true }).click();
  await session.page
    .getByRole("dialog")
    .getByRole("button", { name: "确认继续", exact: true })
    .click();
  await damaged.getByText("等待检查", { exact: true }).waitFor();
  assert((await readdir(directory)).some((file) => file.startsWith("updates.json.backup-")));
  const publicState = JSON.stringify(
    (await session.page.evaluate(() => window.codexCoco.updates())).value,
  );
  assert(!publicState.includes("PRIVATE"));
  assert(!publicState.includes(directory));
  await damaged.screenshot({
    path: join(output, "update-settings.png"),
    scale: "css",
    animations: "disabled",
  });
  assert.deepEqual(session.errors, []);
  const diagnostics = (await readdir(join(directory, "diagnostics"))).filter((file) =>
    file.endsWith(".jsonl"),
  );
  for (const file of diagnostics)
    assert(
      !/PRIVATE|github\.com\/cixiangtao/.test(
        await readFile(join(directory, "diagnostics", file), "utf8"),
      ),
    );
  // Only the UI action transport is synthetic here; host consent/cancellation is covered by contracts.
  await session.application.evaluate(({ ipcMain, BrowserWindow }) => {
    globalThis.updateQaActions = [];
    let state = {
      revision: 0,
      preferences: { intervalHours: 24 },
      currentVersion: "0.1.0-preview.2",
      phase: "available",
      reason: null,
      installSupported: true,
      availableVersion: "0.1.0-preview.3",
      releaseUrl: "https://github.com/cixiangtao/codex-coco/releases/tag/v0.1.0-preview.3",
      progress: null,
      checkedAt: Date.now(),
    };
    const publish = () => {
      for (const window of BrowserWindow.getAllWindows())
        window.webContents.send("codex-coco:updates-changed", state);
    };
    ipcMain.removeHandler("codex-coco:update-action");
    ipcMain.handle("codex-coco:update-action", (_event, input) => {
      globalThis.updateQaActions.push(input);
      state = {
        ...state,
        phase: input.action === "cancel" ? "available" : "downloading",
        progress: input.action === "cancel" ? null : 17,
      };
      publish();
      return { ok: true, value: state };
    });
    publish();
  });
  await session.page
    .getByRole("navigation")
    .getByRole("button", { name: "外观", exact: true })
    .click();
  await session.page.getByText("Codex Coco 0.1.0-preview.3 可用", { exact: true }).waitFor();
  await session.page.setViewportSize({ width: 720, height: 800 });
  const noticeBox = await session.page
    .getByRole("alert")
    .filter({ hasText: "Codex Coco 0.1.0-preview.3 可用" })
    .boundingBox();
  const contentBox = await session.page.locator(".desktop-content").boundingBox();
  assert(
    noticeBox.y >= contentBox.y &&
      noticeBox.y + noticeBox.height <= contentBox.y + contentBox.height,
    "Update prompt remains in the viewport after navigation from a scrolled page",
  );
  await session.page.screenshot({
    path: join(output, "one-click-update-notice.png"),
    scale: "css",
  });
  await session.page.getByRole("button", { name: "更新并重启", exact: true }).click();
  await session.page.getByText("正在下载更新 17%", { exact: true }).waitFor();
  assert.equal(await session.page.getByRole("dialog").count(), 0);
  await session.page.getByRole("button", { name: "取消更新", exact: true }).click();
  await session.page.getByText("Codex Coco 0.1.0-preview.3 可用", { exact: true }).waitFor();
  assert.deepEqual(await session.application.evaluate(() => globalThis.updateQaActions), [
    { action: "update", confirmed: true },
    { action: "cancel" },
  ]);
  assert.deepEqual(session.errors, []);
  await session.application.close();
  await rm(join(directory, "updates.json"), { force: true });
  await launch();
  await session.application.evaluate(() => {
    globalThis.updateQaMode = "available";
  });
  await session.page.getByText("发现可用版本", { exact: true }).waitFor({ timeout: 15000 });
  assert.equal(await session.application.evaluate(() => globalThis.updateQaRequests.length), 1);
  assert.equal(
    (await session.page.evaluate(() => window.codexCoco.updates())).value.preferences.intervalHours,
    24,
  );
  assert.deepEqual(session.errors, []);
  console.log(
    JSON.stringify(
      {
        ok: true,
        packaged,
        automaticMetadataOnlyCheck: true,
        explicitManualMode: true,
        crossPageOneClickConsent: true,
        githubReleaseDetection: true,
        noRelease: true,
        unsignedChecksAndNativeBoundary: true,
        cancellationAndRecovery: true,
        restrictedReleaseNavigation: true,
        multiWindowPreferences: true,
        restartPersistence: true,
        corruptBackupRecovery: true,
        glanceReadAndWriteDenied: true,
        nativeInstallNotExecuted: true,
      },
      null,
      2,
    ),
  );
} finally {
  await session?.application.close();
  await rm(directory, { recursive: true, force: true });
}
