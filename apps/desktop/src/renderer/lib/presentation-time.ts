/** Display-only clock labels. Reaching a reset time never implies a confirmed new quota. */
export function recoveryLabel(at: number | null | undefined, now: number): string {
  if (at === null || at === undefined) return "恢复时间未知";
  const minutes = Math.ceil((at - now) / 60_000);
  if (minutes <= 0) return "等待刷新确认";
  if (minutes < 60) return `${minutes} 分钟后恢复`;
  const hours = Math.max(1, Math.round(minutes / 60));
  if (hours < 24) return `约 ${hours} 小时后恢复`;
  return `约 ${Math.max(1, Math.round(hours / 24))} 天后恢复`;
}
export function freshnessLabel(at: number, now: number): string {
  const minutes = Math.max(0, Math.floor((now - at) / 60_000));
  if (minutes < 1) return "刚刚更新";
  if (minutes < 60) return `${minutes} 分钟前更新`;
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? `${hours} 小时前更新` : `${Math.floor(hours / 24)} 天前更新`;
}
export function shortDateTime(at: number): string {
  return new Date(at).toLocaleString("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
