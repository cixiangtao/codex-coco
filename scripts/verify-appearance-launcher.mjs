import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, mkdir, writeFile, readFile, rm, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { setTimeout as delay } from "node:timers/promises";
import { createAppearanceLauncher } from "../apps/desktop/src/modules/appearance/launcher.ts";
const exec = promisify(execFile);
const root = fileURLToPath(new URL("../", import.meta.url));
const electron = createRequire(join(root, "apps/desktop/package.json"))("electron");
const directory = await mkdtemp(join(tmpdir(), "codex-coco-launcher-"));
const bundle = join(directory, "Codex Coco Controlled Target.app");
const bundleId = "dev.codex-coco.launcher-test";
const marker = join(directory, "processes.json");
const pids = new Set();
const canonicalDirectory = await realpath(directory);
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
    `const {app,BrowserWindow,protocol}=require('electron');app.setPath('userData',${JSON.stringify(join(directory, "target-data"))});const port=process.argv.find(arg=>arg.startsWith('--remote-debugging-port=')).split('=')[1];app.commandLine.appendSwitch('remote-debugging-port',port);app.commandLine.appendSwitch('remote-debugging-address','127.0.0.1');protocol.registerSchemesAsPrivileged([{scheme:'app',privileges:{standard:true,secure:true}}]);app.whenReady().then(async()=>{protocol.handle('app',()=>new Response('<html data-codex-window-type="electron"><body><main data-app-shell-main-surface>Controlled</main></body></html>',{headers:{'content-type':'text/html'}}));const w=new BrowserWindow({show:false});await w.loadURL('app://-/index.html');});`,
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
  console.log(
    JSON.stringify(
      {
        ok: true,
        nativeBundleSelection: true,
        nativeOpenAndRealCdpPort: true,
        runningAppGuard: true,
        controlledRestart: true,
        quitSignalIntercepted: true,
        realCodexUntouched: true,
      },
      null,
      2,
    ),
  );
} finally {
  await stopTarget();
  await delay(250);
  for (const pid of pids) {
    await signalTarget(pid, "SIGKILL");
  }
  await rm(directory, { recursive: true, force: true });
}
