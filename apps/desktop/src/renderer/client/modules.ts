import { useSyncExternalStore } from "react";
import type { ModuleSnapshot } from "../../contracts/modules";

let current: ModuleSnapshot[] = [];
const listeners = new Set<() => void>();

/** Host revision rejects delayed bootstrap responses and events from an older generation. */
export function acceptModuleSnapshot(snapshot: ModuleSnapshot) {
  const previous = current.find((item) => item.id === snapshot.id);
  if (
    previous &&
    (snapshot.revision <= previous.revision || snapshot.generation < previous.generation)
  )
    return;
  current = [...current.filter((item) => item.id !== snapshot.id), snapshot].sort((a, b) =>
    a.id.localeCompare(b.id),
  );
  for (const listener of listeners) listener();
}
/** Subscribe before bootstrap; a closed window relinquishes only its subscriptions. */
export async function initializeModules() {
  const unsubscribe = window.codexCoco.onModuleChanged(acceptModuleSnapshot);
  try {
    const result = await window.codexCoco.modules();
    if (!result.ok) throw new Error(result.error.message);
    for (const snapshot of result.value) acceptModuleSnapshot(snapshot);
    return unsubscribe;
  } catch (error) {
    unsubscribe();
    throw error;
  }
}
export function useModules() {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    () => current,
  );
}

/** Waits for the selected task in the existing push stream, including already received results. */
export function waitForModuleOperation(moduleId: string, operationId: string, timeoutMs = 15_000) {
  return new Promise<NonNullable<ModuleSnapshot["operation"]>>((resolve, reject) => {
    const complete = () => {
      const task = current.find((item) => item.id === moduleId)?.operation;
      if (!task || task.id !== operationId || ["running", "cancelling"].includes(task.phase))
        return;
      clearTimeout(timer);
      listeners.delete(complete);
      resolve(task);
    };
    const timer = setTimeout(() => {
      listeners.delete(complete);
      reject(new Error("TASK_WAIT_TIMEOUT"));
    }, timeoutMs);
    listeners.add(complete);
    complete();
  });
}
