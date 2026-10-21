import { parentPort } from "node:worker_threads";
import { z } from "zod";
import { readImageBytes, imageType } from "../../application/media-assets.ts";
import { decodeTrayGif } from "./gif.ts";
const port = parentPort;
if (!port) throw new Error("WORKER_PORT_REQUIRED");
port.once("message", async (input: unknown) => {
  try {
    const { path } = z.strictObject({ path: z.string().max(4096) }).parse(input);
    const bytes = await readImageBytes(path);
    if (imageType(bytes) !== "gif") throw new Error("IMAGE_INVALID");
    const value = decodeTrayGif(bytes, (value) => port.postMessage({ type: "progress", value }));
    port.postMessage({ type: "result", value });
  } catch {
    port.postMessage({ type: "error" });
  } finally {
    port.close();
  }
});
