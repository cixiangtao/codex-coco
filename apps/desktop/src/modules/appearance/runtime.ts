import type { BuiltinModule } from "../../application/module-host";
import { AppearanceAssets } from "./assets";
import { createAppearanceConnection, type AppearanceConnection } from "./cdp";
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
} from "./contract";

export interface AppearanceDependencies {
  directory: string;
  pickImage(): Promise<string | null>;
  thumbnail?(dataUrl: string): string | null;
  connection?: AppearanceConnection;
}
/** Owns only Codex Coco styles. Enabling never launches, restarts or modifies another app. */
export function createAppearanceModule(dependencies: AppearanceDependencies): BuiltinModule {
  const assets = new AppearanceAssets(dependencies.directory);
  const connection = dependencies.connection ?? createAppearanceConnection();
  return {
    id: "appearance",
    title: "外观",
    config: {
      version: 1,
      defaults: appearanceDefaults,
      schema: appearanceConfigSchema,
      migrations: {},
    },
    operations: Object.fromEntries(
      ["inspect", "apply", "sync", "verify", "remove", "import-image", "preview-image"].map(
        (name) => [
          name,
          {
            input: name === "preview-image" ? assetInputSchema : emptyAppearanceInput,
            output: appearanceResultSchema,
            timeoutMs: 15_000,
          },
        ],
      ),
    ),
    start: async (signal, host) => {
      signal.throwIfAborted();
      let active = false;
      let port: number | null = null;
      let count = 0;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const result = (extra: Partial<AppearanceResult> = {}): AppearanceResult => ({
        status: "ready",
        active,
        targets: count,
        checkedAt: Date.now(),
        reason: null,
        imported: null,
        preview: null,
        ...extra,
      });
      const schedule = () => {
        clearTimeout(timer);
        if (active && !signal.aborted)
          timer = setTimeout(() => {
            if (!host.requestOperation("sync", {})) schedule();
          }, 3000);
      };
      const remove = async (cleanup: AbortSignal) => {
        active = false;
        clearTimeout(timer);
        if (port !== null) {
          await connection.remove(port, cleanup);
          port = null;
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
      return {
        execute: async (name, input, context) => {
          const config = appearanceConfigSchema.parse(context.config);
          let imported: string | null = null;
          try {
            if (name === "import-image") {
              const path = await dependencies.pickImage();
              context.signal.throwIfAborted();
              if (!path) return result();
              imported = await assets.import(path);
              context.signal.throwIfAborted();
              const data = await assets.dataUrl(imported);
              return result({ imported, preview: dependencies.thumbnail?.(data) ?? null });
            }
            if (name === "preview-image") {
              imported = assetInputSchema.parse(input).id;
              const data = await assets.dataUrl(imported);
              return result({ imported, preview: dependencies.thumbnail?.(data) ?? null });
            }
            if (name === "inspect") {
              const targets = await connection.inspect(config.port, context.signal);
              return result({ targets });
            }
            if (name === "remove") {
              if (port === null) port = config.port; // Explicit recovery can remove a surviving style from an earlier run.
              await remove(context.signal);
              return result();
            }
            if (port !== null && port !== config.port) throw new Error("REMOVE_FIRST");
            if (name === "verify") {
              count = await connection.verify(config.port, context.signal);
              return result();
            }
            const css = await buildAppearanceCss(config, assets);
            context.signal.throwIfAborted();
            port = config.port; // Retain ownership even if only some windows accept the style.
            count = await connection.apply(port, css, context.signal);
            active = true;
            return result();
          } catch (error) {
            if (context.signal.aborted && port !== null) await remove(AbortSignal.timeout(2000));
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
                      : "APPLY_FAILED",
            });
          } finally {
            schedule();
          }
        },
        stop: async () => {
          await remove(AbortSignal.timeout(2000));
        },
      };
    },
    glance: (snapshot) => {
      const parsed = appearanceResultSchema.safeParse(snapshot.operation?.result);
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
