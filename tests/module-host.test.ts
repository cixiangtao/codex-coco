import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, readdir, rm, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { setTimeout as delay } from "node:timers/promises";
import {
  fixtureInputSchema,
  fixtureResultSchema,
} from "../apps/desktop/src/modules/foundation-fixture/contract";
import { ModuleHost, type BuiltinModule } from "../apps/desktop/src/application/module-host";
import { createFoundationFixture, createFixtureWorker } from "./support/fixture";
import { registeredModules } from "../apps/desktop/src/modules/registry";
import type { ModuleSnapshot } from "../apps/desktop/src/contracts/modules";
import { runModuleOperationSchema } from "../apps/desktop/src/contracts/modules";
import type { JsonValue } from "../apps/desktop/src/contracts/modules";

const dirs: string[] = [];
const hosts: ModuleHost[] = [];
async function fixture(
  definitions: BuiltinModule[] = [createFoundationFixture("one"), createFoundationFixture("two")],
  timeoutMs = 250,
) {
  const directory = await mkdtemp(join(tmpdir(), "codex-coco-modules-"));
  dirs.push(directory);
  const host = new ModuleHost(definitions, directory, timeoutMs);
  hosts.push(host);
  await host.load();
  return { directory, host };
}
async function enable(host: ModuleHost, id = "one") {
  return host.setEnabled({ moduleId: id, enabled: true });
}
function run(host: ModuleHost, id = "one", steps = 2) {
  return host.run({ moduleId: id, operation: "count", input: { steps } });
}
function snapshot(host: ModuleHost, id = "one") {
  return host.snapshots().find((item) => item.id === id)!;
}
async function finished(host: ModuleHost, id = "one") {
  await expect
    .poll(() => snapshot(host, id).operation?.phase)
    .not.toMatch(/^(running|cancelling)$/);
  return snapshot(host, id).operation!;
}
afterEach(async () => {
  await Promise.all(hosts.splice(0).map((host) => host.shutdown()));
  await Promise.all(
    dirs.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("module operation loop", () => {
  it("validates and bounds opt-in domain state without disrupting other module reads", async () => {
    let state: JsonValue = { label: "public", completed: 1 };
    const definition = createFoundationFixture("one");
    const start = definition.start;
    definition.state = fixtureResultSchema;
    definition.start = async (...args) => ({ ...(await start(...args)), state: () => state });
    const { host } = await fixture([definition, createFoundationFixture("two")]);
    await enable(host);
    expect(snapshot(host).state).toEqual({ label: "public", completed: 1 });
    state = { label: "public", completed: 2, secret: "PRIVATE_TOKEN" };
    expect(snapshot(host).state).toBeUndefined();
    expect(snapshot(host, "two").phase).toBe("disabled");
    definition.state = runModuleOperationSchema.shape.input;
    state = "x".repeat(1024 * 1024 + 1);
    expect(snapshot(host).state).toBeUndefined();
    expect(JSON.stringify(host.snapshots())).not.toContain("PRIVATE_TOKEN");
  });
  it("keeps normal registrations empty and creates no files merely by loading fixtures", async () => {
    expect(registeredModules(false).map((item) => item.id)).toEqual(["usage"]);
    expect(registeredModules(true, createFixtureWorker)).toHaveLength(3);
    const { host, directory } = await fixture();
    expect(await readdir(directory)).toEqual([]);
    expect(host.snapshots().map((item) => item.phase)).toEqual(["disabled", "disabled"]);
  });
  it("validates the operation whitelist, input and module availability before dispatch", async () => {
    const { host } = await fixture();
    expect(() => run(host)).toThrow("请先启用模块");
    expect(() => host.run({ moduleId: "one", operation: "__proto__", input: {} })).toThrow();
    expect(() => host.run({ moduleId: "one", operation: "unknown", input: {} })).toThrow("不支持");
    expect(() => host.run({ moduleId: "one", operation: "count", input: { steps: -1 } })).toThrow(
      "参数无效",
    );
    await expect(host.setEnabled({ moduleId: "../outside", enabled: true })).rejects.toMatchObject({
      code: "INVALID_INPUT",
    });
    await enable(host);
    expect(() =>
      host.run({ moduleId: "one", operation: "count", input: { steps: 2 }, extra: "bad" }),
    ).toThrow("参数无效");
  });
  it("publishes progress, uses dispatch-time config, and leaves another module free to save and run", async () => {
    const { host } = await fixture();
    const updates: ModuleSnapshot[] = [];
    const unsubscribe = host.subscribe((value) => updates.push(value));
    await Promise.all([enable(host), enable(host, "two")]);
    run(host, "one", 4);
    expect(() => run(host)).toThrow("尚未结束");
    await host.saveConfig({ moduleId: "one", expectedRevision: 1, value: { label: "新名称" } });
    await host.saveConfig({ moduleId: "two", expectedRevision: 1, value: { label: "独立保存" } });
    run(host, "two", 1);
    expect((await finished(host, "two")).result).toEqual({ label: "独立保存", completed: 1 });
    expect(snapshot(host).operation?.phase).toBe("running");
    expect((await finished(host)).result).toEqual({ label: "合成任务", completed: 4 });
    run(host, "one", 1);
    expect((await finished(host)).result).toEqual({ label: "新名称", completed: 1 });
    expect(
      updates.some(
        (item) =>
          item.id === "one" &&
          item.operation &&
          item.operation.progress > 0 &&
          item.operation.progress < 100,
      ),
    ).toBe(true);
    const revisions = updates.filter((item) => item.id === "one").map((item) => item.revision);
    expect(
      revisions.every((revision, index) => index === 0 || revision > revisions[index - 1]!),
    ).toBe(true);
    unsubscribe();
    const count = updates.length;
    await host.setEnabled({ moduleId: "one", enabled: false });
    expect(updates).toHaveLength(count);
  });
  it("cancels by exact task ID and permits a new task only after actual settlement", async () => {
    const { host } = await fixture();
    await enable(host);
    const started = run(host, "one", 12);
    expect(() =>
      host.cancel({ moduleId: "one", operationId: "00000000-0000-4000-8000-000000000000" }),
    ).toThrow("不存在");
    host.cancel({ moduleId: "one", operationId: started.operation!.id });
    expect(snapshot(host).operation?.phase).toBe("cancelling");
    expect(() => run(host)).toThrow("尚未结束");
    expect((await finished(host)).phase).toBe("cancelled");
    expect(snapshot(host).operation?.result).toBeNull();
    run(host, "one", 1);
    expect((await finished(host)).phase).toBe("succeeded");
    expect(() => host.cancel({ moduleId: "one", operationId: started.operation!.id })).toThrow(
      "不存在",
    );
  });
  it("stops running work on disable, releases resources, and starts a new generation", async () => {
    const { host } = await fixture();
    await enable(host);
    run(host, "one", 20);
    await delay(10);
    await host.setEnabled({ moduleId: "one", enabled: false });
    expect(snapshot(host)).toMatchObject({
      phase: "disabled",
      operation: { phase: "cancelled", result: null },
    });
    await enable(host);
    expect(snapshot(host).generation).toBe(2);
    run(host, "one", 1);
    expect((await finished(host)).generation).toBe(2);
  });
  it("persists enabled intent and independent configuration across a new host", async () => {
    const { host, directory } = await fixture();
    await enable(host);
    await host.saveConfig({ moduleId: "one", expectedRevision: 1, value: { label: "恢复名称" } });
    run(host, "one", 20);
    await host.shutdown();
    expect(snapshot(host)).toMatchObject({ phase: "disabled", config: { enabled: true } });
    expect(() => run(host)).toThrow("应用正在退出");
    const next = new ModuleHost(
      [createFoundationFixture("one"), createFoundationFixture("two")],
      directory,
    );
    hosts.push(next);
    await next.load();
    expect(snapshot(next)).toMatchObject({
      phase: "running",
      config: { value: { label: "恢复名称" } },
      operation: null,
    });
    expect(snapshot(next, "two").phase).toBe("disabled");
    run(next, "one", 1);
    expect((await finished(next)).result).toEqual({ label: "恢复名称", completed: 1 });
  });
  it("rejects stale config writes while merging unrelated fields into the latest envelope", async () => {
    const { host, directory } = await fixture();
    const results = await Promise.allSettled([
      host.saveConfig({ moduleId: "one", expectedRevision: 0, value: { label: "保留" } }),
      host.saveConfig({ moduleId: "one", expectedRevision: 0, value: { label: "过期" } }),
      enable(host),
    ]);
    expect(results.map((result) => result.status)).toEqual(["fulfilled", "rejected", "fulfilled"]);
    expect(JSON.parse(await readFile(join(directory, "one.json"), "utf8"))).toMatchObject({
      revision: 2,
      enabled: true,
      value: { label: "保留" },
    });
    await expect(
      host.saveConfig({ moduleId: "one", expectedRevision: 2, value: { label: "" } }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });
  it.each([
    ['{"schemaVersion":9}', "future-version"],
    ["damaged bytes", "invalid"],
  ])("preserves %s and explicitly recovers only that module", async (raw, health) => {
    const { directory, host } = await fixture();
    await host.shutdown();
    await writeFile(join(directory, "one.json"), raw);
    const next = new ModuleHost(
      [createFoundationFixture("one"), createFoundationFixture("two")],
      directory,
    );
    hosts.push(next);
    await next.load();
    expect(snapshot(next).config.health).toBe(health);
    await expect(enable(next)).rejects.toMatchObject({ code: "SETTINGS_UNAVAILABLE" });
    expect(await readFile(join(directory, "one.json"), "utf8")).toBe(raw);
    await enable(next, "two");
    await next.resetConfig({ moduleId: "one" });
    const backup = (await readdir(directory)).find((name) => name.startsWith("one.json.backup-"))!;
    expect(await readFile(join(directory, backup), "utf8")).toBe(raw);
    expect(snapshot(next)).toMatchObject({
      phase: "disabled",
      config: { enabled: false, health: "ok" },
    });
    expect(snapshot(next, "two").phase).toBe("running");
  });
  it("isolates unreadable module storage from other modules without replacing it", async () => {
    const { host, directory } = await fixture();
    await host.shutdown();
    await mkdir(join(directory, "one.json"));
    const next = new ModuleHost(
      [createFoundationFixture("one"), createFoundationFixture("two")],
      directory,
    );
    hosts.push(next);
    await next.load();
    expect(snapshot(next).config.health).toBe("unavailable");
    await expect(enable(next)).rejects.toMatchObject({ code: "SETTINGS_UNAVAILABLE" });
    await enable(next, "two");
    run(next, "two", 1);
    expect((await finished(next, "two")).phase).toBe("succeeded");
    expect(await readdir(join(directory, "one.json"))).toEqual([]);
  });
  it("migrates its own module schema once with backup and without changing another module", async () => {
    const { directory, host } = await fixture();
    await host.shutdown();
    const original = JSON.stringify({
      schemaVersion: 0,
      revision: 4,
      enabled: false,
      value: { name: "迁移名称" },
    });
    await writeFile(join(directory, "one.json"), original);
    for (let index = 0; index < 2; index++) {
      const next = new ModuleHost([createFoundationFixture("one")], directory);
      hosts.push(next);
      await next.load();
      expect(snapshot(next).config).toMatchObject({
        schemaVersion: 1,
        revision: 5,
        value: { label: "迁移名称" },
      });
      await next.shutdown();
    }
    const backups = (await readdir(directory)).filter((name) => name.includes("backup"));
    expect(backups).toHaveLength(1);
    expect(await readFile(join(directory, backups[0]!), "utf8")).toBe(original);
  });
  it("marks a task that ignores cancellation as unresponsive and never reports clean teardown", async () => {
    let release!: (value: { completed: number; label: string }) => void;
    let report!: (value: number) => void;
    const definition = createFoundationFixture("one");
    definition.start = async () => ({
      stop: async () => {},
      execute: async (_name, _input, context) => {
        report = context.report;
        return new Promise((resolve) => {
          release = resolve;
        });
      },
    });
    const { host } = await fixture([definition], 20);
    await enable(host);
    const task = run(host);
    await delay(1);
    host.cancel({ moduleId: "one", operationId: task.operation!.id });
    await expect.poll(() => snapshot(host).phase).toBe("error");
    expect(snapshot(host)).toMatchObject({
      error: "MODULE_STOP_FAILED",
      operation: { phase: "failed", error: "TASK_UNRESPONSIVE" },
    });
    const revision = snapshot(host).revision;
    report(99);
    release({ completed: 999, label: "迟到结果" });
    await delay(1);
    expect(snapshot(host).operation?.result).toBeNull();
    expect(snapshot(host).revision).toBe(revision);
    expect(() => run(host)).toThrow("请先启用模块");
  });
  it("handles operation timeouts and redacts thrown errors and invalid public outputs", async () => {
    const definition = createFoundationFixture("one");
    definition.operations = {
      count: { input: fixtureInputSchema, output: fixtureResultSchema, timeoutMs: 10 },
    };
    let mode = "timeout";
    definition.start = async () => ({
      stop: async () => {},
      execute: async (_name, _input, context) => {
        if (mode === "timeout") await delay(1000, undefined, { signal: context.signal });
        if (mode === "throw") throw new Error("private-token");
        return { private: "private-token" };
      },
    });
    const { host } = await fixture([definition]);
    await enable(host);
    for (mode of ["timeout", "throw", "output"]) {
      run(host);
      const task = await finished(host);
      expect(task.error).toBe(mode === "timeout" ? "TASK_TIMEOUT" : "TASK_FAILED");
      expect(JSON.stringify(host.snapshots())).not.toContain("private-token");
    }
  });
  it("serializes rapid enable/disable requests without duplicate runtimes", async () => {
    let resources = 0;
    const definition = createFoundationFixture("one");
    const start = definition.start;
    definition.start = async (signal, context) => {
      resources++;
      const runtime = await start(signal, context);
      return {
        ...runtime,
        stop: async () => {
          resources--;
          await runtime.stop();
        },
      };
    };
    const { host } = await fixture([definition]);
    await Promise.all([
      enable(host),
      host.setEnabled({ moduleId: "one", enabled: false }),
      enable(host),
    ]);
    expect(resources).toBe(1);
    expect(snapshot(host)).toMatchObject({ phase: "running", config: { enabled: true } });
    await host.shutdown();
    expect(resources).toBe(0);
  });
});
