import type { SaveThemeInput, SettingsSnapshot } from "./settings";
import type {
  CancelModuleOperationInput,
  EnableModuleInput,
  ModuleSnapshot,
  RunModuleOperationInput,
  SaveModuleConfigInput,
} from "./modules";

export const channels = {
  bootstrap: "codex-coco:bootstrap",
  saveTheme: "codex-coco:save-theme",
  resetSettings: "codex-coco:reset-settings",
  settingsChanged: "codex-coco:settings-changed",
  rendererReady: "codex-coco:renderer-ready",
  modules: "codex-coco:modules",
  enableModule: "codex-coco:enable-module",
  saveModuleConfig: "codex-coco:save-module-config",
  resetModuleConfig: "codex-coco:reset-module-config",
  runModuleOperation: "codex-coco:run-module-operation",
  cancelModuleOperation: "codex-coco:cancel-module-operation",
  moduleChanged: "codex-coco:module-changed",
} as const;
export type ErrorCode =
  | "INVALID_INPUT"
  | "CONFLICT"
  | "SETTINGS_UNAVAILABLE"
  | "STORAGE_ERROR"
  | "FORBIDDEN"
  | "UNKNOWN_MODULE"
  | "UNKNOWN_OPERATION"
  | "MODULE_UNAVAILABLE"
  | "MODULE_BUSY";
export type Result<T> =
  | { ok: true; value: T }
  | { ok: false; error: { code: ErrorCode; message: string; correlationId?: string } };

/** Whitelisted bridge; never exposes raw IPC channels, events or system APIs. */
export interface DesktopBridge {
  ready(): void;
  modules(): Promise<Result<ModuleSnapshot[]>>;
  enableModule(input: EnableModuleInput): Promise<Result<ModuleSnapshot>>;
  saveModuleConfig(input: SaveModuleConfigInput): Promise<Result<ModuleSnapshot>>;
  resetModuleConfig(input: { moduleId: string }): Promise<Result<ModuleSnapshot>>;
  runModuleOperation(input: RunModuleOperationInput): Promise<Result<ModuleSnapshot>>;
  cancelModuleOperation(input: CancelModuleOperationInput): Promise<Result<ModuleSnapshot>>;
  onModuleChanged(listener: (snapshot: ModuleSnapshot) => void): () => void;
  bootstrap(): Promise<Result<SettingsSnapshot>>;
  saveTheme(input: SaveThemeInput): Promise<Result<SettingsSnapshot>>;
  resetSettings(): Promise<Result<SettingsSnapshot>>;
  onSettingsChanged(listener: (snapshot: SettingsSnapshot) => void): () => void;
}
