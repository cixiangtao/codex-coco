import type { BuiltinModule } from "../application/module-host";
import { createFoundationFixture } from "./foundation-fixture/runtime";

/** Business runtimes are registered here after the foundation and interface are accepted. */
export const moduleDefinitions: readonly BuiltinModule[] = [];

/** The host chooses fixture mode explicitly; normal and packaged launches keep it off. */
export function registeredModules(fixtures: boolean): readonly BuiltinModule[] {
  return fixtures
    ? [...moduleDefinitions, createFoundationFixture(), createFoundationFixture("foundation-peer")]
    : moduleDefinitions;
}
