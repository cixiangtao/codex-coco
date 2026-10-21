import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { z } from "zod";
import {
  cancelModuleOperationSchema,
  enableModuleSchema,
  moduleIdSchema,
  moduleTargetSchema,
  runModuleOperationSchema,
  saveModuleConfigSchema,
  type JsonValue,
  type ModuleOperationSnapshot,
  type ModuleSnapshot,
} from "../contracts/modules";
import type { ErrorCode } from "../contracts/bridge";
import { silentDiagnostics, type DiagnosticSink } from "./diagnostics";
import { ModuleManager } from "./modules";
import { ModuleConfigStore, type ModuleConfigDefinition } from "./module-config-store";

/** Static declarations whitelist operations and validate both input and public output. */
export interface OperationDefinition {
  input: z.ZodType<JsonValue>;
  output: z.ZodType<JsonValue>;
  timeoutMs: number;
}
export interface OperationContext {
  signal: AbortSignal;
  /** Settings captured at dispatch; saved changes apply to the next operation. */
  config: JsonValue;
  report(progress: number): void;
}
export interface ModuleRuntime {
  execute(name: string, input: JsonValue, context: OperationContext): Promise<JsonValue>;
  stop(): Promise<void>;
}
/** Host-neutral built-in module. Runtime objects never cross IPC or enter React. */
export interface BuiltinModule {
  id: string;
  title: string;
  config: ModuleConfigDefinition;
  operations: Readonly<Record<string, OperationDefinition>>;
  start(signal: AbortSignal): Promise<ModuleRuntime>;
}
export class ModuleError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
  }
}
interface Task {
  snapshot: ModuleOperationSnapshot;
  controller: AbortController;
  pending: Promise<void>;
  settled: boolean;
  reason: "CANCELLED" | "TASK_TIMEOUT";
  startedAt: number;
  deadline?: ReturnType<typeof setTimeout>;
  cleanupDeadline?: ReturnType<typeof setTimeout>;
}
interface Entry {
  definition: BuiltinModule;
  config: ModuleConfigStore;
  revision: number;
  desired: boolean;
  control: Promise<unknown>;
  runtime?: ModuleRuntime;
  task?: Task;
  observedPhase: string;
  observedGeneration: number;
  phaseStartedAt: number;
}

