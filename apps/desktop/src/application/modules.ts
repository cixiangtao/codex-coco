export type ModulePhase = "disabled" | "starting" | "running" | "stopping" | "error";
export interface ModuleStatus {
  id: string;
  phase: ModulePhase;
  generation: number;
  error: string | null;
}
export type DisposeModule = () => Promise<void>;

/** A runtime owns all its resources; start must observe abort and return its cleanup. */
export interface ModuleDefinition {
  id: string;
  start(signal: AbortSignal): Promise<DisposeModule>;
}
interface Entry {
  definition: ModuleDefinition;
  status: ModuleStatus;
  controller?: AbortController;
  pendingControllers: Set<AbortController>;
  dispose?: DisposeModule;
  queue: Promise<unknown>;
}

async function withDeadline<T>(promise: Promise<T>, timeoutMs: number) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("MODULE_TIMEOUT")), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/** Per-module serialization, bounded teardown, and isolated failures for built-in modules. */
export class ModuleManager {
  private entries = new Map<string, Entry>();
  private closed = false;
  private listeners = new Set<() => void>();
  constructor(
    definitions: readonly ModuleDefinition[],
    private readonly timeoutMs = 2500,
  ) {
    for (const definition of definitions) {
      if (this.entries.has(definition.id)) throw new Error("DUPLICATE_MODULE");
      this.entries.set(definition.id, {
        definition,
        status: { id: definition.id, phase: "disabled", generation: 0, error: null },
        queue: Promise.resolve(),
        pendingControllers: new Set(),
      });
    }
  }
  statuses() {
    return [...this.entries.values()].map((entry) => ({ ...entry.status }));
  }

  /** Observers receive transitions without acquiring ownership of runtime resources. */
  subscribe(listener: () => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
  private notify() {
    for (const listener of this.listeners) listener();
  }
  private enqueue(entry: Entry, task: () => Promise<void>) {
    const result = entry.queue.then(task).finally(() => this.notify());
    entry.queue = result.catch(() => undefined);
    return result;
  }
  private get(id: string) {
    const entry = this.entries.get(id);
    if (!entry) throw new Error("UNKNOWN_MODULE");
    return entry;
  }

  enable(id: string) {
    const entry = this.get(id);
    if (this.closed) return Promise.reject(new Error("MANAGER_CLOSED"));
    const controller = new AbortController();
    entry.pendingControllers.add(controller);
    return this.enqueue(entry, async () => {
      entry.pendingControllers.delete(controller);
      if (this.closed || controller.signal.aborted || entry.status.phase === "running") return;
      if (entry.status.phase === "error") throw new Error("MODULE_REQUIRES_CLEANUP");
      entry.status = {
        id,
        phase: "starting",
        generation: entry.status.generation + 1,
        error: null,
      };
      entry.controller = controller;
      this.notify();
      const pending = Promise.resolve()
        .then(() => entry.definition.start(controller.signal))
        .then(async (dispose) => {
          // A timed-out start may finish late. It never becomes the next generation's runtime.
          if (controller.signal.aborted) {
            await dispose();
            return undefined;
          }
          return dispose;
        });
      try {
        const dispose = await withDeadline(pending, this.timeoutMs);
        if (dispose) {
          entry.dispose = dispose;
          entry.status.phase = "running";
        } else entry.status.phase = "disabled";
      } catch (error) {
        controller.abort();
        entry.status.phase = "error";
        entry.status.error =
          error instanceof Error && error.message === "MODULE_TIMEOUT"
            ? "MODULE_TIMEOUT"
            : "MODULE_START_FAILED";
        throw new Error(entry.status.error);
      }
    });
  }

  disable(id: string) {
    const entry = this.get(id);
    entry.controller?.abort();
    for (const controller of entry.pendingControllers) controller.abort();
    return this.enqueue(entry, async () => {
      entry.controller?.abort();
      if (!entry.dispose) {
        if (entry.status.phase !== "error") entry.status.phase = "disabled";
        return;
      }
      entry.status.phase = "stopping";
      this.notify();
      try {
        await withDeadline(entry.dispose(), this.timeoutMs);
        delete entry.dispose;
        entry.status.phase = "disabled";
        entry.status.error = null;
      } catch {
        entry.status.phase = "error";
        entry.status.error = "MODULE_STOP_FAILED";
        throw new Error("MODULE_STOP_FAILED");
      }
    });
  }

  async shutdown() {
    this.closed = true;
    await Promise.allSettled([...this.entries.keys()].map((id) => this.disable(id)));
    return this.statuses();
  }
}
