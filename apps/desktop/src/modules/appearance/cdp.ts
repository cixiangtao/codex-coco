import { z } from "zod";
import { injectionExpression, removalExpression, verificationExpression } from "./css";

const targetSchema = z.object({
  type: z.string(),
  url: z.string().max(4096),
  webSocketDebuggerUrl: z.string().max(4096).optional(),
});
const probe = `location.href.startsWith('app://-/index.html') && !location.href.includes('avatar-overlay') && document.documentElement.dataset.codexWindowType === 'electron' && Boolean(document.querySelector('[data-app-shell-main-surface], .app-shell-main-content-viewport'))`;
/** Renderer operations are fixed at the host; no arbitrary expression or address comes from IPC. */
export class AppearanceDiscoveryError extends Error {}
export interface AppearanceConnection {
  apply(port: number, css: string, signal: AbortSignal): Promise<number>;
  remove(port: number, signal: AbortSignal): Promise<number>;
  inspect(port: number, signal: AbortSignal): Promise<number>;
  verify(port: number, signal: AbortSignal, css?: string): Promise<number>;
}
/** Rejects remote hosts, credentials, redirects and mismatched debugger ports. */
export function validateDebuggerUrl(value: string, port: number) {
  const url = new URL(value);
  if (
    url.protocol !== "ws:" ||
    url.hostname !== "127.0.0.1" ||
    Number(url.port) !== port ||
    url.username ||
    url.password ||
    !/^\/devtools\/page\/[^/]+$/.test(url.pathname) ||
    url.search ||
    url.hash
  )
    throw new Error("INVALID_TARGET");
  return url.href;
}
async function targets(port: number, signal: AbortSignal) {
  const response = await fetch(`http://127.0.0.1:${port}/json/list`, {
    signal: AbortSignal.any([signal, AbortSignal.timeout(2000)]),
    redirect: "error",
  });
  if (!response.ok || !response.body) throw new Error("NOT_CONNECTED");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 256 * 1024) throw new Error("INVALID_TARGET");
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  const list = z
    .array(targetSchema)
    .max(100)
    .parse(JSON.parse(Buffer.concat(chunks).toString()));
  const accepted = list.filter(
    (t) =>
      t.type === "page" &&
      t.url.startsWith("app://-/index.html") &&
      !t.url.includes("avatar-overlay"),
  );
  if (!accepted.length || accepted.length > 10) throw new Error("INVALID_TARGET");
  return accepted.map((t) => validateDebuggerUrl(t.webSocketDebuggerUrl ?? "", port));
}
async function evaluate(url: string, expression: string, signal: AbortSignal) {
  signal.throwIfAborted();
  const socket = new WebSocket(url);
  return await new Promise<boolean>((resolve, reject) => {
    let settled = false;
    let answer = false;
    let failure = false;
    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      answer = ok;
      failure = !ok;
      clearTimeout(timeout);
      signal.removeEventListener("abort", abort);
      socket.close();
    };
    const abort = () => finish(false);
    const timeout = setTimeout(() => finish(false), 2000);
    signal.addEventListener("abort", abort, { once: true });
    socket.addEventListener("open", () => {
      if (signal.aborted || settled) {
        socket.close();
        return;
      }
      socket.send(
        JSON.stringify({
          id: 1,
          method: "Runtime.evaluate",
          params: { expression: probe, returnByValue: true },
        }),
      );
    });
    socket.addEventListener("message", (event) => {
      if (settled || typeof event.data !== "string") return;
      if (event.data.length > 64 * 1024) {
        finish(false);
        return;
      }
      try {
        const data = JSON.parse(event.data) as {
          id?: number;
          error?: unknown;
          result?: { exceptionDetails?: unknown; result?: { value?: unknown } };
        };
        if (data.id !== 1 && data.id !== 2) return;
        if (data.error || data.result?.exceptionDetails || data.result?.result?.value !== true) {
          finish(false);
          return;
        }
        if (data.id === 1)
          socket.send(
            JSON.stringify({
              id: 2,
              method: "Runtime.evaluate",
              params: { expression, returnByValue: true },
            }),
          );
        else finish(true);
      } catch {
        finish(false);
      }
    });
    socket.addEventListener("error", () => finish(false));
    socket.addEventListener(
      "close",
      () => {
        clearTimeout(timeout);
        signal.removeEventListener("abort", abort);
        if (!settled || failure) reject(new Error("APPLY_FAILED"));
        else resolve(answer);
      },
      { once: true },
    );
    if (signal.aborted) abort();
  });
}
async function visit(port: number, expression: string, signal: AbortSignal) {
  let pages: string[];
  try {
    pages = await targets(port, signal);
  } catch (error) {
    signal.throwIfAborted();
    throw new AppearanceDiscoveryError(
      error instanceof Error && error.message === "INVALID_TARGET"
        ? "INVALID_TARGET"
        : "NOT_CONNECTED",
    );
  }
  const results = await Promise.allSettled(pages.map((url) => evaluate(url, expression, signal)));
  signal.throwIfAborted();
  if (results.some((r) => r.status === "rejected" || !r.value)) throw new Error("APPLY_FAILED");
  return pages.length;
}
export function createAppearanceConnection(): AppearanceConnection {
  return {
    apply: (port, css, signal) => visit(port, injectionExpression(css), signal),
    remove: (port, signal) => visit(port, removalExpression, signal),
    inspect: (port, signal) => visit(port, "true", signal),
    verify: (port, signal, css) => visit(port, verificationExpression(css), signal),
  };
}