/** Joins lifecycle, configuration and bounded tasks without module-specific gateway branches. */
export class ModuleHost {
  private entries = new Map<string, Entry>();
  private manager: ModuleManager;
  private listeners = new Set<(snapshot: ModuleSnapshot) => void>();
  private closed = false;
  constructor(
    definitions: readonly BuiltinModule[],
    directory: string,
    private readonly timeoutMs = 2500,
    private readonly diagnostics: DiagnosticSink = silentDiagnostics,
  ) {
    for (const definition of definitions) {
      moduleIdSchema.parse(definition.id);
      if (this.entries.has(definition.id)) throw new Error("DUPLICATE_MODULE");
      for (const [name, operation] of Object.entries(definition.operations)) {
        moduleIdSchema.parse(name);
        if (!Number.isFinite(operation.timeoutMs) || operation.timeoutMs <= 0)
          throw new Error("INVALID_OPERATION_TIMEOUT");
      }
      this.entries.set(definition.id, {
        definition,
        config: new ModuleConfigStore(join(directory, `${definition.id}.json`), definition.config),
        revision: 0,
        desired: false,
        control: Promise.resolve(),
        observedPhase: "disabled",
        observedGeneration: 0,
        phaseStartedAt: performance.now(),
      });
    }
    this.manager = new ModuleManager(
      definitions.map((definition) => ({
        id: definition.id,
        start: async (signal) => {
          const entry = this.get(definition.id);
          const runtime = await definition.start(signal);
          if (!signal.aborted) entry.runtime = runtime;
          const abort = () => {
            if (entry.task && !entry.task.settled) this.abortTask(entry, entry.task);
          };
          signal.addEventListener("abort", abort, { once: true });
          if (signal.aborted) abort();
          return async () => {
            signal.removeEventListener("abort", abort);
            const task = entry.task;
            if (task && !task.settled) this.abortTask(entry, task);
            // Cleanup must observe the actual task settlement, not just its timeout notification.
            await Promise.all([runtime.stop(), task?.pending]);
            if (entry.runtime === runtime) delete entry.runtime;
          };
        },
      })),
      timeoutMs,
    );
    this.manager.subscribe(() => {
      for (const entry of this.entries.values()) {
        const status = this.manager.statuses().find((item) => item.id === entry.definition.id)!;
        if (
          status.phase !== entry.observedPhase ||
          status.generation !== entry.observedGeneration
        ) {
          const now = performance.now();
          this.diagnostics.record({
            event: "module.phase",
            moduleId: status.id,
            phase: status.phase,
            generation: status.generation,
            durationMs: now - entry.phaseStartedAt,
            outcome: status.error ? "error" : "ok",
            ...(status.error ? { errorCode: status.error } : {}),
          });
          entry.observedPhase = status.phase;
          entry.observedGeneration = status.generation;
          entry.phaseStartedAt = now;
        }
        this.publish(entry);
      }
    });
  }
  private get(id: string) {
    const entry = this.entries.get(id);
    if (!entry) throw new ModuleError("UNKNOWN_MODULE", "模块未注册。");
    return entry;
  }
  private parse<T>(schema: z.ZodType<T>, input: unknown): T {
    const parsed = schema.safeParse(input);
    if (!parsed.success) throw new ModuleError("INVALID_INPUT", "模块请求参数无效。");
    return parsed.data;
  }
  private assertOpen() {
    if (this.closed) throw new ModuleError("MODULE_UNAVAILABLE", "应用正在退出，无法接受新操作。");
  }
  private snapshot(entry: Entry): ModuleSnapshot {
    const status = this.manager.statuses().find((item) => item.id === entry.definition.id)!;
    return structuredClone({
      ...status,
      title: entry.definition.title,
      revision: entry.revision,
      config: entry.config.snapshot(),
      operations: Object.keys(entry.definition.operations),
      operation: entry.task?.snapshot ?? null,
    });
  }
  snapshots() {
    return [...this.entries.values()].map((entry) => this.snapshot(entry));
  }
  subscribe(listener: (snapshot: ModuleSnapshot) => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
  private publish(entry: Entry) {
    entry.revision++;
    for (const listener of this.listeners) listener(this.snapshot(entry));
  }
  /** Loading one damaged module does not start it or prevent other modules from restoring. */
  async load() {
    await Promise.all(
      [...this.entries.values()].map(async (entry) => {
        const config = await entry.config.load();
        this.diagnostics.record({
          event: "module.config",
          moduleId: entry.definition.id,
          health: config.health,
        });
        entry.desired = config.enabled;
        this.publish(entry);
        if (config.enabled && config.health === "ok") {
          await this.manager.enable(entry.definition.id).catch(() => undefined);
        }
      }),
    );
    return this.snapshots();
  }
  private control<T>(entry: Entry, action: () => Promise<T>) {
    const result = entry.control.then(action);
    entry.control = result.catch(() => undefined);
    return result;
  }
  async setEnabled(input: unknown) {
    this.assertOpen();
    const request = this.parse(enableModuleSchema, input);
    const entry = this.get(request.moduleId);
    entry.desired = request.enabled;
    // Abort immediately, including when an earlier enable is still waiting on persistence.
    if (!request.enabled) void this.manager.disable(request.moduleId).catch(() => undefined);
    return this.control(entry, async () => {
      await entry.config.update({ enabled: request.enabled });
      this.publish(entry);
      if (!this.closed && request.enabled && entry.desired) {
        try {
          await this.manager.enable(request.moduleId);
        } catch {
          throw new ModuleError("MODULE_UNAVAILABLE", "模块未能启动，请查看模块状态。");
        }
      } else if (!request.enabled) {
        try {
          await this.manager.disable(request.moduleId);
        } catch {
          throw new ModuleError("MODULE_UNAVAILABLE", "模块资源未能完整释放。");
        }
      }
      return this.snapshot(entry);
    });
  }
  async saveConfig(input: unknown) {
    this.assertOpen();
    const request = this.parse(saveModuleConfigSchema, input);
    const entry = this.get(request.moduleId);
    await entry.config.update({ value: request.value }, request.expectedRevision);
    this.publish(entry);
    return this.snapshot(entry);
  }
  async resetConfig(input: unknown) {
    this.assertOpen();
    const entry = this.get(this.parse(moduleTargetSchema, input).moduleId);
    entry.desired = false;
    const stopping = this.manager.disable(entry.definition.id).then(
      () => true,
      () => false,
    );
    return this.control(entry, async () => {
      if (!(await stopping))
        throw new ModuleError("MODULE_UNAVAILABLE", "请先退出应用以释放模块资源。");
      if (this.snapshot(entry).phase === "error")
        throw new ModuleError("MODULE_UNAVAILABLE", "模块清理状态不确定，请退出应用后重试。");
      await entry.config.reset();
      this.publish(entry);
      return this.snapshot(entry);
    });
  }
  /** Starts one operation per module; other modules and configuration writes remain independent. */
  run(input: unknown, correlationId: string = randomUUID()) {
    this.assertOpen();
    const request = this.parse(runModuleOperationSchema, input);
    const entry = this.get(request.moduleId);
    const operation = Object.hasOwn(entry.definition.operations, request.operation)
      ? entry.definition.operations[request.operation]
      : undefined;
    if (!operation) throw new ModuleError("UNKNOWN_OPERATION", "此模块不支持该操作。");
    const parsed = this.parse(operation.input, request.input);
    const status = this.snapshot(entry);
    const runtime = entry.runtime;
    if (status.phase !== "running" || !entry.desired || !runtime)
      throw new ModuleError("MODULE_UNAVAILABLE", "请先启用模块。");
    if (entry.task && !entry.task.settled)
      throw new ModuleError("MODULE_BUSY", "模块有尚未结束的任务。");
    const task: Task = {
      snapshot: {
        id: z.uuid().parse(correlationId),
        name: request.operation,
        generation: status.generation,
        phase: "running",
        progress: 0,
        result: null,
        error: null,
      },
      controller: new AbortController(),
      pending: Promise.resolve(),
      settled: false,
      reason: "CANCELLED",
      startedAt: performance.now(),
    };
    entry.task = task;
    this.diagnostics.record({
      event: "task.start",
      moduleId: request.moduleId,
      operation: request.operation,
      correlationId: task.snapshot.id,
      generation: status.generation,
    });
    task.pending = Promise.resolve()
      .then(async () => {
        task.controller.signal.throwIfAborted();
        return operation.output.parse(
          await runtime.execute(request.operation, parsed, {
            signal: task.controller.signal,
            config: status.config.value,
            report: (progress) => {
              if (
                entry.task !== task ||
                task.snapshot.phase !== "running" ||
                task.controller.signal.aborted
              )
                return;
              if (!Number.isFinite(progress) || progress < 0 || progress > 100) return;
              task.snapshot.progress = progress;
              this.publish(entry);
            },
          }),
        );
      })
      .then(
        (result) => this.finish(entry, task, result, false),
        () => this.finish(entry, task, null, true),
      );
    task.deadline = setTimeout(
      () => this.abortTask(entry, task, "TASK_TIMEOUT"),
      operation.timeoutMs,
    );
    this.publish(entry);
    return this.snapshot(entry);
  }
  cancel(input: unknown) {
    this.assertOpen();
    const request = this.parse(cancelModuleOperationSchema, input);
    const entry = this.get(request.moduleId);
    if (!entry.task || entry.task.snapshot.id !== request.operationId)
      throw new ModuleError("UNKNOWN_OPERATION", "任务不存在或已被后续任务替换。");
    this.abortTask(entry, entry.task);
    return this.snapshot(entry);
  }
  private abortTask(entry: Entry, task: Task, reason: Task["reason"] = "CANCELLED") {
    if (task.settled || task.controller.signal.aborted) return;
    task.reason = reason;
    this.diagnostics.record({
      event: "task.cancel",
      moduleId: entry.definition.id,
      operation: task.snapshot.name,
      correlationId: task.snapshot.id,
      generation: task.snapshot.generation,
      outcome: "requested",
      ...(reason === "TASK_TIMEOUT" ? { errorCode: reason } : {}),
    });
    task.controller.abort();
    task.snapshot.phase = "cancelling";
    clearTimeout(task.deadline);
    task.cleanupDeadline = setTimeout(() => {
      if (task.settled) return;
      task.snapshot.phase = "failed";
      task.snapshot.error = "TASK_UNRESPONSIVE";
      this.diagnostics.record({
        event: "task.unresponsive",
        moduleId: entry.definition.id,
        operation: task.snapshot.name,
        correlationId: task.snapshot.id,
        generation: task.snapshot.generation,
        outcome: "error",
        errorCode: "TASK_UNRESPONSIVE",
        durationMs: performance.now() - task.startedAt,
      });
      this.publish(entry);
      void this.manager.disable(entry.definition.id).catch(() => undefined);
    }, this.timeoutMs);
    this.publish(entry);
  }
  private finish(entry: Entry, task: Task, result: JsonValue, failed: boolean) {
    task.settled = true;
    clearTimeout(task.deadline);
    clearTimeout(task.cleanupDeadline);
    if (entry.task !== task || task.snapshot.error === "TASK_UNRESPONSIVE") return;
    const cancelled = task.controller.signal.aborted;
    task.snapshot.phase = cancelled
      ? task.reason === "CANCELLED"
        ? "cancelled"
        : "failed"
      : failed
        ? "failed"
        : "succeeded";
    task.snapshot.error = cancelled
      ? task.reason === "TASK_TIMEOUT"
        ? "TASK_TIMEOUT"
        : null
      : failed
        ? "TASK_FAILED"
        : null;
    task.snapshot.result = cancelled || failed ? null : result;
    if (task.snapshot.phase === "succeeded") task.snapshot.progress = 100;
    this.diagnostics.record({
      event: "task.finish",
      moduleId: entry.definition.id,
      operation: task.snapshot.name,
      correlationId: task.snapshot.id,
      generation: task.snapshot.generation,
      outcome: task.snapshot.error ? "error" : cancelled ? "cancelled" : "ok",
      ...(task.snapshot.error ? { errorCode: task.snapshot.error } : {}),
      durationMs: performance.now() - task.startedAt,
    });
    this.publish(entry);
  }
  /** Rejects new work first, cancels tasks, then drains short config/control queues and cleanup. */
  async shutdown() {
    this.closed = true;
    const stopping = this.manager.shutdown();
    await Promise.all(
      [...this.entries.values()].map(async (entry) => {
        await entry.control;
        await entry.config.flush();
      }),
    );
    await stopping;
    return this.snapshots();
  }
}
