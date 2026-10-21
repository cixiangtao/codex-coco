import type { SaveThemeInput, SettingsSnapshot } from "./settings";

export const channels = {
  bootstrap: "codex-coco:bootstrap",
  saveTheme: "codex-coco:save-theme",
  resetSettings: "codex-coco:reset-settings",
  settingsChanged: "codex-coco:settings-changed",
  rendererReady: "codex-coco:renderer-ready",
} as const;
export type ErrorCode =
  | "INVALID_INPUT"
  | "CONFLICT"
  | "SETTINGS_UNAVAILABLE"
  | "STORAGE_ERROR"
  | "FORBIDDEN";
export type Result<T> =
  | { ok: true; value: T }
  | { ok: false; error: { code: ErrorCode; message: string } };

/** Whitelisted bridge; never exposes raw IPC channels, events or system APIs. */
export interface DesktopBridge {
  ready(): void;
  bootstrap(): Promise<Result<SettingsSnapshot>>;
  saveTheme(input: SaveThemeInput): Promise<Result<SettingsSnapshot>>;
  resetSettings(): Promise<Result<SettingsSnapshot>>;
  onSettingsChanged(listener: (snapshot: SettingsSnapshot) => void): () => void;
}
