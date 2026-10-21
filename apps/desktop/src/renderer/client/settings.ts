import { useSyncExternalStore } from "react";
import type { SettingsSnapshot } from "../../contracts/settings";

let current: SettingsSnapshot;
const listeners = new Set<() => void>();
function accept(snapshot: SettingsSnapshot) {
  if (current && snapshot.settings.revision < current.settings.revision) return;
  current = snapshot;
  for (const listener of listeners) listener();
}

/** Subscribe before requesting the initial snapshot so bootstrap cannot miss a host update. */
export async function initializeSettings() {
  const unsubscribe = window.codexCoco.onSettingsChanged(accept);
  const result = await window.codexCoco.bootstrap();
  if (!result.ok) {
    unsubscribe();
    throw new Error(result.error.message);
  }
  accept(result.value);
  return unsubscribe;
}

/** One saved snapshot per renderer. Local preview drafts never enter this store. */
export function useSavedSettings() {
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
