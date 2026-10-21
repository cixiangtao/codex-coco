import { setTimeout } from "node:timers/promises";
import { z } from "zod";
import type { BuiltinModule } from "../../application/module-host";
import { fixtureConfigSchema, fixtureInputSchema, fixtureResultSchema } from "./contract";

/** An explicit opt-in fixture exercising the same registration contract as future built-ins. */
export function createFoundationFixture(id = "foundation-fixture"): BuiltinModule {
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
          const { steps } = fixtureInputSchema.parse(input);
          const { label } = fixtureConfigSchema.parse(context.config);
          for (let completed = 1; completed <= steps; completed++) {
            await setTimeout(80, undefined, { signal: context.signal });
            context.signal.throwIfAborted();
            context.report(Math.round((completed / steps) * 100));
          }
          return { label, completed: steps };
        },
        stop: async () => {
          stopped = true;
        },
      };
    },
  };
}
