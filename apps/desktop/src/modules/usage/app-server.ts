import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import { constants } from "node:fs";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";
import { z } from "zod";
import { attachUsageAccount, UsageReadError } from "./normalize";
import type { UsageFailureCode } from "./contract";

export type UsageReader = (signal: AbortSignal) => Promise<unknown>;
export interface ReaderOptions {
  /** Test/host injection only; paths and arguments never come from IPC or module configuration. */
  command?: string;
  args?: string[];
  env?: NodeJS.ProcessEnv;
  environment?(): Promise<NodeJS.ProcessEnv>;
  timeoutMs?: number;
}
const rpcSchema = z.object({
  id: z.union([z.number(), z.string().max(80)]).optional(),
  method: z.string().optional(),
  result: z.unknown().optional(),
  error: z.object({ code: z.number() }).optional(),
});
const accountSchema = z.object({
  account: z
    .object({
      type: z.string(),
      email: z.string().max(320).nullish(),
      planType: z.unknown().optional(),
    })
    .nullish(),
});
const scopes = new WeakMap<object, string>();
/** Ephemeral account correlation stays in the backend, outside the public quota response. */
export function usageAccountScope(raw: unknown) {
  return typeof raw === "object" && raw !== null ? (scopes.get(raw) ?? null) : null;
}

export async function codexCommand(environment: NodeJS.ProcessEnv, signal: AbortSignal) {
  const folders = [
    ...(environment.PATH ?? "").split(delimiter).filter(Boolean),
    join(homedir(), ".local/bin"),
    "/opt/homebrew/bin",
    "/usr/local/bin",
  ];
  for (const folder of folders) {
    signal.throwIfAborted();
    const candidate = join(folder, "codex");
    try {
      await access(candidate, constants.X_OK);
      return candidate;
    } catch {
      /* Try the next installation. */
    }
  }
  throw new UsageReadError("CLI_NOT_FOUND");
}

