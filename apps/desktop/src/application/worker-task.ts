import type { Worker } from "node:worker_threads";
import { z } from "zod";
import type { JsonValue } from "../contracts/modules";

const messageSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("progress"), value: z.number().min(0).max(100) }),
  z.strictObject({ type: z.literal("result"), value: z.json() }),
  z.strictObject({ type: z.literal("error") }),
]);

/** Factories are supplied by trusted host code, never by IPC or user configuration. */
export type WorkerFactory = () => Worker;

/**
 * Runs one task per worker and settles only after the worker has actually exited.
 * Cancellation terminates even a blocked worker; no fallback runs work on the main thread.
 * The caller validates the module-specific result before publishing it.
 */
export async function runWorkerTask(
  createWorker: WorkerFactory,
  request: JsonValue,
  context: { signal: AbortSignal; report(progress: number): void },
): Promise<JsonValue> {
  context.signal.throwIfAborted();
  let worker: Worker;
  try {
    worker = createWorker();
  } catch {
    throw new Error("WORKER_START_FAILED");
  }
  return new Promise((resolve, reject) => {
    let finishing = false;
    let confirmExit!: () => void;
    const exit = new Promise<void>((done) => {
      confirmExit = done;
    });
    const finish = async (error: string | null, result: JsonValue = null) => {
      if (finishing) return;
      finishing = true;
      context.signal.removeEventListener("abort", abort);
      try {
        await worker.terminate();
      } catch {
        error = "WORKER_CLEANUP_FAILED";
        // If termination itself fails, the host must keep waiting and apply its cleanup deadline.
        await exit;
      } finally {
        worker.off("message", message);
        worker.off("messageerror", messageError);
        worker.off("error", failed);
        worker.off("exit", exited);
      }
      if (error) reject(new Error(error));
      else if (context.signal.aborted) reject(new Error("WORKER_CANCELLED"));
      else resolve(result);
    };
    const abort = () => {
      void finish("WORKER_CANCELLED");
    };
    const failed = () => {
      void finish("WORKER_FAILED");
    };
    const exited = () => {
      confirmExit();
      void finish("WORKER_EXITED_WITHOUT_RESULT");
    };
    const messageError = () => {
      void finish("WORKER_INVALID_MESSAGE");
    };
    const message = (raw: unknown) => {
      if (finishing) return;
      let parsed: ReturnType<typeof messageSchema.safeParse>;
      try {
        // Structured clone allows cycles; our JSON protocol deliberately does not.
        if (Buffer.byteLength(JSON.stringify(raw), "utf8") > 1024 * 1024) return messageError();
        parsed = messageSchema.safeParse(raw);
      } catch {
        return messageError();
      }
      if (!parsed.success) return messageError();
      switch (parsed.data.type) {
        case "progress":
          try {
            context.report(parsed.data.value);
          } catch {
            failed();
          }
          break;
        case "result":
          void finish(null, parsed.data.value);
          break;
        case "error":
          failed();
      }
    };
    worker.on("message", message);
    worker.on("messageerror", messageError);
    worker.on("error", failed);
    worker.on("exit", exited);
    context.signal.addEventListener("abort", abort, { once: true });
    if (context.signal.aborted) return abort();
    try {
      worker.postMessage(request);
    } catch {
      messageError();
    }
  });
}
