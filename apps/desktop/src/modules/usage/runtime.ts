import type { LocalUsageService } from "./local-service";
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
  trendInputSchema,
  type UsageResult,
  type TrendSnapshot,
  type UsageSnapshot,
} from "./contract";

/** Reads remain opt-in; an explicitly saved policy schedules bounded tasks without renderer timers. */
export function createUsageModule(
  read: UsageReader = createUsageReader(),
  notify?: UsageNotifier,
  local?: LocalUsageService,
): BuiltinModule {
  return {
    id: "usage",
    title: "用量",
    config: {
      version: 3,
      defaults: usageDefaults,
      schema: usageConfigSchema,
      migrations: {
        1: () => ({ ...usageDefaults }),
        2: (value) => ({
          ...usageDefaults,
          ...(typeof value === "object" && value !== null && !Array.isArray(value) ? value : {}),
        }),
      },
    },
    operations: {
      refresh: { input: usageInputSchema, output: usageResultSchema, timeoutMs: 60_000 },
      "scan-trend": { input: trendInputSchema, output: usageResultSchema, timeoutMs: 60_000 },
      "choose-local-home": {
        input: usageInputSchema,
        output: usageResultSchema,
        timeoutMs: 60_000,
      },
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
      let trend: TrendSnapshot | null = null;
      let latest: UsageResult | null = null;
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
        execute: async (name, input, context) => {
          if (stopped) throw new Error("USAGE_STOPPED");
          clearTimeout(timer);
          const settings = usageConfigSchema.parse(context.config);
          try {
            if (name === "choose-local-home") {
              if (!local) throw new Error("LOCAL_UNAVAILABLE");
              const changed = await local.chooseHome();
              context.signal.throwIfAborted();
              if (changed) trend = null;
              if (latest?.status === "ready" || latest?.status === "error")
                return { ...latest, trend };
              return { status: "source", changed, trend };
            }
            if (name === "scan-trend") {
              if (!local) throw new Error("LOCAL_UNAVAILABLE");
              const scan = await local.scan(context.signal, context.report, {
                days: settings.trendDays,
                scope: accountScope,
                force: trendInputSchema.parse(input).force,
              });
              trend = scan.trend;
              if (latest?.status === "ready" || latest?.status === "error")
                return { ...latest, trend };
              return { status: "local", data: scan.fallback, reason: null, trend };
            }
            const raw = await read(context.signal);
            context.signal.throwIfAborted();
            const nextScope = usageAccountScope(raw);
            if (nextScope !== null && nextScope !== accountScope) {
              previous = null;
              trend = null;
              latest = null;
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
            latest = { status: "ready", data, trend };
            return latest;
          } catch (error) {
            context.signal.throwIfAborted();
            if (name !== "refresh") throw error;
            failures++;
            notifications.failure({
              ...settings,
              notificationsEnabled: settings.notificationsEnabled && config.notificationsEnabled,
            });
            const reason = error instanceof UsageReadError ? error.code : "READ_FAILED";
            if (settings.localFallbackEnabled && local) {
              try {
                const scan = await local.scan(context.signal, context.report, {
                  days: settings.trendDays,
                  scope: accountScope,
                  force: false,
                });
                trend = scan.trend;
                if (scan.fallback) {
                  latest = { status: "local", data: scan.fallback, reason, trend };
                  return latest;
                }
              } catch {
                context.signal.throwIfAborted();
              }
            }
            latest = { status: "error", reason, checkedAt: Date.now(), previous, trend };
            return latest;
          } finally {
            schedule();
          }
        },
        stop: async () => {
          stopped = true;
          clearTimeout(timer);
          previous = null;
          trend = null;
          latest = null;
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
      if (parsed.data.status === "source")
        return {
          description: parsed.data.changed
            ? "本地记录目录已设置，可在主窗口扫描趋势。"
            : "目录选择已取消，可在主窗口继续操作。",
        };
      if (parsed.data.status === "local")
        return {
          phase: parsed.data.reason ? "error" : "running",
          description: parsed.data.reason
            ? "服务额度读取失败，主窗口可查看本机历史记录。"
            : "已读取本机趋势；本机记录不代表当前服务额度。",
        };
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
