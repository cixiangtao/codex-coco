import {
  createContext,
  useContext,
  useLayoutEffect,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import type { ResolvedMode, ThemePreference } from "./contract";
import { resolveTheme } from "./resolve";

function subscribeSystem(listener: () => void) {
  const query = window.matchMedia("(prefers-color-scheme: dark)");
  query.addEventListener("change", listener);
  return () => query.removeEventListener("change", listener);
}
const getSystemDark = () => window.matchMedia("(prefers-color-scheme: dark)").matches;
const getServerDark = () => false;
const ThemeContext = createContext<ResolvedMode | null>(null);

/** Applies a validated preference to a supplied root without choosing a storage backend. */
export function applyTheme(root: HTMLElement, preference: ThemePreference, mode: ResolvedMode) {
  for (const [key, value] of Object.entries(resolveTheme(preference, mode))) {
    root.style.setProperty(`--${key}`, value);
  }
  root.dataset.theme = mode;
  root.classList.toggle("dark", mode === "dark");
  root.style.colorScheme = mode;
}

/** Controlled document-root provider. Portals into body inherit the same semantic tokens. */
export function ThemeProvider({
  preference,
  children,
}: {
  preference: ThemePreference;
  children: ReactNode;
}) {
  const systemDark = useSyncExternalStore(subscribeSystem, getSystemDark, getServerDark);
  const mode = preference.mode === "system" ? (systemDark ? "dark" : "light") : preference.mode;
  useLayoutEffect(() => applyTheme(document.documentElement, preference, mode), [preference, mode]);
  return <ThemeContext value={mode}>{children}</ThemeContext>;
}

/** Returns the effective mode; call only beneath ThemeProvider. */
export function useResolvedTheme() {
  const mode = useContext(ThemeContext);
  if (mode === null) throw new Error("ThemeProvider is required");
  return mode;
}
