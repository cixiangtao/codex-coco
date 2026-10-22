import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createDesktopSession } from "./verify-desktop.mjs";
const root = fileURLToPath(new URL("../", import.meta.url));
const directory = await mkdtemp(join(tmpdir(), "codex-coco-update-ui-"));
const packaged = process.argv.includes("--packaged");
const settingsOutput = join(
  root,
  packaged ? "work/settings-groups-packaged" : "work/settings-groups",
);
await mkdir(settingsOutput, { recursive: true });
let session;
async function launch() {
  session = await createDesktopSession(
    directory,
    { ...process.env, CODEX_COCO_FIXTURES: "0" },
    packaged
      ? join(root, "apps/desktop/release/mac-arm64/Codex Coco.app/Contents/MacOS/Codex Coco")
      : undefined,
  );
  await session.page
    .getByRole("navigation")
    .getByRole("button", { name: "设置", exact: true })
    .click();
  return session;
}
try {
  let { application, page } = await launch();
  const section = page.getByRole("region", { name: "应用更新", exact: true });
  await section.getByText("尚未配置发布源", { exact: true }).first().waitFor();
  await section.getByLabel("发布源目录", { exact: true }).focus();
  await page.screenshot({
    path: join(settingsOutput, "update-settings-light.png"),
    scale: "css",
    animations: "disabled",
  });
  await application.evaluate(({ net }) => {
    globalThis.updateQaRequests = 0;
    const original = net.request;
    net.request = function (...args) {
      globalThis.updateQaRequests++;
      return original.apply(this, args);
    };
  });
  await section.getByRole("button", { name: "检查 Codex Coco 更新", exact: true }).click();
  assert.equal((await page.evaluate(() => window.codexCoco.updates())).value.phase, "unconfigured");
  await section
    .getByLabel("发布源目录", { exact: true })
    .fill("https://updates.example.invalid/codex-coco/");
  await section.getByRole("button", { name: "保存更新偏好", exact: true }).click();
  await section.getByText("更新偏好已保存。", { exact: true }).waitFor();
  await section.getByRole("button", { name: "检查 Codex Coco 更新", exact: true }).click();
  await section.getByText("需要签名的 macOS 安装版", { exact: true }).first().waitFor();
  assert.equal(
    (await page.evaluate(() => window.codexCoco.updates())).value.reason,
    "SIGNED_INSTALL_REQUIRED",
  );
  assert.equal(await application.evaluate(() => globalThis.updateQaRequests), 0);
  assert(
    await section.getByRole("button", { name: "安装并重启 Codex Coco", exact: true }).isDisabled(),
  );
  const stale = await page.evaluate(() =>
    window.codexCoco.saveUpdatePreferences({
      expectedRevision: 0,
      value: { source: "", intervalHours: 0 },
    }),
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
  await second.getByRole("navigation").getByRole("button", { name: "设置", exact: true }).click();
  assert.equal(
    await second.getByLabel("发布源目录", { exact: true }).inputValue(),
    "https://updates.example.invalid/codex-coco/",
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
      window.codexCoco.saveUpdatePreferences({
        expectedRevision: 1,
        value: { source: "", intervalHours: 0 },
      }),
      window.codexCoco.updateAction({ action: "install", confirmed: true }),
    ]),
  );
  assert(forbidden.every((result) => !result.ok && result.error.code === "FORBIDDEN"));
  assert.deepEqual(session.errors, []);
  await application.close();
  await launch();
  assert.equal(
    await session.page.getByLabel("发布源目录", { exact: true }).inputValue(),
    "https://updates.example.invalid/codex-coco/",
  );
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
  await damaged.getByText("尚未配置发布源", { exact: true }).first().waitFor();
  assert((await readdir(directory)).some((file) => file.startsWith("updates.json.backup-")));
  const publicState = JSON.stringify(
    (await session.page.evaluate(() => window.codexCoco.updates())).value,
  );
  assert(!publicState.includes("PRIVATE"));
  assert(!publicState.includes(directory));
  const output = join(
    root,
    packaged ? "work/update-verification-packaged" : "work/update-verification",
  );
  await mkdir(output, { recursive: true });
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
      !(await readFile(join(directory, "diagnostics", file), "utf8")).includes(
        "updates.example.invalid",
      ),
    );
  console.log(
    JSON.stringify(
      {
        ok: true,
        packaged,
        noDefaultNetwork: true,
        unsignedBoundary: true,
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
