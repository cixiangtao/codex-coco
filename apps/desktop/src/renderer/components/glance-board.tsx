import type { ReactNode } from "react";
import { ArrowUpRight, ChartNoAxesColumn, Clock3, Ticket } from "lucide-react";
import { Button } from "@codex-coco/ui/components/button";
import { Card, CardHeader, CardContent, CardTitle } from "@codex-coco/ui/components/card";
import { ProgressRing } from "@codex-coco/ui/components/progress-ring";
import { Alert, AlertDescription, AlertTitle } from "@codex-coco/ui/components/alert";
import {
  appearanceQuickActionLabels,
  type AppearanceQuickAction,
  type GlanceSnapshot,
} from "../../contracts/glance";
import {
  glanceBlocks,
  defaultGlanceLayout,
  type GlanceLayout,
  type GlanceBlockId,
} from "../../contracts/glance-layout";
import type { MainPage } from "../../contracts/windows";
import { GlanceModule } from "./glance-module";
import { GlanceSortableBlock } from "./glance-reorder";
import { formatTokens, formatExactTokens } from "../lib/token-format";
import { freshnessLabel, recoveryLabel, shortDateTime } from "../lib/presentation-time";

interface BoardProps {
  snapshot: GlanceSnapshot;
  now: number;
  busy?: boolean;
  onOpen(page: MainPage): void;
  onAppearanceAction?: ((action: AppearanceQuickAction) => void) | undefined;
}

/** One selected public block always owns one Card, including when its source is unavailable. */
export function GlanceBlockCard({
  id,
  snapshot,
  now,
  busy = false,
  onOpen,
  onAppearanceAction,
  handle,
}: BoardProps & { id: GlanceBlockId; handle?: ReactNode }) {
  const definition = glanceBlocks.find((block) => block.id === id)!;
  const item = snapshot.items.find((entry) => entry.id === definition.moduleId);
  const quota = id === "usage.primary" || id === "usage.secondary";
  const tokens = id === "usage.today" || id === "usage.week" || id === "usage.month";
  const metrics = quota
    ? (item?.metrics?.filter(
        (metric) =>
          metric.id.endsWith(id === "usage.primary" ? ":primary" : ":secondary") &&
          metric.progress !== undefined,
      ) ?? [])
    : [];
  const metric = tokens
    ? item?.metrics?.find((entry) => entry.id === `tokens:${id.split(".")[1]}`)
    : undefined;
  const unavailable =
    item?.phase !== "running" ||
    (quota && !metrics.length) ||
    (tokens && metric?.numericValue === undefined) ||
    (id === "usage.trend" && !item.series?.points.length);
  const open = (
    <Button
      variant="ghost"
      size="icon-xs"
      aria-label={`查看${definition.title}`}
      disabled={busy}
      onClick={() => onOpen(definition.page)}
    >
      <ArrowUpRight />
    </Button>
  );
  const actions = (
    <div className="glance-card-actions">
      {open}
      {handle}
    </div>
  );
  if (id.endsWith(".status") && item && item.phase !== "error") {
    return (
      <GlanceModule
        item={item}
        busy={busy}
        onOpen={() => onOpen(definition.page)}
        onAppearanceAction={onAppearanceAction}
        handle={handle}
      />
    );
  }
  if (unavailable) {
    return (
      <Card className="glance-block-unavailable" density="compact" aria-label={definition.title}>
        <CardHeader>
          <CardTitle>{definition.title}</CardTitle>
          {actions}
        </CardHeader>
        <CardContent>
          <p>
            {item?.phase === "disabled"
              ? "来源模块已停用"
              : item?.phase === "error"
                ? "暂不可用，请先处理异常"
                : "暂无数据"}
          </p>
        </CardContent>
      </Card>
    );
  }
  if (quota) {
    return (
      <Card className="glance-quota-block" density="compact" aria-label={definition.title}>
        <CardHeader>
          <CardTitle>{definition.title}</CardTitle>
          {actions}
        </CardHeader>
        <CardContent className="glance-capacity-groups">
          {metrics.map((entry) => (
            <section key={entry.id} className="glance-quota" aria-label={entry.label}>
              <div className="glance-quota-copy">
                <h4>{entry.label}</h4>
                <span className="glance-quota-reset">
                  <Clock3 aria-hidden="true" />
                  {recoveryLabel(entry.resetsAt, now)}
                </span>
                {entry.resetsAt !== null && entry.resetsAt !== undefined && (
                  <time dateTime={new Date(entry.resetsAt).toISOString()}>
                    {shortDateTime(entry.resetsAt)}
                  </time>
                )}
              </div>
              <ProgressRing
                size="sm"
                value={entry.progress!}
                label={entry.label}
                valuePrefix="剩余"
                caption="剩余额度"
                tone={
                  entry.progress! <= 5
                    ? "warning"
                    : id === "usage.secondary"
                      ? "success"
                      : "primary"
                }
              />
            </section>
          ))}
        </CardContent>
      </Card>
    );
  }
  if (tokens) {
    return (
      <Card className="glance-token-block" density="compact" aria-label={definition.title}>
        <CardHeader>
          <CardTitle>{definition.title}</CardTitle>
          {actions}
        </CardHeader>
        <CardContent>
          <div
            className="glance-token-value"
            title={`${formatExactTokens(metric?.numericValue)} tokens`}
          >
            <strong>{formatTokens(metric?.numericValue)}</strong>
            <span>tokens</span>
          </div>
          <p className="glance-token-note">
            {item.series?.estimated ? "线程累计估算 · 含无归属记录" : "本机记录 · 含无归属计数"}
            {item.series?.limited ? " · 统计不完整" : ""}
          </p>
        </CardContent>
      </Card>
    );
  }
  if (id === "usage.trend" && item.series) {
    const maximum = Math.max(1, ...item.series.points.map((point) => point.tokens));
    return (
      <Card className="glance-trend-block" density="compact" aria-label={definition.title}>
        <CardHeader>
          <CardTitle>
            <ChartNoAxesColumn aria-hidden="true" />
            每日用量趋势
          </CardTitle>
          {actions}
        </CardHeader>
        <CardContent>
          <div className="glance-mini-chart">
            {item.series.points.map((point) => (
              <div
                key={point.day}
                title={`${point.day} · ${formatExactTokens(point.tokens)} tokens`}
              >
                <span style={{ height: `${(point.tokens / maximum) * 100}%` }} />
              </div>
            ))}
          </div>
          <div className="glance-trend-range">
            <span>{item.series.points[0]?.day.slice(5)}</span>
            <span>
              {formatTokens(item.series.points.reduce((sum, point) => sum + point.tokens, 0))}{" "}
              tokens
            </span>
            <span>{item.series.points.at(-1)?.day.slice(5)}</span>
          </div>
          <p className="glance-token-note">
            近 7 天 · {item.series.estimated ? "线程累计量估算" : "本机计数 · 含无归属记录"}
            {item.series.limited ? " · 统计不完整" : ""}
          </p>
        </CardContent>
      </Card>
    );
  }
  const reset = item.metrics?.find((entry) => entry.id === "reset:available");
  return (
    <Card className="glance-reset-block" density="compact" aria-label={definition.title}>
      <CardHeader>
        <CardTitle>
          <Ticket aria-hidden="true" />
          重置卡
        </CardTitle>
        {actions}
      </CardHeader>
      <CardContent className="glance-reset-content">
        <strong>{reset?.value ?? "数量未知"}</strong>
        <p className="glance-token-note">在主窗口核对并兑换</p>
      </CardContent>
    </Card>
  );
}