/** One short-lived, read-only stdio connection. It never starts threads, turns or logins. */
export function createUsageReader(options: ReaderOptions = {}): UsageReader {
  return createAppServerRequest({ method: "account/rateLimits/read" }, options);
}
export interface AppServerRequest {
  method:
    | "account/rateLimits/read"
    | "account/rateLimitResetCredit/consume"
    | "model/list"
    | "config/read"
    | "account/usage/read";
  params?: Record<string, string | boolean | number>;
  expectedScope?: string;
}
/** Host-only requests share the bounded stdio lifecycle; no method or raw parameters enter IPC. */
export function createAppServerRequest(
  request: AppServerRequest,
  options: ReaderOptions = {},
): UsageReader {
  return async (signal) => {
    signal.throwIfAborted();
    const environment = { ...(options.env ?? process.env), ...(await options.environment?.()) };
    const command = options.command ?? (await codexCommand(environment, signal));
    signal.throwIfAborted();
    const child = spawn(command, options.args ?? ["app-server"], {
      env: environment,
      cwd: homedir(),
      shell: false,
      detached: process.platform !== "win32",
      stdio: ["pipe", "pipe", "pipe"],
    });
    return new Promise((resolve, reject) => {
      let output = "";
      let bytes = 0;
      let expected = 0;
      let finished = false;
      let closed = false;
      let value: unknown;
      let accountScope: string | null = null;
      let currentAccount: z.infer<typeof accountSchema>["account"];
      let failure: UsageFailureCode | null = null;
      let force: ReturnType<typeof setTimeout> | undefined;
      const kill = (signalName: NodeJS.Signals) => {
        if (closed) return;
        try {
          if (process.platform !== "win32" && child.pid) process.kill(-child.pid, signalName);
          else child.kill(signalName);
        } catch {
          /* close remains the authoritative cleanup confirmation. */
        }
      };
      const finish = (reason: UsageFailureCode | null, result?: unknown) => {
        if (finished) return;
        finished = true;
        failure = reason;
        value = result;
        clearTimeout(deadline);
        signal.removeEventListener("abort", abort);
        child.stdin.end();
        kill("SIGTERM");
        force = setTimeout(() => kill("SIGKILL"), 250);
      };
      const abort = () => finish("READ_FAILED");
      const send = (message: unknown) => {
        if (finished) return;
        try {
          child.stdin.write(`${JSON.stringify(message)}\n`);
        } catch {
          finish("CLI_FAILED");
        }
      };
      const deadline = setTimeout(() => finish("READ_TIMEOUT"), options.timeoutMs ?? 10_000);
      child.on("error", (error: NodeJS.ErrnoException) =>
        finish(error.code === "ENOENT" ? "CLI_NOT_FOUND" : "CLI_FAILED"),
      );
      child.stdin.on("error", () => finish("CLI_FAILED"));
      child.on("close", () => {
        closed = true;
        clearTimeout(deadline);
        clearTimeout(force);
        signal.removeEventListener("abort", abort);
        if (signal.aborted) reject(new UsageReadError("READ_FAILED"));
        else if (!finished) reject(new UsageReadError("CLI_FAILED"));
        else if (failure) reject(new UsageReadError(failure));
        else resolve(value);
      });
      const budget = (size: number) => {
        bytes += size;
        if (bytes > 1024 * 1024) {
          finish("INVALID_RESPONSE");
          return false;
        }
        return !finished;
      };
      child.stderr.on("data", (chunk: Buffer) => {
        budget(chunk.length);
      });
      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => {
        if (!budget(Buffer.byteLength(chunk, "utf8"))) return;
        output += chunk;
        while (!finished && output.includes("\n")) {
          const index = output.indexOf("\n");
          const line = output.slice(0, index);
          output = output.slice(index + 1);
          if (!line.trim()) continue;
          let message: z.infer<typeof rpcSchema>;
          try {
            message = rpcSchema.parse(JSON.parse(line));
          } catch {
            finish("INVALID_RESPONSE");
            return;
          }
          if (message.method) {
            if (message.id !== undefined)
              send({ id: message.id, error: { code: -32601, message: "Unsupported request" } });
            continue;
          }
          if (message.id !== expected) continue;
          if (message.error) {
            finish(message.error.code === -32601 ? "UNSUPPORTED_CLI" : "READ_FAILED");
            continue;
          }
          if (!Object.hasOwn(message, "result")) {
            finish("INVALID_RESPONSE");
            continue;
          }
          if (expected === 0) {
            expected = 1;
            send({ method: "initialized", params: {} });
            send({ method: "account/read", id: 1, params: { refreshToken: false } });
          } else if (expected === 1) {
            const account = accountSchema.safeParse(message.result);
            if (!account.success) {
              finish("INVALID_RESPONSE");
              continue;
            }
            if (!account.data.account && !["model/list", "config/read"].includes(request.method)) {
              finish("NOT_SIGNED_IN");
              continue;
            }
            if (
              account.data.account &&
              account.data.account.type !== "chatgpt" &&
              !["model/list", "config/read"].includes(request.method)
            ) {
              finish("UNSUPPORTED_ACCOUNT");
              continue;
            }
            if (account.data.account?.email)
              accountScope = createHash("sha256")
                .update(account.data.account.email.trim().toLowerCase())
                .digest("hex");
            currentAccount = account.data.account;
            expected = 2;
            if (request.expectedScope && accountScope !== request.expectedScope) {
              finish("READ_FAILED");
              continue;
            }
            send({
              method: request.method,
              id: 2,
              ...(request.params ? { params: request.params } : {}),
            });
          } else {
            if (
              currentAccount?.type === "chatgpt" &&
              typeof message.result === "object" &&
              message.result !== null
            )
              attachUsageAccount(message.result, currentAccount.email, currentAccount.planType);
            if (accountScope && typeof message.result === "object" && message.result !== null)
              scopes.set(message.result, accountScope);
            finish(null, message.result);
          }
        }
      });
      signal.addEventListener("abort", abort, { once: true });
      if (signal.aborted) abort();
      else
        send({
          method: "initialize",
          id: 0,
          params: {
            clientInfo: { name: "codex_coco", title: "Codex Coco", version: "0.1.0" },
          },
        });
    });
  };
}
