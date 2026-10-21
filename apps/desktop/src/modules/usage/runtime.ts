import type { BuiltinModule } from "../../application/module-host";
import { createUsageReader, type UsageReader } from "./app-server";
import { normalizeUsage, UsageReadError } from "./normalize";
import {
  remainingPercent,
  usageBucketTitle,
  usageConfigSchema,
  usageFailures,
  usageInputSchema,
  usageResultSchema,
  usageWindowTitle,
  type UsageSnapshot,
} from "./contract";

/** Opt-in, manual reads only. Cached history is public quota data held in memory for this runtime. */
export function createUsageModule(read: UsageReader = createUsageReader()): BuiltinModule {
  return {
    id: "usage",
    title: "用量",
    config: { version: 1, defaults: {}, schema: usageConfigSchema, migrations: {} },
    operations: {
      refresh: { input: usageInputSchema, output: usageResultSchema, timeoutMs: 12_000 },
    },
    start: async (signal) => {
      signal.throwIfAborted();
      let previous: UsageSnapshot | null = null;
      let stopped = false;
      return {
        execute: async (_name, _input, context) => {
          if (stopped) throw new Error("USAGE_STOPPED");
          try {
            const raw = await read(context.signal);
            context.signal.throwIfAborted();
            const data = normalizeUsage(raw, Date.now());
            previous = data;
            return { status: "ready", data };
          } catch (error) {
            context.signal.throwIfAborted();
            return {
              status: "error",
              reason: error instanceof UsageReadError ? error.code : "READ_FAILED",
              checkedAt: Date.now(),
              previous,
            };
          }
        },
        stop: async () => {
          stopped = true;
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
        description: "来自 Codex CLI，额度为上次手动读取的记录。",
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
