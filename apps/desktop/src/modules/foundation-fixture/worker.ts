import { parentPort } from "node:worker_threads";
import { setTimeout } from "node:timers/promises";
import { z } from "zod";
import { fixtureConfigSchema, fixtureInputSchema } from "./contract.ts";

const port = parentPort;
if (!port) throw new Error("WORKER_PORT_REQUIRED");
const requestSchema = z.strictObject({ input: fixtureInputSchema, config: fixtureConfigSchema });

// One bounded synthetic task per worker; no accounts, files or external applications.
port.once("message", async (request: unknown) => {
  try {
    const {
      input: { steps },
      config: { label },
    } = requestSchema.parse(request);
    for (let completed = 1; completed <= steps; completed++) {
      await setTimeout(80);
      port.postMessage({ type: "progress", value: Math.round((completed / steps) * 100) });
    }
    port.postMessage({ type: "result", value: { label, completed: steps } });
  } catch {
    port.postMessage({ type: "error" });
  } finally {
    port.close();
  }
});
