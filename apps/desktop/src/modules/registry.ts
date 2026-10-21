import type { BuiltinModule } from "../application/module-host";
import { createFoundationFixture } from "./foundation-fixture/runtime";
import type { WorkerFactory } from "../application/worker-task";
import { createAppearanceModule, type AppearanceDependencies } from "./appearance/runtime";
import type { ResetService } from "./usage/reset";
import type { LocalUsageService } from "./usage/local-service";
import type { UsageNotifier } from "./usage/notifications";
import { createUsageModule } from "./usage/runtime";

/** Business runtimes are registered here after the foundation and interface are accepted. */
export const moduleDefinitions: readonly BuiltinModule[] = [createUsageModule()];

/** The host chooses fixture mode explicitly; normal and packaged launches keep it off. */
export function registeredModules(
  fixtures: boolean,
  createWorker?: WorkerFactory,
  appearance?: AppearanceDependencies,
  notifyUsage?: UsageNotifier,
  localUsage?: LocalUsageService,
  resetService?: ResetService,
): readonly BuiltinModule[] {
  const definitions = [
    ...(notifyUsage
      ? [createUsageModule(undefined, notifyUsage, localUsage, resetService)]
      : moduleDefinitions),
    ...(appearance ? [createAppearanceModule(appearance)] : []),
  ];
  if (!fixtures) return definitions;
  if (!createWorker) throw new Error("FIXTURE_WORKER_REQUIRED");
  return [
    ...definitions,
    createFoundationFixture(createWorker),
    createFoundationFixture(createWorker, "foundation-peer"),
  ];
}
