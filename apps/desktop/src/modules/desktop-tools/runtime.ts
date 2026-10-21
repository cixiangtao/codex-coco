import type { BuiltinModule } from "../../application/module-host";
import {
  desktopToolsConfigSchema,
  desktopToolsDefaults,
  desktopToolsInputSchema,
  desktopToolsResultSchema,
  removeTrayIconSchema,
  type DesktopToolsConfig,
} from "./contract";

export interface DesktopToolsDependencies {
  login(): { supported: boolean; enabled: boolean };
  setLogin(enabled: boolean): Promise<void>;
  menuBar(
    config: DesktopToolsConfig,
    signal: AbortSignal,
    report: (value: number) => void,
  ): Promise<{ frameCount: number }>;
  resetMenuBar(): void;
  importIcon(signal: AbortSignal): Promise<{ id: string; preview: string | null } | null>;
  removeIcon(id: string): Promise<void>;
  sharing(enabled: boolean): Promise<void>;
  chooseSharedDirectory(): Promise<void>;
  revealSnapshot(): void;
}
/** System writes are explicit operations; restoring menu-bar preferences never changes login items. */
export function createDesktopToolsModule(deps: DesktopToolsDependencies): BuiltinModule {
  return {
    id: "desktop-tools",
    title: "系统与菜单栏",
    config: {
      version: 1,
      defaults: desktopToolsDefaults,
      schema: desktopToolsConfigSchema,
      migrations: {},
    },
    operations: Object.fromEntries(
      [
        "inspect-system",
        "apply-menu-bar",
        "apply-login",
        "import-tray-icon",
        "remove-tray-icon",
        "apply-sharing",
        "choose-shared-directory",
        "reveal-shared-snapshot",
      ].map((name) => [
        name,
        {
          input: name === "remove-tray-icon" ? removeTrayIconSchema : desktopToolsInputSchema,
          output: desktopToolsResultSchema,
          timeoutMs:
            name === "import-tray-icon" || name === "choose-shared-directory" ? 300_000 : 15_000,
        },
      ]),
    ),
    start: async (signal, host) => {
      signal.throwIfAborted();
      let stopped = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      let frameCount = 0;
      const restore = () => {
        clearTimeout(timer);
        if (!stopped && !signal.aborted)
          timer = setTimeout(() => {
            if (!host.requestOperation("apply-menu-bar", {})) restore();
          }, 500);
      };
      restore();
      signal.addEventListener("abort", () => clearTimeout(timer), { once: true });
      return {
        configurationChanged: () => restore(),
        execute: async (name, input, context) => {
          const config = desktopToolsConfigSchema.parse(context.config);
          let imported: string | null = null;
          let preview: string | null = null;
          try {
            if (name === "apply-menu-bar") {
              clearTimeout(timer);
              frameCount = (await deps.menuBar(config, context.signal, context.report)).frameCount;
              await deps.sharing(config.shareWidgetSnapshot);
            }
            if (name === "apply-login") await deps.setLogin(config.launchAtLogin);
            if (name === "apply-sharing") await deps.sharing(config.shareWidgetSnapshot);
            if (name === "choose-shared-directory") await deps.chooseSharedDirectory();
            if (name === "reveal-shared-snapshot") deps.revealSnapshot();
            if (name === "import-tray-icon") {
              const icon = await deps.importIcon(context.signal);
              imported = icon?.id ?? null;
              preview = icon?.preview ?? null;
            }
            if (name === "remove-tray-icon") {
              const { id } = removeTrayIconSchema.parse(input);
              if (config.iconId === id) throw new Error("ICON_IN_USE");
              await deps.removeIcon(id);
            }
            context.signal.throwIfAborted();
            const login = deps.login();
            return {
              status: "ready",
              reason: null,
              loginSupported: login.supported,
              openAtLogin: login.enabled,
              imported,
              preview,
              frameCount,
              sharing: config.shareWidgetSnapshot,
            };
          } catch {
            context.signal.throwIfAborted();
            const login = deps.login();
            return {
              status: "error",
              reason:
                name === "import-tray-icon"
                  ? "IMAGE_INVALID"
                  : name === "apply-login" && !login.supported
                    ? "SYSTEM_UNAVAILABLE"
                    : "APPLY_FAILED",
              loginSupported: login.supported,
              openAtLogin: login.enabled,
              imported: null,
              preview: null,
              frameCount,
              sharing: config.shareWidgetSnapshot,
            };
          }
        },
        stop: async () => {
          stopped = true;
          clearTimeout(timer);
          deps.resetMenuBar();
          await deps.sharing(false);
        },
      };
    },
    glance: (snapshot) => {
      const parsed = desktopToolsResultSchema.safeParse(snapshot.operation?.result);
      return {
        page: "settings",
        phase: parsed.success && parsed.data.status === "error" ? "error" : "running",
        description:
          parsed.success && parsed.data.status === "error"
            ? "系统设置操作未完成，请打开设置重试。"
            : "系统与菜单栏偏好已启用，可在设置中调整。",
      };
    },
  };
}
