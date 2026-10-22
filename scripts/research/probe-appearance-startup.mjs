import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

// Controlled processes only. This probe neither opens an installed client nor changes OS launch settings.
const root = fileURLToPath(new URL("../../", import.meta.url));
const electron = createRequire(join(root, "apps/desktop/package.json"))("electron");
const directory = await mkdtemp(join(tmpdir(), "codex-coco-startup-probe-"));
const home = join(directory, "user-data");
const fixture = join(directory, "fixture.cjs");
await mkdir(home);
await writeFile(
  fixture,
  `
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
app.setName('Codex Coco Startup Probe');
app.setPath('userData', process.env.PROBE_HOME);
app.whenReady().then(async () => {
  const window = new BrowserWindow({ show: false });
  await window.loadURL('data:text/html,<title>Controlled startup probe</title><main>Controlled</main>');
  fs.writeFileSync(process.env.PROBE_MARKER, JSON.stringify({ pid: process.pid, electron: process.versions.electron, phase: 'ready', initialSwitch: app.commandLine.getSwitchValue('remote-debugging-port') }));
  if (process.env.PROBE_LATE_PORT) setTimeout(() => {
    app.commandLine.appendSwitch('remote-debugging-port', process.env.PROBE_LATE_PORT);
    fs.writeFileSync(process.env.PROBE_MARKER, JSON.stringify({ pid: process.pid, electron: process.versions.electron, phase: 'late-switch-added', currentSwitch: app.commandLine.getSwitchValue('remote-debugging-port') }));
  }, 500);
  const exit = setInterval(() => {
    if (fs.existsSync(process.env.PROBE_EXIT)) { clearInterval(exit); app.quit(); }
  }, 50);
});
`,
);
async function freePort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  assert(address && typeof address !== "string");
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  return address.port;
}
async function endpoint(port) {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/json/list`, {
      signal: AbortSignal.timeout(500),
      redirect: "error",
    });
    const pages = await response.json();
    return (
      response.ok &&
      Array.isArray(pages) &&
      pages.some((page) => page.type === "page" && page.url.startsWith("data:text/html,"))
    );
  } catch {
    return false;
  }
}
async function run(name, port, flags, late = false) {
  assert.equal(await endpoint(port), false, "The test owns an unused loopback port");
  const marker = join(directory, `${name}.json`);
  const exit = join(directory, `${name}.exit`);
  const environment = { ...process.env, PROBE_HOME: home, PROBE_MARKER: marker, PROBE_EXIT: exit };
  delete environment.ELECTRON_RUN_AS_NODE;
  delete environment.NODE_OPTIONS;
  delete environment.NODE_EXTRA_CA_CERTS;
  if (late) environment.PROBE_LATE_PORT = String(port);
  const child = spawn(electron, [fixture, ...flags], {
    env: environment,
    stdio: "ignore",
    detached: true,
  });
  assert(child.pid);
  const ended = once(child, "exit");
  let state;
  try {
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) {
      assert.equal(child.exitCode, null, "The controlled Electron process must stay alive");
      try {
        state = JSON.parse(await readFile(marker, "utf8"));
      } catch {}
      if (state?.phase === (late ? "late-switch-added" : "ready")) break;
      await delay(50);
    }
    assert.equal(state?.pid, child.pid);
    assert.equal(state.phase, late ? "late-switch-added" : "ready");
    if (late) assert.equal(state.currentSwitch, String(port));
    const observations = [];
    for (let sample = 0; sample < 10; sample++) {
      observations.push(await endpoint(port));
      await delay(150);
    }
    return {
      name,
      electron: state.electron,
      initialSwitch: state.initialSwitch ?? null,
      lateSwitchRecorded: late,
      cdpObserved: observations.some(Boolean),
      samples: observations.length,
    };
  } finally {
    await writeFile(exit, "quit");
    await Promise.race([ended, delay(3000)]);
    if (child.exitCode === null && child.signalCode === null) {
      // The detached group belongs only to the child created directly above.
      process.kill(-child.pid, "SIGKILL");
      await ended;
    }
  }
}
try {
  const port = await freePort();
  const normal = await run("ordinary-cold-start", port, []);
  const late = await run("append-after-window-ready", port, [], true);
  const parameterized = await run("explicit-debug-start", port, [
    `--remote-debugging-port=${port}`,
    "--remote-debugging-address=127.0.0.1",
  ]);
  const ordinaryAgain = await run("ordinary-after-full-exit", port, []);
  assert.equal(normal.initialSwitch, "");
  assert.equal(normal.cdpObserved, false);
  assert.equal(late.cdpObserved, false);
  assert.equal(parameterized.initialSwitch, String(port));
  assert.equal(parameterized.cdpObserved, true);
  assert.equal(ordinaryAgain.initialSwitch, "");
  assert.equal(ordinaryAgain.cdpObserved, false);
  console.log(
    JSON.stringify(
      {
        ok: true,
        authority: "controlled-replay",
        launchMethod: "direct-child-process",
        nativeDockClickTested: false,
        sameTemporaryUserData: true,
        installedClientExecuted: false,
        osLaunchSettingsChanged: false,
        observations: [normal, late, parameterized, ordinaryAgain],
      },
      null,
      2,
    ),
  );
} finally {
  await rm(directory, { recursive: true, force: true });
}
