import { Worker } from "node:worker_threads";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runWorkerTask } from "../apps/desktop/src/application/worker-task";
import { ModuleHost } from "../apps/desktop/src/application/module-host";
import { createFoundationFixture } from "../apps/desktop/src/modules/foundation-fixture/runtime";

const workers: Worker[] = [];
function createWorker(body: string) {
  const worker = new Worker(
    `const { parentPort } = require('node:worker_threads');
     parentPort.once('message', request => { ${body} });`,
    { eval: true, execArgv: [], stdout: true, stderr: true },
  );
  workers.push(worker);
  return worker;
}
function context(signal = new AbortController().signal) {
  return { signal, report: vi.fn<(progress: number) => void>() };
}
afterEach(async () => {
  await Promise.all(workers.splice(0).map((worker) => worker.terminate()));
});

describe("isolated worker tasks", () => {
  it("publishes validated progress and terminates lingering handles before resolving", async () => {
    const worker = createWorker(`
      setInterval(() => {}, 1000);
      parentPort.postMessage({ type: 'progress', value: 25 });
      parentPort.postMessage({ type: 'result', value: request });
      parentPort.postMessage({ type: 'progress', value: 99 });
    `);
    const execution = context();
    expect(await runWorkerTask(() => worker, { completed: 4 }, execution)).toEqual({
      completed: 4,
    });
    expect(execution.report.mock.calls).toEqual([[25]]);
    expect(worker.threadId).toBe(-1);
    expect(worker.listenerCount("message")).toBe(0);
    expect(worker.listenerCount("error")).toBe(0);
  });

  it.each([
    ["throw new Error('private-token')", "WORKER_FAILED"],
    ["parentPort.postMessage({ type: 'error' })", "WORKER_FAILED"],
    [
      "parentPort.postMessage({ type: 'error', secret: 'private-token' })",
      "WORKER_INVALID_MESSAGE",
    ],
    ["parentPort.postMessage({ type: 'progress', value: NaN })", "WORKER_INVALID_MESSAGE"],
    [
      "const value = {}; value.self = value; parentPort.postMessage({ type: 'result', value })",
      "WORKER_INVALID_MESSAGE",
    ],
    ["process.exit(0)", "WORKER_EXITED_WITHOUT_RESULT"],
    ["process.exit(7)", "WORKER_EXITED_WITHOUT_RESULT"],
    ["parentPort.postMessage({ type: 'result', value: 1n })", "WORKER_INVALID_MESSAGE"],
    ["parentPort.postMessage({ type: 'result', value: new Date() })", "WORKER_INVALID_MESSAGE"],
    [
      "parentPort.postMessage({ type: 'result', value: 'x'.repeat(1024 * 1024) })",
      "WORKER_INVALID_MESSAGE",
    ],
  ])("contains worker failure without returning raw data: %s", async (body, code) => {
    const worker = createWorker(body);
    const error = await runWorkerTask(() => worker, null, context()).catch(
      (failure: unknown) => failure,
    );
    expect(error).toMatchObject({ message: code });
    expect(String(error)).not.toContain("private-token");
    expect(worker.threadId).toBe(-1);
  });

  it("rejects an already cancelled task without creating a worker", async () => {
    const controller = new AbortController();
    controller.abort();
    const factory = vi.fn(() => createWorker("while (true) {}"));
    await expect(runWorkerTask(factory, null, context(controller.signal))).rejects.toThrow();
    expect(factory).not.toHaveBeenCalled();
  });

  it("cancels a CPU-blocked worker while keeping the caller event loop responsive", async () => {
    const controller = new AbortController();
    const worker = createWorker(
      "parentPort.postMessage({ type: 'progress', value: 1 }); while (true) {}",
    );
    const execution = context(controller.signal);
    const pending = runWorkerTask(() => worker, null, execution);
    const rejected = expect(pending).rejects.toThrow("WORKER_CANCELLED");
    await expect.poll(() => execution.report.mock.calls.length).toBe(1);
    let heartbeat = false;
    await delay(5).then(() => {
      heartbeat = true;
    });
    expect(heartbeat).toBe(true);
    controller.abort();
    await rejected;
    expect(worker.threadId).toBe(-1);
  });

  it("keeps unrelated workers independent and cleans up a throwing observer", async () => {
    const controller = new AbortController();
    const blocked = createWorker("while (true) {}");
    const pending = runWorkerTask(() => blocked, null, context(controller.signal));
    const cancelled = expect(pending).rejects.toThrow("WORKER_CANCELLED");
    const peer = createWorker("parentPort.postMessage({ type: 'result', value: 'peer' })");
    expect(await runWorkerTask(() => peer, null, context())).toBe("peer");
    expect(blocked.threadId).toBeGreaterThan(0);
    controller.abort();
    await cancelled;
    const observed = createWorker(
      "parentPort.postMessage({ type: 'progress', value: 10 }); while (true) {}",
    );
    await expect(
      runWorkerTask(() => observed, null, {
        signal: new AbortController().signal,
        report: () => {
          throw new Error("private-token");
        },
      }),
    ).rejects.toThrow("WORKER_FAILED");
    expect(observed.threadId).toBe(-1);
  });

  it("sanitizes worker creation failures", async () => {
    await expect(
      runWorkerTask(
        () => {
          throw new Error("private-token");
        },
        null,
        context(),
      ),
    ).rejects.toThrow("WORKER_START_FAILED");
  });

  it("does not report settlement when termination fails before the worker exits", async () => {
    const worker = createWorker("while (true) {}");
    const terminate = worker.terminate.bind(worker);
    const failedTermination = vi
      .spyOn(worker, "terminate")
      .mockRejectedValueOnce(new Error("private-token"));
    const controller = new AbortController();
    let settled = false;
    const pending = runWorkerTask(() => worker, null, context(controller.signal)).finally(() => {
      settled = true;
    });
    const rejected = expect(pending).rejects.toThrow("WORKER_CLEANUP_FAILED");
    controller.abort();
    await delay(5);
    expect(settled).toBe(false);
    expect(worker.threadId).toBeGreaterThan(0);
    await terminate();
    await rejected;
    failedTermination.mockRestore();
    expect(worker.threadId).toBe(-1);
  });

  it("routes host timeout, module disable and shutdown through actual thread termination", async () => {
    const directory = await mkdtemp(join(tmpdir(), "codex-coco-worker-host-"));
    const definition = createFoundationFixture(() => createWorker("while (true) {}"), "blocked");
    definition.operations = { count: { ...definition.operations.count!, timeoutMs: 100 } };
    const host = new ModuleHost([definition], directory, 500);
    try {
      await host.load();
      await host.setEnabled({ moduleId: "blocked", enabled: true });
      const run = () => host.run({ moduleId: "blocked", operation: "count", input: { steps: 1 } });
      run();
      await expect.poll(() => host.snapshots()[0]!.operation?.error).toBe("TASK_TIMEOUT");
      expect(workers.at(-1)!.threadId).toBe(-1);
      expect(host.snapshots()[0]!.phase).toBe("running");
      run();
      await expect.poll(() => workers.at(-1)!.threadId).toBeGreaterThan(0);
      await host.setEnabled({ moduleId: "blocked", enabled: false });
      expect(host.snapshots()[0]!.operation?.phase).toBe("cancelled");
      expect(workers.at(-1)!.threadId).toBe(-1);
      await host.setEnabled({ moduleId: "blocked", enabled: true });
      run();
      await expect.poll(() => workers.at(-1)!.threadId).toBeGreaterThan(0);
      await host.shutdown();
      expect(workers.at(-1)!.threadId).toBe(-1);
      expect(host.snapshots()[0]!.phase).toBe("disabled");
    } finally {
      await host.shutdown();
      await rm(directory, { recursive: true, force: true });
    }
  });
});
