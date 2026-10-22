import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createDesktopSession } from "./verify-desktop.mjs";
const root = fileURLToPath(new URL("../", import.meta.url));
const directory = await mkdtemp(join(tmpdir(), "codex-coco-reset-desktop-"));
const packaged = process.argv.includes("--packaged");
const bin = join(directory, "bin");
await mkdir(bin);
const mode = join(directory, "mode");
const ledger = join(directory, "ledger");
await writeFile(mode, "reset-pending");
await writeFile(
  join(bin, "codex"),
  `#!${process.execPath}\n${await readFile(join(root, "tests/fixtures/usage-server.mjs"), "utf8")}`,
  { mode: 0o700 },
);
const environment = {
  ...process.env,
  CODEX_COCO_FIXTURES: "0",
  CODEX_HOME: join(directory, "codex"),
  PATH: `${bin}:${process.env.PATH ?? ""}`,
  FAKE_USAGE_MODE_FILE: mode,
  FAKE_RESET_LEDGER: ledger,
};
let session;
async function open() {
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
  return session.page;
}
try {
  let page = await open();
  await page.getByRole("button", { name: "启用并读取用量", exact: true }).click();
  await page.getByRole("tab", { name: "辅助工具", exact: true }).click();
  await page.getByText("服务可用重置卡：1 次", { exact: true }).waitFor();
  await page.getByRole("button", { name: "兑换这张重置卡", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "取消", exact: true }).click();
  await assert.rejects(readFile(ledger));
  await page.getByRole("button", { name: "兑换这张重置卡", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "确认兑换", exact: true }).click();
  await page.getByText("兑换结果尚未确认", { exact: true }).waitFor();
  const before = JSON.parse(await readFile(ledger, "utf8"));
  assert.equal(before.length, 1);
  const output = join(
    root,
    packaged ? "work/reset-verification-packaged" : "work/reset-verification",
  );
  await mkdir(output, { recursive: true });
  await page.screenshot({
    path: join(output, "pending.png"),
    scale: "css",
    animations: "disabled",
  });
  await session.application.close();
  session = undefined;
  await writeFile(mode, "reset-ready");
  page = await open();
  await page.getByRole("tab", { name: "辅助工具", exact: true }).click();
  await page.getByRole("button", { name: "检查上次兑换", exact: true }).click();
  await page.getByText("兑换结果尚未确认", { exact: true }).waitFor();
  await page.getByRole("button", { name: "重试同一次兑换", exact: true }).click();
  await page.getByText("此兑换此前已完成", { exact: true }).waitFor();
  await page.getByRole("tab", { name: "总览", exact: true }).click();
  await page.getByText("剩余 75%", { exact: true }).waitFor();
  assert.deepEqual(JSON.parse(await readFile(ledger, "utf8")), before);
  assert(
    !JSON.stringify(await page.evaluate(() => window.codexCoco.modules())).match(
      /private-credit-id|private@example|private-token/,
    ),
  );
  assert.deepEqual(session.errors, []);
  console.log(
    JSON.stringify(
      {
        ok: true,
        packaged,
        explicitConfirmation: true,
        cancelWithoutMutation: true,
        persistedUncertainAttempt: true,
        restartAndIdempotentRetry: true,
        refreshRatherThanInventQuota: true,
        privateIdsExcluded: true,
      },
      null,
      2,
    ),
  );
} finally {
  await session?.application.close();
  await rm(directory, { recursive: true, force: true });
}
