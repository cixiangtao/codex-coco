import type { GlanceItem, GlanceDetail } from "../contracts/glance";
import type { ModuleSnapshot } from "../contracts/modules";

const planned = [
  { id: "usage", title: "用量", page: "usage", description: "用量模块尚未接入，暂无账号余量。" },
  {
    id: "appearance",
    title: "外观",
    page: "appearance",
    description: "外观模块尚未接入，未连接外部 Codex。",
  },
] as const;
const phaseDescriptions = {
  disabled: "模块已停用，可在主窗口管理。",
  starting: "模块正在启动，请稍候。",
  running: "模块正在运行，完整信息请在主窗口查看。",
  stopping: "模块正在停止，请稍候。",
  error: "模块暂时不可用，请前往主窗口处理。",
} as const;

/** Projects host state without copying private configuration, results, or raw error strings. */
export function buildGlanceItems(
  snapshots: readonly ModuleSnapshot[],
  details: ReadonlyMap<string, GlanceDetail> = new Map(),
): GlanceItem[] {
  const items: GlanceItem[] = planned.map((item) => ({ ...item, phase: "unavailable" }));
  for (const snapshot of snapshots) {
    const target = items.find((item) => item.id === snapshot.id);
    const phase =
      ["invalid", "future-version", "unavailable"].includes(snapshot.config.health) ||
      snapshot.error ||
      (snapshot.operation?.phase === "failed" && snapshot.state === undefined)
        ? "error"
        : snapshot.phase;
    const item: GlanceItem = {
      id: snapshot.id,
      title: snapshot.title,
      phase,
      description:
        snapshot.operation?.phase === "failed" && snapshot.phase !== "error"
          ? "最近操作未完成，请前往主窗口处理。"
          : phaseDescriptions[phase],
      page: phase === "error" ? "modules" : (target?.page ?? "modules"),
    };
    const detail = details.get(snapshot.id);
    if (phase === "running" && detail) {
      item.phase = detail.phase ?? phase;
      item.description = detail.description;
      item.page = detail.page ?? target?.page ?? "modules";
      if (detail.statusText !== undefined) item.statusText = detail.statusText;
      if (detail.metrics) item.metrics = detail.metrics;
      if (detail.capturedAt !== undefined) item.capturedAt = detail.capturedAt;
      if (detail.identity) item.identity = detail.identity;
      if (detail.series) item.series = detail.series;
    }
    if (target) items[items.indexOf(target)] = item;
    else items.push(item);
  }
  // Recovery precedes ordinary summaries; stable sort preserves module order within each group.
  return items.sort(
    (first, second) => Number(second.phase === "error") - Number(first.phase === "error"),
  );
}
