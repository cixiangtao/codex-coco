import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, mkdir, writeFile, readFile, rm, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { setTimeout as delay } from "node:timers/promises";
import { createDesktopSession } from "./verify-desktop.mjs";
import { createAppearanceLauncher } from "../apps/desktop/src/modules/appearance/launcher.ts";
const exec = promisify(execFile);
const root = fileURLToPath(new URL("../", import.meta.url));
const electron = createRequire(join(root, "apps/desktop/package.json"))("electron");
const directory = await mkdtemp(join(tmpdir(), "codex-coco-launcher-"));
const bundle = join(directory, "Codex Coco Controlled Target.app");
const bundleId = "dev.codex-coco.launcher-test";
const marker = join(directory, "processes.json");
const pids = new Set();
const packaged = process.argv.includes("--packaged");
let session;
const canonicalDirectory = await realpath(directory);
async function waitForPage(page, predicate, argument, options = {}) {
  const deadline = Date.now() + (options.timeout ?? 10_000);
  do {
    if (await page.evaluate(predicate, argument)) return;
    await delay(50);
  } while (Date.now() < deadline);
  assert.fail("Controlled UI condition did not become ready");
}
async function signalTarget(pid, signal) {
  try {
    const { stdout } = await exec("/bin/ps", ["-p", String(pid), "-o", "command="], {
      timeout: 2000,
      maxBuffer: 8192,
    });
    if (stdout.includes(directory) || stdout.includes(canonicalDirectory))
      process.kill(pid, signal);
  } catch {
    /* Already exited, or no longer the controlled process. */
  }
}
async function markerValue() {
  try {
    return JSON.parse(await readFile(marker, "utf8"));
  } catch {
    return null;
  }
}
async function stopTarget() {
  const value = await markerValue();
  if (value)
    for (const pid of [value.child, value.wrapper]) {
      pids.add(pid);
      await signalTarget(pid, "SIGTERM");
    }
}
try {
  await mkdir(join(bundle, "Contents/MacOS"), { recursive: true });
  await writeFile(
    join(bundle, "Contents/Info.plist"),
    `<?xml version="1.0" encoding="UTF-8"?><plist version="1.0"><dict><key>CFBundleIdentifier</key><string>${bundleId}</string><key>CFBundleExecutable</key><string>controlled-launcher</string><key>CFBundleName</key><string>Codex Coco Controlled Target</string><key>CFBundlePackageType</key><string>APPL</string><key>LSUIElement</key><true/></dict></plist>`,
  );
  const fixture = join(directory, "target.cjs");
  await writeFile(
    fixture,
    `const {app,BrowserWindow,protocol}=require('electron');app.setPath('userData',${JSON.stringify(join(directory, "target-data"))});const port=process.argv.find(arg=>arg.startsWith('--remote-debugging-port='))?.split('=')[1];if(port){app.commandLine.appendSwitch('remote-debugging-port',port);app.commandLine.appendSwitch('remote-debugging-address','127.0.0.1');}protocol.registerSchemesAsPrivileged([{scheme:'app',privileges:{standard:true,secure:true}}]);app.whenReady().then(async()=>{protocol.handle('app',()=>new Response('<html data-codex-window-type="electron"><body><main data-app-shell-main-surface>Controlled</main></body></html>',{headers:{'content-type':'text/html'}}));const w=new BrowserWindow({show:false});await w.loadURL('app://-/index.html');});`,
  );
  const source = join(directory, "launcher.swift");
  await writeFile(
    source,
    `import Foundation\nlet child=Process()\nchild.executableURL=URL(fileURLWithPath:${JSON.stringify(electron)})\nchild.arguments=[${JSON.stringify(fixture)}]+Array(CommandLine.arguments.dropFirst())\nvar environment=ProcessInfo.processInfo.environment\nenvironment.removeValue(forKey:"ELECTRON_RUN_AS_NODE")\nchild.environment=environment\nchild.standardOutput=FileHandle.nullDevice\nchild.standardError=FileHandle.nullDevice\ntry child.run()\nlet data=try JSONSerialization.data(withJSONObject:["wrapper":ProcessInfo.processInfo.processIdentifier,"child":child.processIdentifier])\ntry data.write(to:URL(fileURLWithPath:${JSON.stringify(marker)}))\nchild.waitUntilExit()\n`,
  );
  await exec(
    "/Library/Developer/CommandLineTools/usr/bin/swiftc",
    [
      source,
      "-sdk",
      "/Library/Developer/CommandLineTools/SDKs/MacOSX.sdk",
      "-target",
      `${process.arch === "arm64" ? "arm64" : "x86_64"}-apple-macos14.0`,
      "-module-cache-path",
      join(directory, "module-cache"),
      "-o",
      join(bundle, "Contents/MacOS/controlled-launcher"),
    ],
    { timeout: 60_000, maxBuffer: 64 * 1024 },
  );
  const privateState = join(directory, "selection.json");
  let interceptedQuits = 0;
  const launcher = createAppearanceLauncher({
    file: privateState,
    bundleId,
    pick: async () => bundle,
    run: async (command, args, signal) => {
      if (command === "/usr/bin/osascript") {
        assert(args[1].includes(bundle));
        interceptedQuits++;
        await stopTarget();
        return "";
      }
      return (await exec(command, args, { signal, timeout: 5000, maxBuffer: 512 * 1024 })).stdout;
    },
  });
  await launcher.choose(AbortSignal.timeout(5000));
  const config = { portMode: "auto", port: 9229 };
  async function started(port) {
    const until = Date.now() + 15000;
    while (Date.now() < until) {
      const marker = await markerValue();
      if (marker) {
        pids.add(marker.wrapper);
        pids.add(marker.child);
      }
      try {
        const targets = await (
          await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(500) })
        ).json();
        if (targets.some((target) => target.url === "app://-/index.html")) return;
      } catch {}
      await delay(80);
    }
    assert.fail("Controlled target did not expose the allocated loopback port");
  }
  const first = await launcher.launch(config, false, AbortSignal.timeout(10000));
  await started(first);
  await assert.rejects(launcher.launch(config, false, AbortSignal.timeout(10000)), /APP_RUNNING/);
  assert.equal(interceptedQuits, 0);
  const second = await launcher.launch(config, true, AbortSignal.timeout(15000));
  await started(second);
  assert.equal(interceptedQuits, 1);
  assert.equal(await launcher.port(config), second);
  assert((await readFile(privateState, "utf8")).includes("Codex Coco Controlled Target.app"));
  // The production UI selects this temporary bundle. No production restart is confirmed.
  // Changing its identifier here exercises the real selection guard without touching an installed app.
  const infoPath = join(bundle, "Contents/Info.plist");
  await writeFile(
    infoPath,
    (await readFile(infoPath, "utf8")).replace(bundleId, "com.openai.codex"),
  );
  session = await createDesktopSession(
    join(directory, "desktop-data"),
    { ...process.env, CODEX_COCO_FIXTURES: "0" },
    packaged
      ? join(root, "apps/desktop/release/mac-arm64/Codex Coco.app/Contents/MacOS/Codex Coco")
      : undefined,
  );
  const { page, application, errors } = session;
  await page.getByRole("button", { name: "启用外观模块", exact: true }).click();
  await page.getByRole("tab", { name: "连接设置", exact: true }).click();
  const launchButton = page.getByRole("button", { name: "启动所选应用", exact: true });
  const feedback = page.getByRole("alert", { name: "Codex 启动状态", exact: true });
  await launchButton.click();
  await feedback.getByText("请先选择 Codex 应用。", { exact: true }).waitFor();
  const refreshProjection = async () => {
    const response = await page.evaluate(() =>
      window.codexCoco.runModuleOperation({
        moduleId: "appearance",
        operation: "list-gallery",
        input: {},
      }),
    );
    assert.equal(response.ok, true);
    await waitForPage(
      page,
      async (id) => {
        const module = (await window.codexCoco.modules()).value.find(
          (entry) => entry.id === "appearance",
        );
        return module.operation?.id === id && module.operation.phase === "succeeded";
      },
      response.value.operation.id,
    );
  };
  await refreshProjection();
  await feedback.getByText("请先选择 Codex 应用。", { exact: true }).waitFor();
  await application.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] });
  }, bundle);
  await page.getByRole("button", { name: "选择 Codex 应用", exact: true }).click();
  await waitForPage(
    page,
    async () =>
      (await window.codexCoco.modules()).value.find((entry) => entry.id === "appearance").state
        ?.appSelected === true,
  );
  const runningTarget = await markerValue();
  await launchButton.click();
  const confirmation = page.getByRole("dialog");
  await confirmation.getByRole("heading", { name: "重启所选应用？", exact: true }).waitFor();
  await confirmation.getByRole("button", { name: "取消", exact: true }).click();
  await confirmation.waitFor({ state: "hidden" });
  await feedback
    .getByText("所选应用仍在运行。请保存工作后使用明确重启，或手动关闭后再启动。", { exact: true })
    .waitFor();
  await refreshProjection();
  assert.equal(
    await confirmation.count(),
    0,
    "Background projection updates do not reopen restart consent",
  );
  await feedback.getByRole("button", { name: "保存工作后重启 Codex", exact: true }).waitFor();
  assert.deepEqual(
    await markerValue(),
    runningTarget,
    "Declining restart does not quit or relaunch the selected target",
  );
  const output = join(
    root,
    packaged ? "work/appearance-launcher-packaged" : "work/appearance-launcher",
  );
  await mkdir(output, { recursive: true });
  await feedback.scrollIntoViewIfNeeded();
  await page.screenshot({
    path: join(output, "launch-running-feedback.png"),
    animations: "disabled",
    scale: "css",
  });
  await stopTarget();
  await delay(500);
  await rm(marker, { force: true });
  // Ordinary startup is a separate controlled process, with no debug arguments.
  await exec("/usr/bin/open", ["-n", "-a", bundle]);
  for (let i = 0; i < 100 && !(await markerValue()); i++) await delay(50);
  assert(await markerValue());
  const nativeProbe = createAppearanceLauncher({
    file: join(directory, "desktop-data", "appearance-launcher.json"),
    pick: async () => null,
  });
  assert.deepEqual(await nativeProbe.probe(AbortSignal.timeout(10_000)), {
    running: true,
    debugPort: null,
  });
  const observe = async () => {
    await waitForPage(page, async () => {
      const module = (await window.codexCoco.modules()).value.find(
        (entry) => entry.id === "appearance",
      );
      return !["running", "cancelling"].includes(module.operation?.phase);
    });
    const response = await page.evaluate(() =>
      window.codexCoco.runModuleOperation({
        moduleId: "appearance",
        operation: "monitor",
        input: {},
      }),
    );
    assert.equal(response.ok, true);
    await waitForPage(
      page,
      async (id) => {
        const module = (await window.codexCoco.modules()).value.find(
          (entry) => entry.id === "appearance",
        );
        return module.operation?.id === id && module.operation.phase === "succeeded";
      },
      response.value.operation.id,
    );
  };
  await observe();
  assert.equal(
    (await page.evaluate(() => window.codexCoco.modules())).value.find(
      (entry) => entry.id === "appearance",
    ).state.connection,
    "needs-restart",
  );
  await application.evaluate(({ dialog }) => {
    globalThis.__restartConfirmations = 0;
    dialog.showMessageBox = async () => {
      globalThis.__restartConfirmations++;
      return { response: 0, checkboxChecked: false };
    };
  });
  const popupEvent = application.waitForEvent("window");
  await application.evaluate(({ Menu }) =>
    Menu.getApplicationMenu()
      .items.flatMap((item) => item.submenu?.items ?? [])
      .find((item) => item.label === "显示或收起速览")
      .click(),
  );
  const popup = await popupEvent;
  const quickRestart = popup.getByRole("button", { name: "重启并应用布景", exact: true });
  await quickRestart.waitFor();
  const ordinaryTarget = await markerValue();
  await quickRestart.click();
  await waitForPage(
    popup,
    async () =>
      (await window.codexCoco.glance()).value.items.find((item) => item.id === "appearance")
        ?.appearanceAction === "restart",
  );
  assert.equal(await application.evaluate(() => globalThis.__restartConfirmations), 1);
  assert.deepEqual(
    await markerValue(),
    ordinaryTarget,
    "Cancelling native quick-restart confirmation keeps the running target",
  );
  assert.equal(
    (
      await popup.evaluate(() =>
        window.codexCoco.appearanceQuickAction({ action: "restart", path: "/private" }),
      )
    ).error.code,
    "INVALID_INPUT",
  );
  assert.equal(
    (await page.evaluate(() => window.codexCoco.appearanceQuickAction({ action: "restart" }))).error
      .code,
    "FORBIDDEN",
  );
  // Main-window permission probes may focus it and dismiss the native popover.
  const popupWindow = await application.browserWindow(popup);
  if (!(await popupWindow.evaluate((window) => window.isVisible()))) {
    await application.evaluate(({ Menu }) =>
      Menu.getApplicationMenu()
        .items.flatMap((item) => item.submenu?.items ?? [])
        .find((item) => item.label === "显示或收起速览")
        .click(),
    );
  }
  await popupWindow.evaluate((window) => {
    window.show();
    window.focus();
  });
  await popup.waitForFunction(
    () => document.querySelector(".glance-shell")?.getAttribute("data-visible") === "true",
  );
  await popup.screenshot({
    path: join(output, "glance-quick-restart.png"),
    animations: "disabled",
    scale: "css",
  });
  await popup.evaluate(() => window.codexCoco.dismissGlance());
  await stopTarget();
  await delay(500);
  await rm(marker, { force: true });
  // Save a real imported image, then launch from the panel. Applying needs no second click.
  await application.browserWindow(page).then((win) =>
    win.evaluate((win) => {
      win.show();
      win.focus();
    }),
  );
  await observe();
  const imagePath = join(directory, "source.png");
  await writeFile(
    imagePath,
    Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jGv8AAAAASUVORK5CYII=",
      "base64",
    ),
  );
  await application.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] });
  }, imagePath);
  const imported = await page.evaluate(() =>
    window.codexCoco.runModuleOperation({
      moduleId: "appearance",
      operation: "import-image",
      input: {},
    }),
  );
  assert.equal(imported.ok, true);
  await waitForPage(
    page,
    async (id) => {
      const op = (await window.codexCoco.modules()).value.find(
        (entry) => entry.id === "appearance",
      ).operation;
      return op?.id === id && op.phase === "succeeded";
    },
    imported.value.operation.id,
  );
  const saved = await page.evaluate(async () => {
    const snapshot = (await window.codexCoco.modules()).value.find(
      (entry) => entry.id === "appearance",
    );
    const image = snapshot.operation.result.imported;
    if (!image) throw new Error("Missing imported fixture");
    return window.codexCoco.saveModuleConfig({
      moduleId: "appearance",
      expectedRevision: snapshot.config.revision,
      value: {
        ...snapshot.config.value,
        main: { ...snapshot.config.value.main, image, enabled: true },
      },
    });
  });
  assert.equal(saved.ok, true);
  await observe();
  await application.evaluate(({ Menu }) =>
    Menu.getApplicationMenu()
      .items.flatMap((item) => item.submenu?.items ?? [])
      .find((item) => item.label === "显示或收起速览")
      .click(),
  );
  await popup.getByRole("button", { name: "启动并应用布景", exact: true }).click();
  await waitForPage(
    page,
    async () => {
      const state = (await window.codexCoco.modules()).value.find(
        (entry) => entry.id === "appearance",
      ).state;
      return state?.active === true && state.connection === "ready";
    },
    null,
    { timeout: 40_000 },
  );
  await popup.getByText("布景已应用，持续同步 1 个窗口。", { exact: true }).waitFor();
  // Launching the target can move native focus and close the panel. Reopen it for visual evidence.
  await application.browserWindow(popup).then((win) =>
    win.evaluate((win) => {
      win.show();
      win.focus();
    }),
  );
  await delay(200);
  await popup.screenshot({
    path: join(output, "glance-auto-applied.png"),
    animations: "disabled",
    scale: "css",
  });
  await popup.evaluate(() => window.codexCoco.dismissGlance());
  await application.browserWindow(page).then((win) =>
    win.evaluate((win) => {
      win.show();
      win.focus();
    }),
  );

  const launchedState = (await page.evaluate(() => window.codexCoco.modules())).value.find(
    (entry) => entry.id === "appearance",
  ).state;
  assert.equal(launchedState.targets, 1);
  assert.equal(launchedState.active, true);
  await page.getByRole("tab", { name: "布景编辑", exact: true }).click();
  await page.getByRole("heading", { name: "外观", exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({
    path: join(output, "glance-launch-main-state.png"),
    animations: "disabled",
    scale: "css",
  });
  assert.deepEqual(errors, []);
  await session.application.close();
  session = null;
  console.log(
    JSON.stringify(
      {
        ok: true,
        packaged,
        nativeBundleSelection: true,
        productionLaunchUi: true,
        persistentLaunchFeedback: true,
        runningAppConsentAndCancel: true,
        nativeOpenAndRealCdpPort: true,
        runningAppGuard: true,
        controlledRestart: true,
        quitSignalIntercepted: true,
        ordinaryLaunchDetection: true,
        glanceRestartConsentCancellation: true,
        glanceLaunchAutomaticallyAppliesAndVerifies: true,
        realCodexUntouched: true,
      },
      null,
      2,
    ),
  );
} finally {
  await session?.application.close();
  await stopTarget();
  await delay(250);
  for (const pid of pids) {
    await signalTarget(pid, "SIGKILL");
  }
  await rm(directory, { recursive: true, force: true });
}
