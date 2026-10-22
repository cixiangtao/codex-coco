import type { UsageCache } from "./cache";
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
  usageRefreshInputSchema,
  usageResultSchema,
  usageWindowTitle,
  usageMenuWindows,
  usagePlanTitle,
  usageState,
  trendTotals,
  trendInputSchema,
  type UsageResult,
  type TrendSnapshot,
  resetInputSchema,
  type ResetFeedback,
  intelligenceInputSchema,
  type UsageSnapshot,
} from "./contract";

/** Enabled modules refresh once at startup; recurring reads require a saved interval. */
export function createUsageModule(
  read: UsageReader | undefined = undefined,
  notify?: UsageNotifier,
  local?: LocalUsageService,
  resetService?: ResetService,
  tools?: UsageToolsService,
  cache?: UsageCache,
): BuiltinModule {
  const reader =
    read ?? createUsageReader(local?.environment ? { environment: local.environment } : {});
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
    state: usageResultSchema.nullable(),
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
      refresh: { input: usageRefreshInputSchema, output, timeoutMs: 60_000 },
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
      let executing = false;
      let config = usageConfigSchema.parse(host.configuration());
      let failures = 0;
      let timer: ReturnType<typeof setTimeout> | undefined;
      let notifications = new UsageNotifications(notify);
      let accountScope: string | null = null;
      let trend: TrendSnapshot | null = null;
      let latest: UsageResult | null = null;
      let reset: ResetFeedback | null = null;
      const restored = await cache?.load().catch(() => null);
      signal.throwIfAborted();
      if (restored) {
        previous = restored.data;
        accountScope = restored.scope;
        latest = { status: "cached", data: restored.data, trend: null, reset: null, tools: null };
      }
      const persist = async () => {
        if (previous) await cache?.save(previous, accountScope).catch(() => undefined);
      };
      let startupPending = true;
      let startupTimer: ReturnType<typeof setTimeout> | undefined;
      const scheduleStartup = () => {
        clearTimeout(startupTimer);
        if (!startupPending || stopped || signal.aborted) return;
        // The host installs the runtime after start resolves. Busy tasks defer this one read.
        startupTimer = setTimeout(() => {
          if (host.requestOperation("refresh", {})) startupPending = false;
          else scheduleStartup();
        }, 100);
      };
      const current = (): UsageResult | null =>
        latest
          ? usageResultSchema.parse({
              ...latest,
              trend,
              reset,
              tools: tools?.snapshot() ?? null,
            })
          : trend
            ? {
                status: "local",
                data: null,
                reason: null,
                trend,
                reset,
                tools: tools?.snapshot() ?? null,
              }
            : tools || reset
              ? { status: "tools", trend, reset, tools: tools?.snapshot() ?? null }
              : null;
      const result = () => current() ?? { status: "tools" as const, trend, reset, tools: null };
      const schedule = () => {
        clearTimeout(timer);
        if (
          !startupPending &&
          !executing &&
          !stopped &&
          !signal.aborted &&
          config.refreshIntervalSeconds > 0
        ) {
          const seconds = Math.min(
            3600,
            config.refreshIntervalSeconds * 2 ** Math.min(failures, 5),
          );
          timer = setTimeout(() => {
            if (!host.requestOperation("refresh", {})) schedule();
          }, seconds * 1000);
        }
      };
      signal.addEventListener(
        "abort",
        () => {
          clearTimeout(timer);
          clearTimeout(startupTimer);
        },
        { once: true },
      );
      scheduleStartup();
      return {
        state: current,
        configurationChanged: (value) => {
          config = usageConfigSchema.parse(value);
          schedule();
        },
        execute: async (name, input, context) => {
          if (stopped) throw new Error("USAGE_STOPPED");
          executing = true;
          clearTimeout(timer);
          clearTimeout(startupTimer);
          if (name === "refresh") startupPending = false;
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
              return result();
            }
            if (name === "reset-status") {
              reset = (await resetService?.latest()) ?? null;
              return result();
            }
            if (name === "consume-reset") {
              const redemption = resetInputSchema.parse(input);
              if (!resetService) throw new Error("RESET_UNAVAILABLE");
              try {
                const before = await reader(context.signal);
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
                const refreshed = await reader(context.signal);
                const refreshedScope = usageAccountScope(refreshed);
                if (refreshedScope !== accountScope) {
                  trend = null;
                  notifications = new UsageNotifications(notify);
                  accountScope = refreshedScope;
                }
                previous = normalizeUsage(refreshed, Date.now());
                latest = { status: "ready", data: previous, trend, reset, tools: null };
                await persist();
                context.signal.throwIfAborted();
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
              if (changed) {
                tools?.reset?.();
                previous = null;
                trend = null;
                latest = null;
                reset = null;
                accountScope = null;
                notifications = new UsageNotifications(notify);
                await cache?.clear().catch(() => undefined);
              }
              return current() ?? { status: "source", changed, trend };
            }
            if (name === "scan-trend") {
              if (!local) throw new Error("LOCAL_UNAVAILABLE");
              const scan = await local.scan(context.signal, context.report, {
                days: 30,
                scope: accountScope,
                force: trendInputSchema.parse(input).force,
              });
              trend = scan.trend;
              if (
                !latest ||
                latest.status === "local" ||
                latest.status === "source" ||
                latest.status === "tools"
              )
                latest = {
                  status: "local",
                  data: scan.fallback,
                  reason: null,
                  trend,
                  reset,
                  tools: null,
                };
              return result();
            }
            const raw = await reader(context.signal);
            context.signal.throwIfAborted();
            const nextScope = usageAccountScope(raw);
            if (nextScope !== accountScope) {
              if (accountScope !== null) tools?.reset?.();
              previous = null;
              trend = null;
              latest = null;
              reset = null;
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
            await persist();
            context.signal.throwIfAborted();
            // Quota success remains usable even if independent local history is unavailable.
            context.report(5);
            if (local) {
              try {
                trend = (
                  await local.scan(context.signal, context.report, {
                    days: 30,
                    scope: accountScope,
                    force: false,
                    refresh: usageRefreshInputSchema.parse(input).forceTrend,
                  })
                ).trend;
              } catch {
                context.signal.throwIfAborted();
              }
            }
            return result();
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
                  days: 30,
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
            executing = false;
            if (stopped) tools?.reset?.();
            scheduleStartup();
            schedule();
          }
        },
        stop: async () => {
          stopped = true;
          clearTimeout(startupTimer);
          if (!executing) tools?.reset?.();
          clearTimeout(timer);
          previous = null;
          trend = null;
          latest = null;
        },
      };
    },
    glance: (snapshot) => {
      const state = usageState(snapshot);
      if (!state) return { description: "已启用，正在准备读取 Codex CLI 的订阅额度。" };
      if (state.status === "cached")
        return {
          description: "已恢复上次记录，当前额度尚未确认；请在主窗口查看更新进度。",
        };
      const parsed = { data: state };
      const totals = state.trend && state.trend.source !== "none" ? trendTotals(state.trend) : null;
      const statistics = totals
        ? [
            {
              id: "tokens:today",
              label: "今日估算",
              value: `${totals.today.toLocaleString("zh-CN")} tokens`,
              numericValue: totals.today,
              unit: "tokens",
              detail: "本机记录，包含无归属计数",
            },
            {
              id: "tokens:week",
              label: "近 7 天",
              value: `${totals.week.toLocaleString("zh-CN")} tokens`,
              numericValue: totals.week,
              unit: "tokens",
              detail: "本机记录，包含无归属计数",
            },
            {
              id: "tokens:month",
              label: "近 30 天",
              value: `${totals.month.toLocaleString("zh-CN")} tokens`,
              numericValue: totals.month,
              unit: "tokens",
              detail: "本机记录，包含无归属计数",
            },
          ]
        : [];
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
          ...(!parsed.data.reason ? { metrics: statistics } : {}),
        };
      const data = parsed.data.data;
      return {
        description: `${data.account?.label ?? "账号标识不可用"} · ${usagePlanTitle(data.account?.plan)} · 最近一次额度记录`,
        identity: {
          label: data.account?.label ?? "账号标识不可用",
          plan: usagePlanTitle(data.account?.plan),
        },
        statusText: (() => {
          const settings = usageConfigSchema.safeParse(snapshot.config.value);
          if (!settings.success) return "";
          return data.buckets
            .filter((bucket) => bucket.id === "codex")
            .flatMap((bucket) =>
              usageMenuWindows(bucket.windows)
                .filter(({ primary }) =>
                  primary
                    ? settings.data.showPrimaryInMenuBar
                    : settings.data.showSecondaryInMenuBar,
                )
                .map(
                  ({ window, label }) =>
                    `${settings.data.showMenuBarLabels ? label + " " : ""}${Number(remainingPercent(window.usedPercent).toFixed(0))}%`,
                ),
            )
            .join(" · ");
        })(),
        capturedAt: data.capturedAt,
        metrics: [
          ...data.buckets
            .flatMap((bucket, index) =>
              bucket.windows.map((window) => ({
                id: `${bucket.id}:${window.kind}`,
                label: `${usageBucketTitle(bucket.id, index)} · ${usageWindowTitle(window)}`,
                group: usageBucketTitle(bucket.id, index),
                value: `剩余 ${Number(remainingPercent(window.usedPercent).toFixed(1))}%`,
                progress: remainingPercent(window.usedPercent),
                resetsAt: window.resetsAt === null ? null : window.resetsAt * 1000,
                detail:
                  window.resetsAt === null
                    ? "恢复时间未知"
                    : `${new Date(window.resetsAt * 1000).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })} 恢复`,
              })),
            )
            .slice(0, 36),
          ...statistics,
          ...(data.resetCredits
            ? [
                {
                  id: "reset:available",
                  label: "重置卡",
                  value: `${data.resetCredits.availableCount} 张可用`,
                  detail: "在主窗口核对并兑换",
                },
              ]
            : []),
        ],
      };
    },
  };
}
