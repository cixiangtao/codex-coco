import type { BuiltinModule } from "../application/module-host";
import { createFoundationFixture } from "./foundation-fixture/runtime";
import type { WorkerFactory } from "../application/worker-task";
import { createUsageModule } from "./usage/runtime";

/** Business runtimes are registered here after the foundation and interface are accepted. */
export const moduleDefinitions: readonly BuiltinModule[] = [createUsageModule()];

/** The host chooses fixture mode explicitly; normal and packaged launches keep it off. */
export function registeredModules(
  fixtures: boolean,
  createWorker?: WorkerFactory,
): readonly BuiltinModule[] {
  if (!fixtures) return moduleDefinitions;
  if (!createWorker) throw new Error("FIXTURE_WORKER_REQUIRED");
  return [
    ...moduleDefinitions,
    createFoundationFixture(createWorker),
    createFoundationFixture(createWorker, "foundation-peer"),
  ];
}
