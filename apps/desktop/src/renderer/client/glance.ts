import { useSyncExternalStore } from "react";
import type { GlanceSnapshot } from "../../contracts/glance";

interface GlanceState {
  snapshot: GlanceSnapshot | null;
  failed: boolean;
  refreshing: boolean;
}
let current: GlanceState = { snapshot: null, failed: false, refreshing: false };
const listeners = new Set<() => void>();
let refreshRequest = 0;
function emit() {
  for (const listener of listeners) listener();
}
function accept(snapshot: GlanceSnapshot) {
  if (current.snapshot && snapshot.revision < current.snapshot.revision) return;
  current = { snapshot, failed: false, refreshing: false };
  emit();
}
/** Refreshes only the host's public status projection, never a business account or network source. */
export async function refreshGlance() {
  const request = ++refreshRequest;
  const revision = current.snapshot?.revision ?? -1;
  current = { ...current, refreshing: true };
  emit();
  try {
    const result = await window.codexCoco.glance();
    if (request !== refreshRequest) return;
    if (!result.ok) throw new Error("GLANCE_UNAVAILABLE");
    accept(result.value);
  } catch {
    if (request !== refreshRequest || (current.snapshot?.revision ?? -1) > revision) return;
    current = { ...current, failed: true, refreshing: false };
    emit();
  } finally {
    if (request === refreshRequest && current.refreshing) {
      current = { ...current, refreshing: false };
      emit();
    }
  }
}
export async function initializeGlance() {
  const unsubscribe = window.codexCoco.onGlanceChanged(accept);
  await refreshGlance();
  return unsubscribe;
}
export function useGlance() {
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
