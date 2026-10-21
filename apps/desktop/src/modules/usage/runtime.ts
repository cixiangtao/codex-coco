import { UsageNotifications, type UsageNotifier } from "./notifications";
import type { BuiltinModule } from "../../application/module-host";
import { createUsageReader, usageAccountScope, type UsageReader } from "./app-server";
import { normalizeUsage, UsageReadError } from "./normalize";
import {
  remainingPercent,
  usageBucketTitle,
  usageConfigSchema,
  usageDefaults,
  usageFailures,
  usageInputSchema,
  usageResultSchema,
  usageWindowTitle,
  type UsageSnapshot,
} from "./contract";

/** Reads remain opt-in; an explicitly saved policy schedules bounded tasks without renderer timers. */
export function createUsageModule(
  read: UsageReader = createUsageReader(),
  notify?: UsageNotifier,
): BuiltinModule {
  return {
    id: "usage",
    title: "用量",
    config: {
      version: 2,
      defaults: usageDefaults,
      schema: usageConfigSchema,
      migrations: { 1: () => ({ ...usageDefaults }) },
    },
    operations: {
      refresh: { input: usageInputSchema, output: usageResultSchema, timeoutMs: 12_000 },
    },
    start: async (signal, host) => {
      signal.throwIfAborted();
      let previous: UsageSnapshot | null = null;
      let stopped = false;
      let config = usageConfigSchema.parse(host.configuration());
      let failures = 0;
      let timer: ReturnType<typeof setTimeout> | undefined;
      let notifications = new UsageNotifications(notify);
      let accountScope: string | null = null;
      const schedule = () => {
        clearTimeout(timer);
        if (!stopped && !signal.aborted && config.refreshIntervalSeconds > 0) {
          const seconds = Math.min(
            3600,
            config.refreshIntervalSeconds * 2 ** Math.min(failures, 5),
          );
          timer = setTimeout(() => {
            if (!host.requestOperation("refresh", {})) schedule();
          }, seconds * 1000);
        }
      };
      signal.addEventListener("abort", () => clearTimeout(timer), { once: true });
      schedule();
      return {
        configurationChanged: (value) => {
          config = usageConfigSchema.parse(value);
          schedule();
        },
        execute: async (_name, _input, context) => {
          if (stopped) throw new Error("USAGE_STOPPED");
          clearTimeout(timer);
          const settings = usageConfigSchema.parse(context.config);
          try {
            const raw = await read(context.signal);
            context.signal.throwIfAborted();
            const nextScope = usageAccountScope(raw);
            if (nextScope !== null && nextScope !== accountScope) {
              previous = null;
              notifications = new UsageNotifications(notify);
              accountScope = nextScope;
            }
            const data = normalizeUsage(raw, Date.now());
            previous = data;
            failures = 0;
            notifications.success(data, {
              ...settings,
              notificationsEnabled: settings.notificationsEnabled && config.notificationsEnabled,
            });
            return { status: "ready", data };
          } catch (error) {
            context.signal.throwIfAborted();
            failures++;
            notifications.failure({
              ...settings,
              notificationsEnabled: settings.notificationsEnabled && config.notificationsEnabled,
            });
            return {
              status: "error",
              reason: error instanceof UsageReadError ? error.code : "READ_FAILED",
              checkedAt: Date.now(),
              previous,
            };
          } finally {
            schedule();
          }
        },
        stop: async () => {
          stopped = true;
          clearTimeout(timer);
          previous = null;
        },
      };
    },
    glance: (snapshot) => {
      const operation = snapshot.operation;
      if (!operation) return { description: "已启用，打开主窗口手动读取 Codex CLI 的订阅额度。" };
      if (operation.phase === "running" || operation.phase === "cancelling")
        return {
          description:
            operation.phase === "running" ? "正在读取额度，请稍候。" : "正在取消读取，请稍候。",
        };
      if (operation.phase === "cancelled")
        return { description: "读取已取消，可在主窗口重新读取。" };
      const parsed = usageResultSchema.safeParse(operation.result);
      if (!parsed.success) return null;
      if (parsed.data.status === "error")
        return { phase: "error", description: usageFailures[parsed.data.reason].title };
      const data = parsed.data.data;
      return {
        description: "来自 Codex CLI，额度为最近一次读取的记录。",
        statusText: (() => {
          const settings = usageConfigSchema.safeParse(snapshot.config.value);
          if (!settings.success) return "";
          return data.buckets
            .filter((bucket) => bucket.id === "codex")
            .flatMap((bucket) =>
              bucket.windows
                .filter((window) =>
                  window.kind === "primary"
                    ? settings.data.showPrimaryInMenuBar
                    : settings.data.showSecondaryInMenuBar,
                )
                .map(
                  (window) =>
                    `${settings.data.showMenuBarLabels ? usageWindowTitle(window) + " " : ""}${Number(remainingPercent(window.usedPercent).toFixed(0))}%`,
                ),
            )
            .join(" · ")
            .slice(0, 120);
        })(),
        capturedAt: data.capturedAt,
        metrics: data.buckets.flatMap((bucket, index) =>
          bucket.windows.map((window) => ({
            id: `${bucket.id}:${window.kind}`,
            label: `${usageBucketTitle(bucket.id, index)} · ${usageWindowTitle(window)}`,
            value: `剩余 ${Number(remainingPercent(window.usedPercent).toFixed(1))}%`,
            detail:
              window.resetsAt === null
                ? "恢复时间未知"
                : `${new Date(window.resetsAt * 1000).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })} 恢复`,
          })),
        ),
      };
    },
  };
}
