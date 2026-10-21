import { Worker } from "node:worker_threads";
import { createFoundationFixture as defineFixture } from "../../apps/desktop/src/modules/foundation-fixture/runtime";

/** Node 24 runs the same worker source that Electron builds as a separate entry. */
export const createFixtureWorker = () =>
  new Worker(
    new URL("../../apps/desktop/src/modules/foundation-fixture/worker.ts", import.meta.url),
    { execArgv: [], stdout: true, stderr: true },
  );
export function createFoundationFixture(id = "foundation-fixture") {
  return defineFixture(createFixtureWorker, id);
}
