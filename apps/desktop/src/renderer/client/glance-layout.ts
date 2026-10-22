import { useSyncExternalStore } from "react";
import type { GlanceLayoutSnapshot } from "../../contracts/glance-layout";

let current: GlanceLayoutSnapshot | undefined;
const listeners = new Set<() => void>();
export function acceptGlanceLayout(snapshot: GlanceLayoutSnapshot) {
  if (current && current.revision > snapshot.revision) return;
  current = snapshot;
  for (const listener of listeners) listener();
}
export async function initializeGlanceLayout() {
  const off = window.codexCoco.onGlanceLayoutChanged(acceptGlanceLayout);
  const result = await window.codexCoco.glanceLayout();
  if (!result.ok) {
    off();
    throw new Error(result.error.message);
  }
  acceptGlanceLayout(result.value);
  return off;
}
export function useGlanceLayout() {
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
