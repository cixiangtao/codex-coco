import { parentPort } from "node:worker_threads";
import { scanLocalUsage, localScanRequestSchema } from "./local-index.ts";
const port = parentPort;
if (!port) throw new Error("WORKER_PORT_REQUIRED");
port.once("message", async (input: unknown) => {
  try {
    const result = await scanLocalUsage(localScanRequestSchema.parse(input), (value) =>
      port.postMessage({ type: "progress", value }),
    );
    port.postMessage({ type: "result", value: result });
  } catch {
    port.postMessage({ type: "error" });
  } finally {
    port.close();
  }
});
