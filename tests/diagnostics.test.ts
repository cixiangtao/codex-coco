import { afterEach, describe, expect, it, vi } from "vitest";
import { appendFile, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DiagnosticLog } from "../apps/desktop/src/application/diagnostics";
import { ModuleHost } from "../apps/desktop/src/application/module-host";
import { createFoundationFixture } from "../apps/desktop/src/modules/foundation-fixture/runtime";

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return { ...actual, appendFile: vi.fn(actual.appendFile) };
});
const directories: string[] = [];
async function directory() {
  const value = await mkdtemp(join(tmpdir(), "codex-coco-diagnostics-"));
  directories.push(value);
  return value;
}
async function contents(path: string) {
  return (
    await Promise.all(
      (await readdir(path)).sort().map((file) => readFile(join(path, file), "utf8")),
    )
  ).join("");
}
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("bounded local diagnostics", () => {
  it("writes only allowlisted fields and never serializes raw payloads, paths or errors", async () => {
    const path = await directory();
    const log = new DiagnosticLog(path, { modules: [{ id: "fixture", operations: ["count"] }] });
    const secret = "sk-fixture-secret";
    log.record({
      event: "task.finish",
      moduleId: "fixture",
      operation: "count",
      outcome: "error",
      correlationId: "00000000-0000-4000-8000-000000000001",
      errorCode: "TASK_FAILED",
      durationMs: 12.12345,
      message: secret,
      input: { token: secret },
      path: `/private/${secret}`,
      error: new Error(secret),
    });
    log.record({
      event: "ipc.complete",
      action: secret,
      moduleId: secret,
      operation: secret,
      errorCode: secret,
      correlationId: secret,
      durationMs: Infinity,
    });
    log.record(new Error(secret));
    log.record({ event: "app.start", unknown: secret.repeat(100000) });
    await log.close();
    const text = await contents(path);
    expect(text).not.toContain(secret);
    const records = text
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(records).toHaveLength(3);
    expect(records[0]).toMatchObject({
      moduleId: "fixture",
      operation: "count",
      errorCode: "TASK_FAILED",
      durationMs: 12.123,
    });
    expect(records[1]).not.toHaveProperty("moduleId");
    expect(records[1]).not.toHaveProperty("errorCode");
    expect(log.status().dropped).toBe(1);
  });
  it("rotates by bytes, retains only configured files, and appends correctly after reopening", async () => {
    const path = await directory();
    const options = { maxFileBytes: 1024, retainedFiles: 3 };
    const log = new DiagnosticLog(path, options);
    for (let index = 0; index < 60; index++) log.record({ event: "app.ready", durationMs: index });
    await log.close();
    const next = new DiagnosticLog(path, options);
    next.record({ event: "app.shutdown", outcome: "ok" });
    await next.close();
    const files = await readdir(path);
    expect(files.sort()).toEqual(["events.1.jsonl", "events.2.jsonl", "events.jsonl"]);
    for (const file of files) {
      const info = await stat(join(path, file));
      expect(info.size).toBeLessThanOrEqual(1024);
      expect(info.mode & 0o777).toBe(0o600);
      const text = await readFile(join(path, file), "utf8");
      expect(text.endsWith("\n")).toBe(true);
      for (const line of text.trim().split("\n")) expect(() => JSON.parse(line)).not.toThrow();
    }
    expect(await contents(path)).toContain("app.shutdown");
  });
  it("enforces retention after limits change and removes an oversized owned file before writing", async () => {
    const path = await directory();
    for (let index = 0; index < 5; index++)
      await writeFile(
        join(path, index ? `events.${index}.jsonl` : "events.jsonl"),
        "x".repeat(index ? 100 : 2048),
      );
    const log = new DiagnosticLog(path, { maxFileBytes: 1024, retainedFiles: 2 });
    log.record({ event: "app.start" });
    await log.close();
    expect((await readdir(path)).sort()).toEqual(["events.1.jsonl", "events.jsonl"]);
    expect((await stat(join(path, "events.jsonl"))).size).toBeLessThanOrEqual(1024);
    expect(await readFile(join(path, "events.jsonl"), "utf8")).toContain("app.start");
  });
  it("bounds the in-memory queue under a synchronous burst and records dropped counts", async () => {
    const path = await directory();
    const log = new DiagnosticLog(path, { maxQueueRecords: 4, maxQueueBytes: 1024 });
    for (let index = 0; index < 10000; index++) log.record({ event: "app.start" });
    expect(log.status().queued).toBeLessThanOrEqual(4);
    expect(log.status().queuedBytes).toBeLessThanOrEqual(1024);
    expect(log.status().dropped).toBeGreaterThanOrEqual(9996);
    expect((await log.close()).completed).toBe(true);
    expect(log.status().queuedBytes).toBe(0);
    log.record({ event: "app.ready" });
    expect(log.status().queued).toBe(0);
  });
  it("suspends writing after an IO failure without throwing or repeated retries", async () => {
    const path = join(await directory(), "not-a-directory");
    await writeFile(path, "preserve this file");
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const log = new DiagnosticLog(path);
    log.record({ event: "app.start" });
    await log.flush();
    log.record({ event: "app.ready" });
    await log.close();
    expect(log.status()).toMatchObject({ suspended: true, failures: 1, dropped: 2, queued: 0 });
    expect(consoleError).toHaveBeenCalledExactlyOnceWith("DIAGNOSTICS_WRITE_FAILED");
    expect(await readFile(path, "utf8")).toBe("preserve this file");
  });
  it("bounds close waiting even when a write remains blocked", async () => {
    const real = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
    let release!: () => void;
    let entered!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const writing = new Promise<void>((resolve) => {
      entered = resolve;
    });
    vi.mocked(appendFile).mockImplementationOnce(async (...args) => {
      entered();
      await gate;
      await real.appendFile(...args);
    });
    const log = new DiagnosticLog(await directory());
    log.record({ event: "app.start" });
    await writing;
    expect((await log.close(5)).completed).toBe(false);
    release();
    expect((await log.flush()).completed).toBe(true);
  });
  it("correlates task events and excludes module settings, results and thrown error details", async () => {
    const path = await directory();
    const log = new DiagnosticLog(join(path, "diagnostics"), {
      modules: [{ id: "fixture", operations: ["count"] }],
    });
    const definition = createFoundationFixture("fixture");
    definition.start = async () => ({
      stop: async () => {},
      execute: async () => {
        throw new Error("private-error-content");
      },
    });
    const host = new ModuleHost([definition], join(path, "modules"), 250, log);
    try {
      await host.load();
      await host.saveConfig({
        moduleId: "fixture",
        expectedRevision: 0,
        value: { label: "private-preference-content" },
      });
      await host.setEnabled({ moduleId: "fixture", enabled: true });
      const started = host.run({ moduleId: "fixture", operation: "count", input: { steps: 1 } });
      await expect.poll(() => host.snapshots()[0]?.operation?.phase).toBe("failed");
      await host.shutdown();
      await log.close();
      const text = await contents(join(path, "diagnostics"));
      expect(text).not.toContain("private-error-content");
      expect(text).not.toContain("private-preference-content");
      const records = text
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line));
      const task = records.filter((item) => item.correlationId === started.operation!.id);
      expect(task.map((item) => item.event)).toEqual(["task.start", "task.finish"]);
      expect(task[1]).toMatchObject({ errorCode: "TASK_FAILED", outcome: "error", generation: 1 });
      expect(
        records.some((item) => item.event === "module.phase" && item.phase === "disabled"),
      ).toBe(true);
    } finally {
      await host.shutdown();
      await log.close();
    }
  });
});
