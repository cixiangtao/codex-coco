import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { arch, cpus, platform, release, totalmem, tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { createDesktopSession } from "./verify-desktop.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const packaged = process.argv.includes("--packaged");
const executable = packaged
  ? join(root, "apps/desktop/release/mac-arm64/Codex Coco.app/Contents/MacOS/Codex Coco")
  : undefined;
const runs = Number(process.argv.find((value) => value.startsWith("--runs="))?.slice(7) ?? 3);
assert.ok(
  Number.isInteger(runs) && runs >= 3 && runs <= 10,
  "--runs must be an integer from 3 to 10",
);
const sampleMs = 1000;
const round = (value) => Math.round(value * 100) / 100;
const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};

async function nativeVisible(application, page) {
  const native = await application.browserWindow(page);
  const deadline = performance.now() + 8000;
  while (!(await native.evaluate((window) => window.isVisible()))) {
    assert.ok(performance.now() < deadline, "Native window did not become visible");
    await delay(10);
  }
}
async function metrics(application) {
  return application.evaluate(({ app, BrowserWindow }) => ({
    windowCount: BrowserWindow.getAllWindows().length,
    resources: process.getActiveResourcesInfo().reduce((counts, name) => {
      counts[name] = (counts[name] ?? 0) + 1;
      return counts;
    }, {}),
    processes: app.getAppMetrics().map(({ pid, creationTime, type, cpu, memory }) => ({
      identity: `${pid}:${creationTime}`,
      type,
      cumulativeCpuSeconds: cpu.cumulativeCPUUsage ?? null,
      intervalCpuPercent: cpu.percentCPUUsage,
      workingSetKiB: memory.workingSetSize,
      peakWorkingSetKiB: memory.peakWorkingSetSize,
    })),
  }));
}
/** Priming excludes the API's zero-valued first CPU sample. No other sampler runs in the app. */
async function sample(application, name) {
  const before = await metrics(application);
  const began = performance.now();
  await delay(sampleMs);
  const after = await metrics(application);
  const elapsedMs = performance.now() - began;
  const processes = after.processes.map((item, index) => {
    const previous = before.processes.find((candidate) => candidate.identity === item.identity);
    const cumulative =
      previous?.cumulativeCpuSeconds !== null &&
      previous?.cumulativeCpuSeconds !== undefined &&
      item.cumulativeCpuSeconds !== null;
    const cpuPercent = cumulative
      ? ((item.cumulativeCpuSeconds - previous.cumulativeCpuSeconds) / (elapsedMs / 1000)) * 100
      : item.intervalCpuPercent;
    assert.ok(Number.isFinite(cpuPercent) && cpuPercent >= 0);
    assert.ok(Number.isFinite(item.workingSetKiB) && item.workingSetKiB >= 0);
    return {
      slot: index + 1,
      type: item.type,
      cpuPercent: round(cpuPercent),
      cpuMethod: cumulative ? "cumulative-delta-one-core" : "electron-interval-api",
      appearedDuringSample: !previous,
      workingSetMiB: round(item.workingSetKiB / 1024),
      peakWorkingSetMiB: round(item.peakWorkingSetKiB / 1024),
    };
  });
  assert.ok(processes.some((item) => item.type === "Browser"));
  return {
    name,
    intervalMs: round(elapsedMs),
    windowCount: after.windowCount,
    activeResourceCounts: after.resources,
    processes,
    sumCpuPercent: round(processes.reduce((sum, item) => sum + item.cpuPercent, 0)),
    sumWorkingSetMiB: round(processes.reduce((sum, item) => sum + item.workingSetMiB, 0)),
  };
}
async function windowFromMenu(application) {
  const waiting = application.waitForEvent("window");
  await application.evaluate(({ Menu }) => {
    Menu.getApplicationMenu()
      .items.flatMap((item) => item.submenu?.items ?? [])
      .find((item) => item.label === "新建窗口")
      .click();
  });
  const page = await waiting;
  await page.getByRole("heading", { name: "Codex Coco", exact: true }).waitFor();
  await nativeVisible(application, page);
  return page;
}
async function moduleSummary(page) {
  const response = await page.evaluate(() => window.codexCoco.modules());
  assert.equal(response.ok, true);
  return response.value.map(({ id, phase, operation }) => ({
    id,
    phase,
    activeTask: ["running", "cancelling"].includes(operation?.phase),
  }));
}
async function milestones(directory) {
  const path = join(directory, "diagnostics");
  const records = (
    await Promise.all(
      (await readdir(path))
        .filter((name) => /^events(?:\.\d+)?\.jsonl$/.test(name))
        .map((name) => readFile(join(path, name), "utf8")),
    )
  ).flatMap((text) =>
    text
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line)),
  );
  const ready = records.find((item) => item.event === "app.ready");
  const window = records.find((item) => item.event === "window.ready");
  assert.ok(ready && window, "Startup diagnostic milestones are missing");
  return { appInitializationMs: ready.durationMs, firstWindowHandshakeMs: window.durationMs };
}

