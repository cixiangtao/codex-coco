import {
  remainingPercent,
  usageWindowTitle,
  type UsageConfig,
  type UsageSnapshot,
} from "./contract";

export interface UsageNotification {
  kind: "warning" | "critical" | "recovered" | "failure";
  title: string;
  body: string;
}
export type UsageNotifier = (notification: UsageNotification) => boolean;
/** Emits transitions rather than polling ticks. Synchronous delivery failures remain retryable. */
export class UsageNotifications {
  private previous: "normal" | "warning" | "critical" | null = null;
  private cycle: number | null = null;
  private failureSent = false;
  constructor(private readonly deliver: UsageNotifier = () => false) {}
  success(data: UsageSnapshot, config: UsageConfig) {
    this.failureSent = false;
    if (!config.notificationsEnabled) {
      this.previous = null;
      return;
    }
    const constrained = data.buckets
      .flatMap((bucket) => bucket.windows)
      .sort((a, b) => b.usedPercent - a.usedPercent)[0];
    if (!constrained) return;
    const remaining = remainingPercent(constrained.usedPercent);
    const next =
      remaining <= config.criticalThreshold
        ? "critical"
        : remaining <= config.warningThreshold
          ? "warning"
          : "normal";
    const changed =
      next !== this.previous ||
      (next !== "normal" &&
        this.cycle !== null &&
        constrained.resetsAt !== null &&
        Math.abs(this.cycle - constrained.resetsAt) > 60);
    const recovered = next === "normal" && this.previous !== null && this.previous !== "normal";
    if (!changed || (next === "normal" && !recovered)) {
      this.previous = next;
      this.cycle = constrained.resetsAt;
      return;
    }
    const sent = this.safeDeliver({
      kind: recovered ? "recovered" : next === "critical" ? "critical" : "warning",
      title: recovered
        ? "Codex 额度已恢复"
        : next === "critical"
          ? "Codex 用量接近上限"
          : "Codex 剩余额度偏低",
      body: `${usageWindowTitle(constrained)}当前剩余 ${Number(remaining.toFixed(1))}%。请打开 Codex Coco 查看详情。`,
    });
    if (sent) {
      this.previous = next;
      this.cycle = constrained.resetsAt;
    }
  }
  failure(config: UsageConfig) {
    if (!config.notificationsEnabled || this.failureSent) return;
    this.failureSent = this.safeDeliver({
      kind: "failure",
      title: "Codex 用量刷新失败",
      body: "暂时无法更新额度，请打开 Codex Coco 检查登录与网络后重新读取。",
    });
  }
  private safeDeliver(value: UsageNotification) {
    try {
      return this.deliver(value);
    } catch {
      return false;
    }
  }
}
