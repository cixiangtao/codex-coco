import type { AppearanceLauncher } from "./launcher";
import type { GalleryItem, AppearanceFailure } from "./contract";
import type { BuiltinModule } from "../../application/module-host";
import { AppearanceAssets } from "./assets";
import {
  createAppearanceConnection,
  AppearanceDiscoveryError,
  type AppearanceConnection,
} from "./cdp";
import { buildAppearanceCss } from "./css";
import {
  appearanceConfigSchema,
  appearanceDefaults,
  appearanceResultSchema,
  emptyAppearanceInput,
  assetInputSchema,
  appearanceFailureSchema,
  appearanceFailures,
  type AppearanceResult,
  type AppearanceConfig,
} from "./contract";

export interface AppearanceDependencies {
  directory: string;
  pickImage(): Promise<string | null>;
  thumbnail?(id: string): Promise<string | null>;
  connection?: AppearanceConnection;
  launcher?: AppearanceLauncher;
  gallery?: {
    list(signal: AbortSignal): Promise<GalleryItem[]>;
    remove(id: string): Promise<void>;
  };
}
/** Owns only Codex Coco styles. Enabling never launches, restarts or modifies another app. */
export function createAppearanceModule(dependencies: AppearanceDependencies): BuiltinModule {
  const assets = new AppearanceAssets(dependencies.directory);
  const connection = dependencies.connection ?? createAppearanceConnection();
  return {
    id: "appearance",
    title: "外观",
    config: {
      version: 2,
      defaults: appearanceDefaults,
      schema: appearanceConfigSchema,
      migrations: { 1: (value) => appearanceConfigSchema.parse(value) },
    },
    state: appearanceResultSchema.nullable(),
    operations: Object.fromEntries(
      [
        "inspect",
        "apply",
        "sync",
        "verify",
        "remove",
        "import-image",
        "preview-image",
        "list-gallery",
        "remove-image",
        "choose-application",
        "launch-application",
        "restart-application",
      ].map((name) => [
        name,
        {
          input: ["preview-image", "remove-image"].includes(name)
            ? assetInputSchema
            : emptyAppearanceInput,
          output: appearanceResultSchema,
          timeoutMs: ["choose-application", "import-image"].includes(name)
            ? 300_000
            : ["launch-application", "restart-application"].includes(name)
              ? 60_000
              : 30_000,
        },
      ]),
    ),
    start: async (signal, host) => {
      signal.throwIfAborted();
      let stopped = false;
      let active = false;
      let syncing = false;
      let port: number | null = null;
      let count = 0;
      let cssCache = { key: "", css: "" };
      let failures = 0;
      let selected = false;
      let gallery: GalleryItem[] = [];
      let restoring = appearanceConfigSchema.parse(host.configuration()).restoreOnEnable;
      let appliedConfig: AppearanceConfig | null = restoring
        ? appearanceConfigSchema.parse(host.configuration())
        : null;
      let timer: ReturnType<typeof setTimeout> | undefined;
      let published: AppearanceResult | null = null;
      let connectionFailure: AppearanceFailure | null = null;
      let currentOperation = "";
      const result = (extra: Partial<AppearanceResult> = {}): AppearanceResult => {
        const next: AppearanceResult = {
          status: "ready",
          active,
          targets: count,
          checkedAt: Date.now(),
          reason: null,
          imported: null,
          preview: null,
          appSelected: selected,
          connectedPort: port,
          gallery,
          ...extra,
        };
        if (["apply", "sync", "verify", "remove"].includes(currentOperation))
          connectionFailure = next.reason;
        published = {
          ...next,
          imported: null,
          preview: null,
          ...(connectionFailure ? { status: "error", reason: connectionFailure } : {}),
        };
        return next;
      };
      const schedule = () => {
        clearTimeout(timer);
        if (!stopped && (active || restoring || syncing) && !signal.aborted)
          timer = setTimeout(
            () => {
              if (!host.requestOperation("sync", {})) schedule();
            },
            Math.min(60_000, 3000 * 2 ** Math.min(failures, 5)),
          );
      };
      const remove = async (cleanup: AbortSignal) => {
        active = false;
        syncing = false;
        clearTimeout(timer);
        if (port !== null) {
          await connection.remove(port, cleanup);
          port = null;
          appliedConfig = null;
          count = 0;
        }
      };
      signal.addEventListener(
        "abort",
        () => {
          active = false;
          clearTimeout(timer);
        },
        { once: true },
      );
      schedule();
      return {
        state: () => published,
        configurationChanged: (value) => {
          if (!appearanceConfigSchema.parse(value).restoreOnEnable) restoring = false;
          schedule();
        },
        execute: async (name, input, context) => {
          currentOperation = name;
          const config =
            name === "sync" && appliedConfig
              ? appliedConfig
              : appearanceConfigSchema.parse(context.config);
          let imported: string | null = null;
          const previousPort = port;
          const launching = name === "launch-application" || name === "restart-application";
          try {
            if (dependencies.launcher) selected = await dependencies.launcher.selected();
            if (name === "list-gallery") {
              gallery = (await dependencies.gallery?.list(context.signal)) ?? [];
              return result();
            }
            if (name === "remove-image") {
              const id = assetInputSchema.parse(input).id;
              if (
                [config, ...config.presets.map((p) => p.look)].some((look) =>
                  [look.wallpaper.image, look.main.image, look.sidebar.image].includes(id),
                )
              )
                throw new Error("IMAGE_IN_USE");
              await dependencies.gallery?.remove(id);
              gallery = gallery.filter((item) => item.id !== id);
              return result();
            }
            if (name === "choose-application") {
              if (port !== null) throw new Error("REMOVE_FIRST");
              if (!dependencies.launcher) throw new Error("LAUNCH_FAILED");
              await dependencies.launcher.choose(context.signal);
              selected = await dependencies.launcher.selected();
              return result();
            }
            if (launching) {
              if (!dependencies.launcher) throw new Error("LAUNCH_FAILED");
              const launched = await dependencies.launcher.launch(
                config,
                name === "restart-application",
                context.signal,
              );
              // Only a successful native launch supersedes the old process and its styles.
              // A refused launch or quit must leave an existing applied scene intact.
              active = false;
              syncing = false;
              clearTimeout(timer);
              port = null;
              appliedConfig = null;
              count = 0;
              const until = Date.now() + 30_000;
              while (true) {
                try {
                  count = await connection.inspect(launched, context.signal);
                  break;
                } catch {
                  context.signal.throwIfAborted();
                  if (Date.now() > until) throw new Error("NOT_CONNECTED");
                  await new Promise((resolve) => setTimeout(resolve, 200));
                }
              }
              return result({ connectedPort: launched });
            }
            if (name === "import-image") {
              const path = await dependencies.pickImage();
              context.signal.throwIfAborted();
              if (!path) return result();
              imported = await assets.import(path);
              context.signal.throwIfAborted();
              await assets.bytes(imported);
              const preview = (await dependencies.thumbnail?.(imported)) ?? null;
              if (dependencies.thumbnail && !preview) throw new Error("IMAGE_INVALID");
              return result({ imported, preview });
            }
            if (name === "preview-image") {
              imported = assetInputSchema.parse(input).id;
              await assets.bytes(imported);
              const preview = (await dependencies.thumbnail?.(imported)) ?? null;
              if (dependencies.thumbnail && !preview) throw new Error("IMAGE_INVALID");
              return result({ imported, preview });
            }
            const targetPort = (await dependencies.launcher?.port(config)) ?? config.port;
            if (name === "inspect") {
              const targets = await connection.inspect(targetPort, context.signal);
              return result({ targets, connectedPort: targetPort });
            }
            if (name === "remove") {
              if (port === null) port = targetPort; // Explicit recovery can remove a surviving style from an earlier run.
              restoring = false;
              await remove(context.signal);
              return result();
            }
            if (port !== null && port !== targetPort) throw new Error("REMOVE_FIRST");
            if (name === "verify") {
              count = await connection.verify(
                targetPort,
                context.signal,
                cssCache.css || undefined,
              );
              active = port !== null && appliedConfig !== null;
              return result();
            }
            if (!config.wallpaper.enabled && !config.main.enabled && !config.sidebar.enabled) {
              restoring = false;
              await remove(context.signal);
              return result();
            }
            const key = JSON.stringify([config.wallpaper, config.main, config.sidebar]);
            if (cssCache.key !== key)
              cssCache = { key, css: await buildAppearanceCss(config, assets) };
            const css = cssCache.css;
            if (name === "sync" && active) {
              try {
                count = await connection.verify(targetPort, context.signal, css);
                failures = 0;
                return result();
              } catch {
                context.signal.throwIfAborted();
              }
            }
            context.signal.throwIfAborted();
            port = targetPort; // Retain ownership even if only some windows accept the style.
            appliedConfig = config;
            syncing = true;
            count = await connection.apply(port, css, context.signal);
            count = await connection.verify(port, context.signal, css);
            active = true;
            failures = 0;
            return result();
          } catch (error) {
            failures++;
            if (["apply", "sync", "verify"].includes(name)) active = false;
            if (error instanceof AppearanceDiscoveryError && previousPort === null) port = null;
            if (context.signal.aborted && port !== null && !launching)
              await remove(AbortSignal.timeout(2000));
            context.signal.throwIfAborted();
            const code = appearanceFailureSchema.safeParse(
              error instanceof Error ? error.message : "",
            );
            return result({
              status: "error",
              reason:
                name === "remove"
                  ? "RESTORE_FAILED"
                  : name === "import-image"
                    ? "IMAGE_INVALID"
                    : code.success
                      ? code.data
                      : launching
                        ? "LAUNCH_FAILED"
                        : "APPLY_FAILED",
            });
          } finally {
            schedule();
          }
        },
        stop: async () => {
          stopped = true;
          restoring = false;
          await remove(AbortSignal.timeout(2000));
        },
      };
    },
    glance: (snapshot) => {
      const parsed = appearanceResultSchema.safeParse(snapshot.state ?? snapshot.operation?.result);
      if (!parsed.success) return { description: "已启用，等待在主窗口连接并应用布景。" };
      const state = parsed.data;
      if (state.status === "error")
        return { phase: "error", description: appearanceFailures[state.reason!] };
      return {
        description: state.active
          ? `布景已应用，持续同步 ${state.targets} 个窗口。`
          : "未应用布景。",
        capturedAt: state.checkedAt,
      };
    },
  };
}
