import { appendFile, chmod, mkdir, rename, lstat, unlink } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { channels } from "../contracts/bridge";

const events = [
  "app.start",
  "app.ready",
  "app.shutdown",
  "app.failure",
  "window.ready",
  "ipc.complete",
  "module.phase",
  "module.config",
  "task.start",
  "task.cancel",
  "task.finish",
  "task.unresponsive",
] as const;
const outcomes = ["ok", "error", "cancelled", "requested"] as const;
const codes = [
  "INVALID_INPUT",
  "CONFLICT",
  "SETTINGS_UNAVAILABLE",
  "STORAGE_ERROR",
  "FORBIDDEN",
  "UNKNOWN_MODULE",
  "UNKNOWN_OPERATION",
  "MODULE_UNAVAILABLE",
  "MODULE_BUSY",
  "MODULE_TIMEOUT",
  "MODULE_START_FAILED",
  "MODULE_STOP_FAILED",
  "TASK_FAILED",
  "TASK_TIMEOUT",
  "TASK_UNRESPONSIVE",
  "STARTUP_FAILED",
  "SHUTDOWN_FAILED",
  "RENDERER_LOAD_FAILED",
];
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Fixed metadata only. No free-form messages, paths, payloads, config values or Error objects. */
export interface DiagnosticEvent {
  event: (typeof events)[number];
  outcome?: (typeof outcomes)[number];
  correlationId?: string;
  action?: string;
  moduleId?: string;
  operation?: string;
  phase?: string;
  health?: string;
  errorCode?: string;
  generation?: number;
  durationMs?: number;
}
export interface DiagnosticSink {
  record(event: DiagnosticEvent): void;
}
export const silentDiagnostics: DiagnosticSink = { record: () => {} };
interface LogOptions {
  modules?: readonly { id: string; operations: readonly string[] }[];
  maxFileBytes?: number;
  retainedFiles?: number;
  maxQueueRecords?: number;
  maxQueueBytes?: number;
}
function isMissing(error: unknown) {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

/** Best-effort local JSONL with bounded disk retention and a bounded, non-blocking memory queue. */
export class DiagnosticLog implements DiagnosticSink {
  private readonly sessionId = randomUUID();
  private readonly modules: Map<string, ReadonlySet<string>>;
  private readonly maxFileBytes: number;
  private readonly retainedFiles: number;
  private readonly maxQueueRecords: number;
  private readonly maxQueueBytes: number;
  private readonly maxRecordBytes = 1024;
  private queue: string[] = [];
  private queuedBytes = 0;
  private dropped = 0;
  private failures = 0;
  private bytes = 0;
  private initialized = false;
  private accepting = true;
  private suspended = false;
  private draining: Promise<void> | undefined;
  constructor(
    private readonly directory: string,
    options: LogOptions = {},
  ) {
    this.modules = new Map(options.modules?.map((item) => [item.id, new Set(item.operations)]));
    this.maxFileBytes = options.maxFileBytes ?? 256 * 1024;
    this.retainedFiles = options.retainedFiles ?? 3;
    this.maxQueueRecords = options.maxQueueRecords ?? 256;
    this.maxQueueBytes = options.maxQueueBytes ?? 128 * 1024;
    if (
      !Number.isSafeInteger(this.maxFileBytes) ||
      this.maxFileBytes < this.maxRecordBytes ||
      !Number.isSafeInteger(this.retainedFiles) ||
      this.retainedFiles < 1 ||
      this.retainedFiles > 10 ||
      !Number.isSafeInteger(this.maxQueueRecords) ||
      this.maxQueueRecords < 1 ||
      !Number.isSafeInteger(this.maxQueueBytes) ||
      this.maxQueueBytes < this.maxRecordBytes
    )
      throw new Error("INVALID_DIAGNOSTIC_LIMITS");
  }
  /** Runtime sanitization also strips extra fields accidentally supplied by JavaScript callers. */
  record(event: unknown) {
    if (!this.accepting || this.suspended) {
      this.dropped++;
      return;
    }
    let line: string | null;
    try {
      line = this.serialize(event);
    } catch {
      line = null;
    }
    if (!line || Buffer.byteLength(line) > this.maxRecordBytes) {
      this.dropped++;
      return;
    }
    const bytes = Buffer.byteLength(line);
    if (
      this.queue.length >= this.maxQueueRecords ||
      this.queuedBytes + bytes > this.maxQueueBytes
    ) {
      this.dropped++;
      return;
    }
    this.queue.push(line);
    this.queuedBytes += bytes;
    this.schedule();
  }
  private schedule() {
    if (!this.draining && this.queue.length && !this.suspended) {
      this.draining = Promise.resolve()
        .then(() => this.drain())
        .finally(() => {
          this.draining = undefined;
          this.schedule();
        });
    }
  }
  private serialize(event: unknown) {
    if (event === null || typeof event !== "object") return null;
    const input: Record<string, unknown> = Object.fromEntries(
      [
        "event",
        "outcome",
        "correlationId",
        "action",
        "moduleId",
        "operation",
        "phase",
        "health",
        "errorCode",
        "generation",
        "durationMs",
      ].map((key) => [key, Reflect.get(event, key)]),
    );
    if (typeof input.event !== "string" || !events.some((name) => name === input.event))
      return null;
    const value: Record<string, string | number> = {
      schemaVersion: 1,
      timestamp: new Date().toISOString(),
      sessionId: this.sessionId,
      event: input.event,
    };
    const pick = (field: string, allowed: readonly string[]) => {
      const item = input[field];
      if (typeof item === "string" && allowed.includes(item)) value[field] = item;
    };
    pick("outcome", outcomes);
    pick("action", Object.values(channels));
    pick("errorCode", codes);
    pick("phase", ["disabled", "starting", "running", "stopping", "error"]);
    pick("health", ["ok", "missing", "invalid", "future-version", "unavailable"]);
    if (typeof input.correlationId === "string" && uuid.test(input.correlationId))
      value.correlationId = input.correlationId;
    if (typeof input.moduleId === "string" && this.modules.has(input.moduleId)) {
      value.moduleId = input.moduleId;
      if (
        typeof input.operation === "string" &&
        this.modules.get(input.moduleId)?.has(input.operation)
      )
        value.operation = input.operation;
    }
    for (const field of ["generation", "durationMs"]) {
      const number = input[field];
      if (
        typeof number === "number" &&
        Number.isFinite(number) &&
        number >= 0 &&
        number <= 86_400_000
      )
        value[field] =
          field === "generation" ? Math.floor(number) : Math.round(number * 1000) / 1000;
    }
    value.level =
      value.outcome === "error" || value.errorCode
        ? "error"
        : ["invalid", "future-version", "unavailable"].includes(String(value.health))
          ? "warn"
          : "info";
    return `${JSON.stringify(value)}\n`;
  }
  status() {
    return {
      queued: this.queue.length,
      queuedBytes: this.queuedBytes,
      dropped: this.dropped,
      failures: this.failures,
      suspended: this.suspended,
    };
  }
  private file(index: number) {
    return join(this.directory, index === 0 ? "events.jsonl" : `events.${index}.jsonl`);
  }
  private async remove(index: number) {
    await unlink(this.file(index)).catch((error: unknown) => {
      if (!isMissing(error)) throw error;
    });
  }
  private async initialize() {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    for (let index = this.retainedFiles; index < 10; index++) await this.remove(index);
    for (let index = 0; index < this.retainedFiles; index++) {
      try {
        const info = await lstat(this.file(index));
        if (!info.isFile()) throw new Error("DIAGNOSTIC_NOT_FILE");
        if (info.size > this.maxFileBytes) await this.remove(index);
        else {
          await chmod(this.file(index), 0o600);
          if (index === 0) this.bytes = info.size;
        }
      } catch (error) {
        if (!isMissing(error)) throw error;
      }
    }
    this.initialized = true;
  }
  private async rotate() {
    await this.remove(this.retainedFiles - 1);
    for (let index = this.retainedFiles - 2; index >= 0; index--) {
      await rename(this.file(index), this.file(index + 1)).catch((error: unknown) => {
        if (!isMissing(error)) throw error;
      });
    }
    this.bytes = 0;
  }
  private async drain() {
    try {
      if (!this.initialized) await this.initialize();
      while (this.queue.length) {
        const line = this.queue[0]!;
        const bytes = Buffer.byteLength(line);
        if (this.bytes + bytes > this.maxFileBytes) await this.rotate();
        await appendFile(this.file(0), line, { mode: 0o600 });
        this.bytes += bytes;
        this.queue.shift();
        this.queuedBytes -= bytes;
      }
    } catch {
      this.failures++;
      this.suspended = true;
      this.dropped += this.queue.length;
      this.queue = [];
      this.queuedBytes = 0;
      console.error("DIAGNOSTICS_WRITE_FAILED");
    }
  }
  /** Drains application writes, with a bounded wait; this is not a filesystem fsync guarantee. */
  async flush(timeoutMs = 1000) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const completed = await Promise.race([
        (async () => {
          while (this.draining) await this.draining;
          return true;
        })(),
        new Promise<boolean>((resolve) => {
          timer = setTimeout(() => resolve(false), timeoutMs);
        }),
      ]);
      return { completed, ...this.status() };
    } finally {
      clearTimeout(timer);
    }
  }
  /** Stops accepting events before the final bounded drain. */
  close(timeoutMs = 1000) {
    this.accepting = false;
    return this.flush(timeoutMs);
  }
}