const temporary = await mkdtemp(join(tmpdir(), "codex-coco-profile-"));
const report = {
  schemaVersion: 1,
  measuredAt: new Date().toISOString(),
  mode: packaged ? "packaged-macos-arm64" : "production-files",
  environment: {
    platform: platform(),
    arch: arch(),
    osRelease: release(),
    cpuModel: cpus()[0]?.model,
    logicalCpus: cpus().length,
    memoryGiB: round(totalmem() / 1024 ** 3),
  },
  runtime: {},
  runs: [],
  scenarios: [],
  methodology: {
    runs,
    warmupLaunches: 1,
    targetSampleMs: sampleMs,
    settleMs: 500,
    cachePolicy: "OS caches are not cleared; process restarts use fresh temporary data",
    memory:
      "Sum of per-process working sets can double-count shared pages; this is not unique physical memory",
    startup:
      "External startup includes Playwright launch and inspection overhead; host milestones are narrower and do not measure first paint",
    cpu: "Cumulative deltas use 100% per CPU core where available; first-observed processes fall back to Electron interval metrics",
    thresholds:
      "Reference measurements only; no performance budget or cross-machine pass/fail claim",
  },
};
let session;
try {
  for (let index = -1; index < runs; index++) {
    const directory = join(temporary, `launch-${index + 1}`);
    const began = performance.now();
    session = await createDesktopSession(
      directory,
      { ...process.env, CODEX_COCO_FIXTURES: "0" },
      executable,
    );
    await nativeVisible(session.application, session.page);
    const externalStartupMs = round(performance.now() - began);
    report.runtime = await session.application.evaluate(() => ({
      electron: process.versions.electron,
      chromium: process.versions.chrome,
      node: process.versions.node,
    }));
    assert.deepEqual(await moduleSummary(session.page), []);
    if (index >= 0) {
      await delay(500);
      const idle = await sample(session.application, "one-window-idle");
      report.runs.push({ externalStartupMs, idle });
      if (index === 0) {
        await windowFromMenu(session.application);
        await delay(500);
        report.scenarios.push(await sample(session.application, "two-windows-idle"));
        if (platform() === "darwin") {
          const closed = session.application.windows().map((page) => page.waitForEvent("close"));
          await session.application.evaluate(({ BrowserWindow }) => {
            for (const window of BrowserWindow.getAllWindows()) window.close();
          });
          await Promise.all(closed);
          await delay(500);
          const background = await sample(session.application, "no-window-background");
          assert.equal(background.windowCount, 0);
          report.scenarios.push(background);
        }
      }
    }
    assert.deepEqual(session.errors, []);
    await session.application.close();
    session = undefined;
    if (index >= 0) Object.assign(report.runs[index], await milestones(directory));
    console.log(
      index < 0 ? "Profile: warmup complete" : `Profile: launch ${index + 1}/${runs} complete`,
    );
  }
  // Packaged builds deliberately cannot load fixtures, so this synthetic comparison is unpackaged only.
  if (!packaged) {
    session = await createDesktopSession(join(temporary, "fixtures"), {
      ...process.env,
      CODEX_COCO_FIXTURES: "1",
    });
    await nativeVisible(session.application, session.page);
    await delay(500);
    report.scenarios.push({
      ...(await sample(session.application, "fixtures-disabled")),
      modules: await moduleSummary(session.page),
    });
    const enabled = await session.page.evaluate(() =>
      Promise.all(
        ["foundation-fixture", "foundation-peer"].map((moduleId) =>
          window.codexCoco.enableModule({ moduleId, enabled: true }),
        ),
      ),
    );
    assert.ok(enabled.every((item) => item.ok));
    const started = await session.page.evaluate(() =>
      Promise.all(
        ["foundation-fixture", "foundation-peer"].map((moduleId) =>
          window.codexCoco.runModuleOperation({
            moduleId,
            operation: "count",
            input: { steps: 20 },
          }),
        ),
      ),
    );
    assert.ok(started.every((item) => item.ok));
    report.scenarios.push({
      ...(await sample(session.application, "fixtures-active")),
      modules: await moduleSummary(session.page),
    });
    const disabled = await session.page.evaluate(() =>
      Promise.all(
        ["foundation-fixture", "foundation-peer"].map((moduleId) =>
          window.codexCoco.enableModule({ moduleId, enabled: false }),
        ),
      ),
    );
    assert.ok(disabled.every((item) => item.ok));
    await delay(500);
    const stopped = {
      ...(await sample(session.application, "fixtures-stopped")),
      modules: await moduleSummary(session.page),
    };
    assert.ok(stopped.modules.every((item) => item.phase === "disabled" && !item.activeTask));
    report.scenarios.push(stopped);
    assert.deepEqual(session.errors, []);
    await session.application.close();
    session = undefined;
  }
  report.summary = {
    externalStartupMedianMs: round(median(report.runs.map((item) => item.externalStartupMs))),
    hostInitializationMedianMs: round(median(report.runs.map((item) => item.appInitializationMs))),
    firstWindowHandshakeMedianMs: round(
      median(report.runs.map((item) => item.firstWindowHandshakeMs)),
    ),
    idleWorkingSetMedianMiB: round(median(report.runs.map((item) => item.idle.sumWorkingSetMiB))),
    idleCpuMedianPercent: round(median(report.runs.map((item) => item.idle.sumCpuPercent))),
  };
  const output = join(
    root,
    "work",
    packaged ? "performance-packaged.json" : "performance-baseline.json",
  );
  await mkdir(join(root, "work"), { recursive: true });
  await writeFile(output, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ ok: true, output, summary: report.summary }, null, 2));
} finally {
  await session?.application.close();
  await rm(temporary, { recursive: true, force: true });
}
