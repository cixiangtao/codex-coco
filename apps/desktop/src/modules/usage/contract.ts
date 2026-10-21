import { z } from "zod";

export const usageConfigSchema = z
  .strictObject({
    refreshIntervalSeconds: z.union([z.literal(0), z.number().int().min(30).max(3600)]),
    notificationsEnabled: z.boolean(),
    warningThreshold: z.number().int().min(1).max(80),
    criticalThreshold: z.number().int().min(0).max(50),
    localFallbackEnabled: z.boolean(),
    trendDays: z.union([z.literal(7), z.literal(14), z.literal(30)]),
    showPrimaryInMenuBar: z.boolean(),
    showSecondaryInMenuBar: z.boolean(),
    showMenuBarLabels: z.boolean(),
  })
  .refine((value) => value.criticalThreshold < value.warningThreshold);
export type UsageConfig = z.infer<typeof usageConfigSchema>;
export const usageDefaults: UsageConfig = {
  refreshIntervalSeconds: 0,
  notificationsEnabled: false,
  warningThreshold: 20,
  criticalThreshold: 5,
  localFallbackEnabled: false,
  trendDays: 30,
  showPrimaryInMenuBar: true,
  showSecondaryInMenuBar: true,
  showMenuBarLabels: true,
};
export const usageInputSchema = z.strictObject({});
const windowSchema = z.strictObject({
  kind: z.enum(["primary", "secondary"]),
  usedPercent: z.number().min(0),
  windowMinutes: z.number().int().positive().nullable(),
  resetsAt: z.number().int().nonnegative().max(8_640_000_000_000).nullable(),
});
export const resetCreditsSchema = z.strictObject({
  availableCount: z.number().int().min(0).max(1_000_000),
  credits: z
    .array(
      z.strictObject({
        reference: z.string().regex(/^[a-f0-9]{64}$/),
        expiresAt: z.number().int().nonnegative().max(8_640_000_000_000).nullable(),
      }),
    )
    .max(100)
    .nullable(),
});
export const resetInputSchema = z.strictObject({
  attemptKey: z.uuid(),
  reference: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .nullable(),
});
export const resetFeedbackSchema = z.strictObject({
  attemptKey: z.uuid(),
  reference: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .nullable(),
  outcome: z.enum([
    "reset",
    "alreadyRedeemed",
    "nothingToReset",
    "noCredit",
    "pending",
    "rejected",
  ]),
  updatedAt: z.number().int().nonnegative(),
});
export type ResetFeedback = z.infer<typeof resetFeedbackSchema>;
export const usageSnapshotSchema = z
  .strictObject({
    resetCredits: resetCreditsSchema.nullable().default(null),
    capturedAt: z.number().int().nonnegative(),
    source: z.enum(["codex-app-server", "local-session"]),
    buckets: z
      .array(
        z.strictObject({
          id: z.string().regex(/^[a-zA-Z0-9_.:-]{1,80}$/),
          windows: z.array(windowSchema).min(1).max(2),
        }),
      )
      .min(0)
      .max(20),
  })
  .refine((value) => value.buckets.length > 0 || value.resetCredits !== null);
