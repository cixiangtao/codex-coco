import type { UsageToolsService } from "./tools";
import type { ResetService } from "./reset";
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
  resetInputSchema,
  type ResetFeedback,
  intelligenceInputSchema,
  type UsageSnapshot,
} from "./contract";

/** Reads remain opt-in; an explicitly saved policy schedules bounded tasks without renderer timers. */
export function createUsageModule(
  read: UsageReader = createUsageReader(),
  notify?: UsageNotifier,
  local?: LocalUsageService,
  resetService?: ResetService,
  tools?: UsageToolsService,
): BuiltinModule {
  const output = usageResultSchema.transform((value) =>
    usageResultSchema.parse({ ...value, tools: tools?.snapshot() ?? null }),
  );
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
      ...Object.fromEntries(
        [
          "list-models",
          "load-intelligence-history",
          "clear-intelligence-history",
          "check-cli",
          "update-cli",
          "run-intelligence",
        ].map((name) => [
          name,
          {
            input: name === "run-intelligence" ? intelligenceInputSchema : usageInputSchema,
            output,
            timeoutMs:
              name === "run-intelligence" ? 610_000 : name === "update-cli" ? 230_000 : 60_000,
          },
        ]),
      ),
      refresh: { input: usageInputSchema, output, timeoutMs: 60_000 },
      "consume-reset": { input: resetInputSchema, output, timeoutMs: 40_000 },
      "reset-status": { input: usageInputSchema, output, timeoutMs: 5000 },
      "scan-trend": { input: trendInputSchema, output, timeoutMs: 60_000 },
      "choose-local-home": {
        input: usageInputSchema,
        output,
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
      let reset: ResetFeedback | null = null;
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
            if (
              [
                "list-models",
                "load-intelligence-history",
                "clear-intelligence-history",
                "check-cli",
                "update-cli",
                "run-intelligence",
              ].includes(name)
            ) {
              if (!tools) throw new Error("TOOLS_UNAVAILABLE");
              await tools.execute(name, input, context.signal, context.report);
              return latest ?? { status: "tools", tools: tools.snapshot(), trend, reset };
            }
            if (name === "reset-status") {
              reset = (await resetService?.latest()) ?? null;
              return latest
                ? { ...latest, reset }
                : {
                    status: "error",
                    reason: "NO_LIMITS",
                    checkedAt: Date.now(),
                    previous,
                    trend,
                    reset,
                  };
            }
            if (name === "consume-reset") {
              const redemption = resetInputSchema.parse(input);
              if (!resetService) throw new Error("RESET_UNAVAILABLE");
              try {
                const before = await read(context.signal);
                reset = await resetService.consume(
                  redemption,
                  before,
                  usageAccountScope(before),
                  context.signal,
                );
                if (reset.outcome === "pending")
                  return {
                    status: "error",
                    reason: "READ_FAILED",
                    checkedAt: Date.now(),
                    previous,
                    trend,
                    reset,
                  };
                const refreshed = await read(context.signal);
                previous = normalizeUsage(refreshed, Date.now());
                latest = { status: "ready", data: previous, trend, reset, tools: null };
                return latest;
              } catch {
                context.signal.throwIfAborted();
                const stored = await resetService.latest();
                reset =
                  stored &&
                  (stored.attemptKey === redemption.attemptKey || stored.outcome === "pending")
                    ? stored
                    : { ...redemption, outcome: "rejected", updatedAt: Date.now() };
                return {
                  status: "error",
                  reason: "READ_FAILED",
                  checkedAt: Date.now(),
                  previous,
                  trend,
                  reset,
                };
              }
            }
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
            latest = { status: "ready", data, trend, reset, tools: null };
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
                  latest = {
                    status: "local",
                    data: scan.fallback,
                    reason,
                    trend,
                    reset,
                    tools: null,
                  };
                  return latest;
                }
              } catch {
                context.signal.throwIfAborted();
              }
            }
            latest = {
              status: "error",
              reason,
              checkedAt: Date.now(),
              previous,
              trend,
              reset,
              tools: null,
            };
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
      if (
        parsed.data.tools?.error &&
        [
          "list-models",
          "run-intelligence",
          "load-intelligence-history",
          "clear-intelligence-history",
          "check-cli",
          "update-cli",
        ].includes(operation.name)
      )
        return { phase: "error", description: "用量辅助工具操作未完成，请在主窗口检查。" };
      if (parsed.data.status === "error")
        return { phase: "error", description: usageFailures[parsed.data.reason].title };
      if (parsed.data.status === "tools")
        return {
          phase: parsed.data.tools?.error ? "error" : "running",
          description: parsed.data.tools?.error
            ? "用量辅助工具操作未完成，请在主窗口检查。"
            : "辅助工具已就绪，额度仍需单独读取。",
        };
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
