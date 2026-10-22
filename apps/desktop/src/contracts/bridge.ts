import type { GlanceLayoutSnapshot, SaveGlanceLayout, ReorderGlanceLayout } from "./glance-layout";
import type { UpdateSnapshot, SaveUpdatePreferences, UpdateAction } from "./updates";
import type { WindowContext, MainPage } from "./windows";
import type { GlanceSnapshot, AppearanceQuickAction } from "./glance";
import type { SaveThemeInput, SettingsSnapshot } from "./settings";
import type {
  CancelModuleOperationInput,
  EnableModuleInput,
  ModuleSnapshot,
  RunModuleOperationInput,
  SaveModuleConfigInput,
} from "./modules";

export const channels = {
  appearanceQuickAction: "codex-coco:appearance-quick-action",
  glanceLayout: "codex-coco:glance-layout",
  saveGlanceLayout: "codex-coco:save-glance-layout",
  reorderGlanceLayout: "codex-coco:reorder-glance-layout",
  resetGlanceLayout: "codex-coco:reset-glance-layout",
  glanceLayoutChanged: "codex-coco:glance-layout-changed",
  glancePreview: "codex-coco:glance-preview",
  updates: "codex-coco:updates",
  saveUpdatePreferences: "codex-coco:save-update-preferences",
  updateAction: "codex-coco:update-action",
  updatesChanged: "codex-coco:updates-changed",
  windowContext: "codex-coco:window-context",
  openMainPage: "codex-coco:open-main-page",
  dismissGlance: "codex-coco:dismiss-glance",
  navigate: "codex-coco:navigate",
  glance: "codex-coco:glance",
  glanceChanged: "codex-coco:glance-changed",
  glanceVisibilityChanged: "codex-coco:glance-visibility-changed",
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
  appearanceQuickAction(input: {
    action: AppearanceQuickAction;
  }): Promise<Result<{ outcome: "started" | "cancelled" }>>;
  glanceLayout(): Promise<Result<GlanceLayoutSnapshot>>;
  saveGlanceLayout(input: SaveGlanceLayout): Promise<Result<GlanceLayoutSnapshot>>;
  reorderGlanceLayout(input: ReorderGlanceLayout): Promise<Result<GlanceLayoutSnapshot>>;
  resetGlanceLayout(): Promise<Result<GlanceLayoutSnapshot>>;
  onGlanceLayoutChanged(listener: (snapshot: GlanceLayoutSnapshot) => void): () => void;
  glancePreview(): Promise<Result<GlanceSnapshot>>;
  updates(): Promise<Result<UpdateSnapshot>>;
  saveUpdatePreferences(input: SaveUpdatePreferences): Promise<Result<UpdateSnapshot>>;
  updateAction(input: UpdateAction): Promise<Result<UpdateSnapshot>>;
  onUpdatesChanged(listener: (snapshot: UpdateSnapshot) => void): () => void;
  windowContext(): Promise<Result<WindowContext>>;
  openMainPage(input: { page?: MainPage }): Promise<Result<void>>;
  dismissGlance(): Promise<Result<void>>;
  onNavigate(listener: (page: MainPage) => void): () => void;
  glance(): Promise<Result<GlanceSnapshot>>;
  onGlanceChanged(listener: (snapshot: GlanceSnapshot) => void): () => void;
  onGlanceVisibilityChanged(listener: (visible: boolean) => void): () => void;
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