export const usageFailureSchema = z.enum([
  "CLI_NOT_FOUND",
  "CLI_FAILED",
  "NOT_SIGNED_IN",
  "UNSUPPORTED_ACCOUNT",
  "UNSUPPORTED_CLI",
  "READ_FAILED",
  "READ_TIMEOUT",
  "INVALID_RESPONSE",
  "NO_LIMITS",
]);
export const trendSnapshotSchema = z.strictObject({
  capturedAt: z.number().int().nonnegative(),
  days: z.union([z.literal(7), z.literal(14), z.literal(30)]),
  source: z.enum(["session-events", "thread-totals", "none"]),
  scope: z.enum(["current-account-and-unassigned", "all-local-unassigned"]),
  points: z
    .array(
      z.strictObject({
        day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        tokens: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
      }),
    )
    .max(30),
  unassignedTokens: z.number().int().nonnegative(),
  limited: z.boolean(),
  scannedFiles: z.number().int().nonnegative(),
  reusedFiles: z.number().int().nonnegative(),
});
export type TrendSnapshot = z.infer<typeof trendSnapshotSchema>;
export const localScanResultSchema = z.strictObject({
  trend: trendSnapshotSchema,
  fallback: usageSnapshotSchema.nullable(),
});
export const trendInputSchema = z.strictObject({ force: z.boolean() });
const modelIdSchema = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,99}$/);
const effortSchema = z.string().regex(/^[a-z][a-z0-9_-]{0,29}$/);
export const intelligenceInputSchema = z.strictObject({
  model: modelIdSchema.nullable(),
  effort: effortSchema.nullable(),
  runs: z.number().int().min(1).max(5),
});
export const modelOptionSchema = z.strictObject({
  id: modelIdSchema,
  label: z.string().min(1).max(120),
  efforts: z.array(effortSchema).max(12),
  defaultEffort: effortSchema.nullable(),
  isDefault: z.boolean(),
});
const nullableCount = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).nullable();
const sampleSchema = z.strictObject({
  index: z.number().int().min(1).max(5),
  answer: z.number().int().nullable(),
  explanation: z.string().max(8192),
  correct: z.boolean().nullable(),
  elapsedMs: z.number().nonnegative(),
  inputTokens: nullableCount,
  outputTokens: nullableCount,
  reasoningTokens: nullableCount,
});
export const intelligenceHistorySchema = z.strictObject({
  id: z.uuid(),
  capturedAt: z.number().int().nonnegative(),
  model: z.string().max(100),
  effort: z.string().max(30).nullable(),
  requested: z.number().int().min(1).max(5),
  completed: z.number().int().min(0).max(5),
  correct: z.number().int().min(0).max(5),
  averageTokensPerSecond: z.number().nonnegative().nullable(),
});
export const usageToolsSchema = z.strictObject({
  installation: z.enum(["unknown", "standalone", "package-manager", "homebrew"]),
  models: z.array(modelOptionSchema).max(200),
  samples: z.array(sampleSchema).max(5),
  history: z.array(intelligenceHistorySchema).max(100),
  error: z
    .enum([
      "MODELS_UNAVAILABLE",
      "SAMPLE_FAILED",
      "HISTORY_INVALID",
      "CLI_UNAVAILABLE",
      "UPDATE_FAILED",
    ])
    .nullable(),
  cliVersion: z
    .string()
    .regex(/^\d+\.\d+\.\d+$/)
    .nullable(),
  latestCliVersion: z
    .string()
    .regex(/^\d+\.\d+\.\d+$/)
    .nullable(),
});
export type UsageTools = z.infer<typeof usageToolsSchema>;
export const usageResultSchema = z.discriminatedUnion("status", [
  z.strictObject({
    status: z.literal("tools"),
    tools: usageToolsSchema.nullable().default(null),
    trend: trendSnapshotSchema.nullable(),
    reset: resetFeedbackSchema.nullable().default(null),
  }),
  z.strictObject({
    reset: resetFeedbackSchema.nullable().default(null),
    tools: usageToolsSchema.nullable().default(null),
    status: z.literal("source"),
    changed: z.boolean(),
    trend: trendSnapshotSchema.nullable(),
  }),
  z.strictObject({
    tools: usageToolsSchema.nullable().default(null),
    status: z.literal("ready"),
    data: usageSnapshotSchema,
    trend: trendSnapshotSchema.nullable().default(null),
    reset: resetFeedbackSchema.nullable().default(null),
  }),
  z.strictObject({
    tools: usageToolsSchema.nullable().default(null),
    status: z.literal("error"),
    reason: usageFailureSchema,
    checkedAt: z.number().int().nonnegative(),
    previous: usageSnapshotSchema.nullable(),
    trend: trendSnapshotSchema.nullable().default(null),
    reset: resetFeedbackSchema.nullable().default(null),
  }),
  z.strictObject({
    reset: resetFeedbackSchema.nullable().default(null),
    tools: usageToolsSchema.nullable().default(null),
    status: z.literal("local"),
    data: usageSnapshotSchema.nullable(),
    reason: usageFailureSchema.nullable(),
    trend: trendSnapshotSchema,
  }),
]);
export type UsageSnapshot = z.infer<typeof usageSnapshotSchema>;
export type UsageResult = z.infer<typeof usageResultSchema>;
export type UsageFailureCode = z.infer<typeof usageFailureSchema>;

/** Only fixed copy reaches the UI; CLI diagnostics and account fields are never displayed. */
export const usageFailures: Record<UsageFailureCode, { title: string; recovery: string }> = {
  CLI_NOT_FOUND: {
    title: "未找到 Codex CLI",
    recovery: "请安装 Codex CLI，并确保 codex 命令可用，然后重新读取。",
  },
  CLI_FAILED: {
    title: "Codex CLI 未能完成读取",
    recovery: "请检查 Codex CLI 是否可以正常运行，然后重试。",
  },
  NOT_SIGNED_IN: {
    title: "Codex CLI 尚未登录",
    recovery: "请先在终端运行 codex login，使用 ChatGPT 账号登录后重新读取。",
  },
  UNSUPPORTED_ACCOUNT: {
    title: "当前登录方式不提供订阅额度",
    recovery: "此处读取 ChatGPT 订阅额度。API Key 或其他登录方式的账单用量不在本轮范围内。",
  },
  UNSUPPORTED_CLI: { title: "Codex CLI 版本不支持用量读取", recovery: "请更新 Codex CLI 后重试。" },
  READ_FAILED: {
    title: "暂时无法更新用量",
    recovery: "请检查网络及 Codex CLI 的登录状态，然后重试。",
  },
  READ_TIMEOUT: { title: "用量读取超时", recovery: "读取已停止。请检查网络后重新读取。" },
  INVALID_RESPONSE: {
    title: "暂时无法识别用量响应",
    recovery: "请更新 Codex CLI 后重试；异常响应不会作为额度显示。",
  },
  NO_LIMITS: {
    title: "暂时没有可显示的额度窗口",
    recovery: "服务没有返回可用额度，稍后可以重新读取。缺失数据不会显示为 0%。",
  },
};
export function usageWindowTitle(window: UsageSnapshot["buckets"][number]["windows"][number]) {
  const minutes = window.windowMinutes;
  if (minutes === null)
    return window.kind === "primary" ? "主要窗口（时长未知）" : "次要窗口（时长未知）";
  if (minutes % 1440 === 0) return `${minutes / 1440} 天窗口`;
  if (minutes % 60 === 0) return `${minutes / 60} 小时窗口`;
  return `${minutes} 分钟窗口`;
}
export function usageBucketTitle(id: string, index: number) {
  return id === "codex" ? "通用额度" : `独立额度 ${index + 1}`;
}
export function remainingPercent(used: number) {
  return Math.max(0, Math.min(100, 100 - used));
}
