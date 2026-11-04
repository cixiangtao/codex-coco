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
  /** Native consent for the one-time startup connection; cancellation must close the prompt. */
  confirmRestart?(signal: AbortSignal): Promise<boolean>;
  gallery?: {
    list(signal: AbortSignal): Promise<GalleryItem[]>;
    remove(id: string): Promise<void>;
  };
}
/** Owns Codex Coco styles and prepares the selected app once per enabled lifetime. */
export function createAppearanceModule(dependencies: AppearanceDependencies): BuiltinModule {
  const assets = new AppearanceAssets(dependencies.directory);
  const connection = dependencies.connection ?? createAppearanceConnection();
  return {
    id: "appearance",
    title: "外观",
    config: {
      version: 3,
      defaults: appearanceDefaults,
      schema: appearanceConfigSchema,
      migrations: {
        1: (value) => appearanceConfigSchema.parse(value),
        2: (value) => appearanceConfigSchema.parse(value),
      },
    },
    state: appearanceResultSchema.nullable(),
    operations: Object.fromEntries(
      [
        "inspect",
        "monitor",
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
        "connect-on-enable",
      ].map((name) => [
        name,
        {
          background: name === "sync" || name === "monitor",
          input: ["preview-image", "remove-image"].includes(name)
            ? assetInputSchema
            : emptyAppearanceInput,
          output: appearanceResultSchema,
          timeoutMs: ["choose-application", "import-image", "connect-on-enable"].includes(name)
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
      let connectionStatus: AppearanceResult["connection"] = "unchecked";
      let detectedPort: number | null = null;
      let gallery: GalleryItem[] = [];
      const initialConfig = appearanceConfigSchema.parse(host.configuration());
      let startupPending = initialConfig.connectOnEnable && Boolean(dependencies.launcher?.probe);
      let restoring = !startupPending && initialConfig.restoreOnEnable;
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
          connection: connectionStatus,
          connectedPort: connectionStatus === "ready" ? (detectedPort ?? port) : null,
          gallery,
          ...extra,
        };
        if (
          [
            "apply",
            "sync",
            "verify",
            "remove",
            "launch-application",
            "restart-application",
            "connect-on-enable",
          ].includes(currentOperation)
        )
          connectionFailure = next.reason;
        const nextPublished: AppearanceResult = {
          ...next,
          imported: null,
          preview: null,
          ...(connectionFailure ? { status: "error", reason: connectionFailure } : {}),
        };
        // A successful maintenance heartbeat is not a new user-visible event.
        if (published && ["sync", "monitor"].includes(currentOperation)) {
          const unchanged = { ...nextPublished, checkedAt: published.checkedAt };
          if (JSON.stringify(unchanged) === JSON.stringify(published)) return next;
        }
        published = nextPublished;
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
      let initialProbe: ReturnType<typeof setTimeout> | undefined;
      const requestInitialConnection = () => {
        if (stopped || signal.aborted) return;
        if (!appearanceConfigSchema.parse(host.configuration()).connectOnEnable)
          startupPending = false;
        const operation = startupPending ? "connect-on-enable" : "monitor";
        if (host.requestOperation(operation, {})) startupPending = false;
        else initialProbe = setTimeout(requestInitialConnection, 100);
      };
      if (dependencies.launcher?.probe) initialProbe = setTimeout(requestInitialConnection, 100);
      schedule();
      return {
        state: () => published,
        configurationChanged: (value) => {
          if (!appearanceConfigSchema.parse(value).restoreOnEnable) restoring = false;
          schedule();
        },
        execute: async (name, input, context) => {
          const assertRunning = () => {
            context.signal.throwIfAborted();
            signal.throwIfAborted();
            if (stopped) throw new Error("NOT_CONNECTED");
          };
          currentOperation = name;
          const config =
            name === "sync" && appliedConfig
              ? appliedConfig
              : appearanceConfigSchema.parse(context.config);
          let imported: string | null = null;
          const previousPort = port;
          const automatic = name === "connect-on-enable";
          let launching = name === "launch-application" || name === "restart-application";
          let restart = name === "restart-application";
          let launchedPort: number | null = null;
          try {
            assertRunning();
            if (automatic && !config.connectOnEnable) return result();
            if (["apply", "remove", "launch-application", "restart-application"].includes(name)) {
              startupPending = false;
              clearTimeout(initialProbe);
            }
            if (dependencies.launcher) selected = await dependencies.launcher.selected();
            assertRunning();
            if (automatic) {
              if (!selected || !dependencies.launcher?.probe) {
                connectionStatus = "not-selected";
                // Preserve the legacy opt-in for manually started CDP targets without a saved app.
                restoring = config.restoreOnEnable;
                appliedConfig = restoring ? config : null;
                return result();
              }
              let process = await dependencies.launcher.probe(context.signal);
              assertRunning();
              if (process.running && process.debugPort === null) {
                connectionStatus = "needs-restart";
                const accepted = await dependencies.confirmRestart?.(context.signal);
                assertRunning();
                if (
                  !accepted ||
                  !appearanceConfigSchema.parse(host.configuration()).connectOnEnable
                )
                  return result();
                // The user may have closed or relaunched Codex while deciding.
                process = await dependencies.launcher.probe(context.signal);
              }
              assertRunning();
              if (process.running && process.debugPort !== null) {
                launchedPort = process.debugPort;
              } else {
                launching = true;
                restart = process.running;
              }
            }
            if (name === "choose-application") {
              if (port !== null) throw new Error("REMOVE_FIRST");
              if (!dependencies.launcher) throw new Error("LAUNCH_FAILED");
              const changed = await dependencies.launcher.choose(context.signal);
              selected = await dependencies.launcher.selected();
              if (!changed) return result();
              if (changed) {
                detectedPort = null;
                connectionStatus = "unchecked";
                count = 0;
                connectionFailure = null;
              }
            }
            if (["monitor", "inspect", "choose-application"].includes(name)) {
              const process = selected
                ? await dependencies.launcher?.probe?.(context.signal)
                : undefined;
              if (
                ["APP_RUNNING", "APP_NOT_SELECTED", "LAUNCH_FAILED"].includes(
                  connectionFailure ?? "",
                )
              )
                connectionFailure = null;
              const candidate =
                process?.debugPort ?? (await dependencies.launcher?.port(config)) ?? config.port;
              connectionStatus = !selected
                ? "not-selected"
                : process && !process.running
                  ? "stopped"
                  : process && process.debugPort === null
                    ? "needs-restart"
                    : "unavailable";
              if (process && (!process.running || process.debugPort === null)) {
                active = false;
                count = 0;
                detectedPort = null;
                return result();
              }
              try {
                const targets = await connection.inspect(candidate, context.signal);
                connectionStatus = "ready";
                count = targets;
                detectedPort = candidate;
                if (connectionFailure === "NOT_CONNECTED" || connectionFailure === "INVALID_TARGET")
                  connectionFailure = null;
                return result({ targets, connectedPort: candidate });
              } catch (error) {
                assertRunning();
                active = false;
                count = 0;
                detectedPort = null;
                if (name === "inspect") throw error;
                return result();
              }
            }
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
            if (launching) {
              if (!dependencies.launcher) throw new Error("LAUNCH_FAILED");
              const launched = await dependencies.launcher.launch(config, restart, context.signal);
              assertRunning();
              // Only a successful native launch supersedes the old process and its styles.
              // A refused launch or quit must leave an existing applied scene intact.
              active = false;
              syncing = false;
              clearTimeout(timer);
              port = null;
              appliedConfig = null;
              count = 0;
              launchedPort = launched;
            }
            if (launchedPort !== null) {
              const until = Date.now() + 30_000;
              while (true) {
                assertRunning();
                try {
                  count = await connection.inspect(launchedPort, context.signal);
                  assertRunning();
                  break;
                } catch {
                  assertRunning();
                  if (Date.now() > until) throw new Error("NOT_CONNECTED");
                  await new Promise((resolve) => setTimeout(resolve, 200));
                }
              }
              detectedPort = launchedPort;
              connectionStatus = "ready";
            }
            if (name === "import-image") {
              const path = await dependencies.pickImage();
              assertRunning();
              if (!path) return result();
              imported = await assets.import(path);
              assertRunning();
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
            const targetPort =
              launchedPort ??
              (name === "sync" && port !== null
                ? port
                : config.portMode === "fixed"
                  ? config.port
                  : (detectedPort ?? (await dependencies.launcher?.port(config)) ?? config.port));
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
              connectionStatus = "ready";
              detectedPort = targetPort;
              return result();
            }
            if (!config.wallpaper.enabled && !config.main.enabled && !config.sidebar.enabled) {
              restoring = false;
              await remove(context.signal);
              return result({ connectedPort: launchedPort ?? port });
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
                assertRunning();
              }
            }
            assertRunning();
            port = targetPort; // Retain ownership even if only some windows accept the style.
            appliedConfig = config;
            syncing = true;
            count = await connection.apply(port, css, context.signal);
            count = await connection.verify(port, context.signal, css);
            active = true;
            detectedPort = targetPort;
            connectionStatus = "ready";
            failures = 0;
            return result();
          } catch (error) {
            failures++;
            if (["apply", "sync", "verify"].includes(name) || launchedPort !== null) active = false;
            if (error instanceof AppearanceDiscoveryError && previousPort === null) port = null;
            if (context.signal.aborted && port !== null && (!launching || launchedPort !== null))
              await remove(AbortSignal.timeout(2000));
            assertRunning();
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
                      : launching && launchedPort === null
                        ? "LAUNCH_FAILED"
                        : "APPLY_FAILED",
            });
          } finally {
            schedule();
          }
        },
        stop: async () => {
          stopped = true;
          startupPending = false;
          clearTimeout(initialProbe);
          restoring = false;
          await remove(AbortSignal.timeout(2000));
        },
      };
    },
    glance: (snapshot) => {
      const parsed = appearanceResultSchema.safeParse(snapshot.state ?? snapshot.operation?.result);
      if (!parsed.success) return { description: "已启用，等待在主窗口连接并应用布景。" };
      const state = parsed.data;
      if (
        snapshot.operation?.phase === "failed" &&
        ["sync", "monitor"].includes(snapshot.operation.name)
      )
        return { phase: "error", description: "布景维护未完成，请在主窗口检查连接后重试。" };
      const busy =
        snapshot.operation?.phase === "running" || snapshot.operation?.phase === "cancelling";
      const saved = appearanceConfigSchema.safeParse(snapshot.config.value);
      const hasEnabledLayers =
        saved.success &&
        [saved.data.wallpaper, saved.data.main, saved.data.sidebar].some((layer) => layer.enabled);
      const action =
        !busy && state.appSelected
          ? state.connection === "stopped"
            ? "launch"
            : state.connection === "needs-restart"
              ? "restart"
              : state.connection === "ready" && !state.active && hasEnabledLayers
                ? "apply"
                : undefined
          : undefined;
      const pending =
        snapshot.operation?.name === "connect-on-enable"
          ? "正在连接 Codex 并恢复布景…"
          : snapshot.operation?.name === "restart-application"
            ? "正在重启 Codex 并应用布景…"
            : snapshot.operation?.name === "launch-application"
              ? "正在启动 Codex 并应用布景…"
              : snapshot.operation?.name === "apply"
                ? "正在应用布景…"
                : null;
      return {
        ...(state.status === "error" && !busy ? { phase: "error" as const } : {}),
        ...(action ? { appearanceAction: action } : {}),
        busy,
        description:
          busy && pending
            ? pending
            : state.status === "error"
              ? appearanceFailures[state.reason!]
              : state.active
                ? `布景已应用到 ${state.targets} 个窗口。`
                : state.connection === "needs-restart"
                  ? "Codex 正在运行，尚未开启布景连接。重启后自动应用已保存布景。"
                  : state.connection === "stopped"
                    ? "Codex 尚未运行，启动后自动应用已保存布景。"
                    : state.connection === "not-selected"
                      ? "请在主窗口选择 Codex 应用，之后可在这里快捷启动。"
                      : state.connection === "ready"
                        ? hasEnabledLayers
                          ? "Codex 已连接，可应用已保存布景。"
                          : "Codex 已连接，当前所有布景图层均已关闭。"
                        : "暂未连接 Codex，请检查连接设置。",
        capturedAt: state.checkedAt,
      };
    },
  };
}