/** Reads only the shared public projection; card identity and order never depend on adjacency. */
export function GlanceBoard({ layout, ...props }: BoardProps & { layout?: GlanceLayout }) {
  const { snapshot, now, busy = false, onOpen, onAppearanceAction } = props;
  const blocks = (layout ?? snapshot.layout ?? defaultGlanceLayout).blocks;
  const usage = blocks.some((id) => id.startsWith("usage."))
    ? snapshot.items.find((item) => item.id === "usage")
    : undefined;
  // Recovery stays ahead of the saved Card order, including unselected sources.
  const failures = snapshot.items.filter((item) => item.phase === "error");
  return (
    <div className="glance-board">
      {failures.map((item) => (
        <Alert key={item.id} variant="destructive">
          <AlertTitle>{item.title}需要处理</AlertTitle>
          <AlertDescription>
            <p>{item.description}</p>
            <Button variant="ghost" size="sm" disabled={busy} onClick={() => onOpen(item.page)}>
              前往处理
              <ArrowUpRight />
            </Button>
            {item.appearanceAction && onAppearanceAction && (
              <Button
                size="sm"
                disabled={busy || item.busy}
                onClick={() => onAppearanceAction(item.appearanceAction!)}
              >
                {appearanceQuickActionLabels[item.appearanceAction]}
              </Button>
            )}
          </AlertDescription>
        </Alert>
      ))}
      {usage?.phase === "running" && (usage.identity || usage.capturedAt !== undefined) && (
        <div className="glance-account" aria-label="用量账号与更新时间">
          <div>
            <strong>{usage.identity?.label ?? "服务额度记录"}</strong>
            {usage.identity && <span>{usage.identity.plan}</span>}
          </div>
          {usage.capturedAt !== undefined && (
            <p title={`读取于 ${shortDateTime(usage.capturedAt)}`}>
              {freshnessLabel(usage.capturedAt, now)}
              {now - usage.capturedAt > 600_000 ||
              usage.metrics?.some(
                (entry) =>
                  entry.resetsAt !== undefined && entry.resetsAt !== null && entry.resetsAt <= now,
              )
                ? " · 请刷新确认"
                : ""}
            </p>
          )}
        </div>
      )}
      {usage?.phase === "running" && !usage.metrics?.length && !usage.series?.points.length && (
        <output className="glance-source-status">{usage.description}</output>
      )}
      {!blocks.length && (
        <Card density="compact" className="glance-block-unavailable">
          <CardHeader>
            <CardTitle>速览由你决定</CardTitle>
          </CardHeader>
          <CardContent>
            <p>在功能面板点击图钉添加信息，再在这里拖动卡片排序。</p>
          </CardContent>
        </Card>
      )}
      <div className="glance-card-list">
        {blocks.map((id) => (
          <GlanceSortableBlock key={id} id={id}>
            {(handle) => <GlanceBlockCard {...props} id={id} handle={handle} />}
          </GlanceSortableBlock>
        ))}
      </div>
    </div>
  );
}
