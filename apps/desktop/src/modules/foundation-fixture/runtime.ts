import { z } from "zod";
import type { BuiltinModule } from "../../application/module-host";
import { runWorkerTask, type WorkerFactory } from "../../application/worker-task";
import { fixtureConfigSchema, fixtureInputSchema, fixtureResultSchema } from "./contract";

/** An explicit opt-in fixture exercising the same registration contract as future built-ins. */
export function createFoundationFixture(
  createWorker: WorkerFactory,
  id = "foundation-fixture",
): BuiltinModule {
  return {
    id,
    title: id === "foundation-fixture" ? "模块验收示例" : "独立模块示例",
    config: {
      version: 1,
      defaults: { label: "合成任务" },
      schema: fixtureConfigSchema,
      migrations: {
        0: (value) => {
          const legacy = z.strictObject({ name: z.string() }).parse(value);
          return { label: legacy.name };
        },
      },
    },
    operations: {
      count: { input: fixtureInputSchema, output: fixtureResultSchema, timeoutMs: 5000 },
    },
    start: async (moduleSignal) => {
      moduleSignal.throwIfAborted();
      let stopped = false;
      return {
        execute: async (_name, input, context) => {
          if (stopped) throw new Error("FIXTURE_STOPPED");
          return runWorkerTask(createWorker, { input, config: context.config }, context);
        },
        stop: async () => {
          stopped = true;
        },
      };
    },
  };
}
