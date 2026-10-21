import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createDesktopSession } from "./verify-desktop.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const directory = await mkdtemp(join(tmpdir(), "codex-coco-worker-desktop-"));
let session;
try {
  session = await createDesktopSession(
    directory,
    process.env,
    process.argv.includes("--packaged")
      ? join(root, "apps/desktop/release/mac-arm64/Codex Coco.app/Contents/MacOS/Codex Coco")
      : undefined,
  );
  // Exercise the emitted resource even in a package; do not enable fixture modules in it.
  const result = await session.application.evaluate(async ({ app }) => {
    const { Worker } = process.getBuiltinModule("node:worker_threads");
    const { join } = process.getBuiltinModule("node:path");
    const worker = new Worker(join(app.getAppPath(), "out/main/foundation-worker.js"), {
      stdout: true,
      stderr: true,
    });
    let timer;
    const progress = [];
    try {
      const value = await new Promise((resolve, reject) => {
        timer = setTimeout(() => reject(new Error("WORKER_SMOKE_TIMEOUT")), 8000);
        worker.on("error", () => reject(new Error("WORKER_SMOKE_FAILED")));
        worker.on("exit", () => reject(new Error("WORKER_SMOKE_EXITED")));
        worker.on("message", (message) => {
          if (message.type === "progress") progress.push(message.value);
          else if (message.type === "result") resolve(message.value);
          else reject(new Error("WORKER_SMOKE_MESSAGE"));
        });
        worker.postMessage({ input: { steps: 2 }, config: { label: "工作线程验收" } });
      });
      await worker.terminate();
      return { value, progress, exited: worker.threadId === -1, packaged: app.isPackaged };
    } finally {
      clearTimeout(timer);
      await worker.terminate();
    }
  });
  assert.deepEqual(result.value, { label: "工作线程验收", completed: 2 });
  assert.deepEqual(result.progress, [50, 100]);
  assert.equal(result.exited, true);
  assert.equal(result.packaged, process.argv.includes("--packaged"));
  console.log(JSON.stringify({ ok: true, ...result }, null, 2));
} finally {
  await session?.application.close();
  await rm(directory, { recursive: true, force: true });
}
