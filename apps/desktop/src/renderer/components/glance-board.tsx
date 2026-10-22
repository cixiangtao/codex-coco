import { ArrowUpRight, Activity, ChartNoAxesColumn, Clock3, Ticket } from "lucide-react";
import { Button } from "@codex-coco/ui/components/button";
import { Card, CardHeader, CardContent, CardTitle } from "@codex-coco/ui/components/card";
import { ProgressRing } from "@codex-coco/ui/components/progress-ring";
import type { GlanceItem, GlanceSnapshot } from "../../contracts/glance";
import {
  glanceBlocks,
  defaultGlanceLayout,
  type GlanceLayout,
  type GlanceBlockId,
} from "../../contracts/glance-layout";
import type { MainPage } from "../../contracts/windows";
import { GlanceModule } from "./glance-module";
import { formatTokens, formatExactTokens } from "../lib/token-format";
import { freshnessLabel, recoveryLabel, shortDateTime } from "../lib/presentation-time";

const statusIds: readonly GlanceBlockId[] = ["appearance.status", "desktop-tools.status"];
const quotaIds: readonly GlanceBlockId[] = ["usage.primary", "usage.secondary"];
const tokenIds: readonly GlanceBlockId[] = ["usage.today", "usage.week", "usage.month"];

function Unavailable({
  title,
  item,
  onOpen,
  actionLabel = "打开用量",
  busy = false,
}: {
  title: string;
  item?: GlanceItem | undefined;
  onOpen(): void;
  actionLabel?: string;
  busy?: boolean;
}) {
  return (
    <Card className="glance-block-unavailable" density="compact">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label={actionLabel}
          disabled={busy}
          onClick={onOpen}
        >
          <ArrowUpRight />
        </Button>
      </CardHeader>
      <CardContent>
        <p>
          {item?.phase === "disabled"
            ? "来源模块已停用"
            : item?.phase === "error"
              ? "暂不可用，请先处理异常"
              : "暂未读取到数据"}
        </p>
      </CardContent>
    </Card>
  );
}

/** The same compact presenters power the saved panel and a window-local settings preview. */
export function GlanceBoard({
  snapshot,
  layout = snapshot.layout ?? defaultGlanceLayout,
  now,
  busy = false,
  onOpen,
}: {
  snapshot: GlanceSnapshot;
  layout?: GlanceLayout;
  now: number;
  busy?: boolean;
  onOpen(page: MainPage): void;
}) {
  const groups: GlanceBlockId[][] = [];
  for (const id of layout.blocks) {
    const previous = groups.at(-1);
    const family = quotaIds.includes(id)
      ? quotaIds
      : tokenIds.includes(id)
        ? tokenIds
        : statusIds.includes(id)
          ? statusIds
          : null;
    if (family && previous && previous.every((entry) => family.includes(entry))) previous.push(id);
    else groups.push([id]);
  }
  const pendingUsage = layout.blocks.some((id) => id.startsWith("usage."))
    ? snapshot.items.find(
        (item) =>
          item.id === "usage" &&
          item.phase === "running" &&
          !item.metrics?.length &&
          !item.series?.points.length,
      )
    : undefined;
  return (
    <div className="glance-board">
      {snapshot.items
        .filter((item) => item.phase === "error")
        .map((item) => (
          <GlanceModule key={item.id} item={item} busy={busy} onOpen={() => onOpen(item.page)} />
        ))}
      {pendingUsage && (
        <Card density="compact" aria-label="用量读取状态">
          <CardHeader>
            <CardTitle>用量状态</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="glance-token-note" aria-live="polite">
              {pendingUsage.description}
            </p>
          </CardContent>
        </Card>
      )}
      {!layout.blocks.length && (
        <Card density="compact" className="glance-block-unavailable">
          <CardHeader>
            <CardTitle>速览由你决定</CardTitle>
          </CardHeader>
          <CardContent>
            <p>在主窗口添加信息块，或在设置中选择默认组合。</p>
          </CardContent>
        </Card>
      )}
      {groups.map((ids) => {
        const definition = glanceBlocks.find((block) => block.id === ids[0])!;
        const item = snapshot.items.find((entry) => entry.id === definition.moduleId);
        const available = item?.phase === "running";
        const key = ids.join("+");
        if (definition.id.endsWith(".status"))
          return (
            <div key={key} className="glance-shortcuts">
              {ids.map((id) => {
                const block = glanceBlocks.find((entry) => entry.id === id)!;
                const status = snapshot.items.find((entry) => entry.id === block.moduleId);
                return status && status.phase !== "error" ? (
                  <GlanceModule
                    key={id}
                    item={status}
                    busy={busy}
                    onOpen={() => onOpen(block.page)}
                  />
                ) : null;
              })}
            </div>
          );
        if (!available)
          return (
            <Unavailable
              key={key}
              title={
                ids.length > 1
                  ? definition.moduleId === "usage" && quotaIds.includes(ids[0]!)
                    ? "订阅额度"
                    : "本机用量"
                  : definition.title
              }
              item={item}
              onOpen={() => onOpen(definition.page)}
              actionLabel={quotaIds.includes(ids[0]!) ? "打开用量" : `查看${definition.title}`}
              busy={busy}
            />
          );
        if (quotaIds.includes(ids[0]!)) {
          const metrics = ids.flatMap(
            (id) =>
              item.metrics?.filter(
                (metric) =>
                  metric.id.endsWith(id === "usage.primary" ? ":primary" : ":secondary") &&
                  metric.progress !== undefined,
              ) ?? [],
          );
          const capacityGroups = new Map<string, typeof metrics>();
          for (const metric of metrics) {
            const group = metric.group ?? "订阅额度";
            capacityGroups.set(group, [...(capacityGroups.get(group) ?? []), metric]);
          }
          if (!metrics.length)
            return (
              <Unavailable
                key={key}
                title="订阅额度"
                item={item}
                onOpen={() => onOpen("usage")}
                busy={busy}
              />
            );
          return (
            <Card key={key} className="glance-quota-block" density="compact" aria-label="订阅额度">
              <CardHeader>
                <div>
                  <CardTitle>订阅额度</CardTitle>
                  <div className="glance-block-account">
                    {item.identity
                      ? `${item.identity.label} · ${item.identity.plan}`
                      : "服务额度记录"}
                    {item.capturedAt !== undefined && (
                      <span
                        className="glance-block-freshness"
                        title={`读取于 ${shortDateTime(item.capturedAt)}`}
                      >
                        {freshnessLabel(item.capturedAt, now)}
                        {now - item.capturedAt > 600_000 ||
                        metrics.some(
                          (metric) =>
                            metric.resetsAt !== null &&
                            metric.resetsAt !== undefined &&
                            metric.resetsAt <= now,
                        )
                          ? " · 请刷新确认"
                          : ""}
                      </span>
                    )}
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  aria-label="打开用量"
                  disabled={busy}
                  onClick={() => onOpen("usage")}
                >
                  <ArrowUpRight />
                </Button>
              </CardHeader>
              <CardContent>
                <div className="glance-capacity-groups">
                  {[...capacityGroups].map(([group, entries]) => (
                    <section key={group} aria-label={group}>
                      {capacityGroups.size > 1 && <h3 className="glance-group-title">{group}</h3>}
                      <div
                        className="glance-quota-grid"
                        style={{
                          gridTemplateColumns: `repeat(${Math.min(entries.length, 2)}, minmax(0, 1fr))`,
                        }}
                      >
                        {entries.map((metric) => (
                          <div
                            key={metric.id}
                            className="glance-quota"
                            data-tone={
                              metric.progress! <= 5
                                ? "warning"
                                : metric.id.endsWith(":secondary")
                                  ? "success"
                                  : "primary"
                            }
                          >
                            <h3>
                              {metric.label.startsWith(`${group} · `)
                                ? metric.label.slice(group.length + 3)
                                : metric.label}
                            </h3>
                            <ProgressRing
                              size="sm"
                              value={metric.progress!}
                              label={metric.label}
                              valuePrefix="剩余"
                              caption="剩余额度"
                              tone={
                                metric.progress! <= 5
                                  ? "warning"
                                  : metric.id.endsWith(":secondary")
                                    ? "success"
                                    : "primary"
                              }
                            />
                            <span className="glance-quota-reset">
                              <Clock3 aria-hidden="true" />
                              {recoveryLabel(metric.resetsAt, now)}
                            </span>
                            {metric.resetsAt !== null && metric.resetsAt !== undefined && (
                              <time dateTime={new Date(metric.resetsAt).toISOString()}>
                                {shortDateTime(metric.resetsAt)}
                              </time>
                            )}
                          </div>
                        ))}
                      </div>
                    </section>
                  ))}
                </div>
              </CardContent>
            </Card>
          );
        }
        if (tokenIds.includes(ids[0]!)) {
          return (
            <Card key={key} className="glance-token-block" density="compact" aria-label="本机用量">
              <CardHeader>
                <CardTitle>
                  <Activity aria-hidden="true" /> 本机消耗
                </CardTitle>
                <span className="glance-block-unit">tokens</span>
              </CardHeader>
              <CardContent>
                <dl
                  className="glance-token-grid"
                  style={{ gridTemplateColumns: `repeat(${ids.length}, minmax(0, 1fr))` }}
                >
                  {ids.map((id, index) => {
                    const metric = item.metrics?.find(
                      (entry) => entry.id === `tokens:${id.split(".")[1]}`,
                    );
                    return (
                      <div
                        key={id}
                        data-tone={
                          index % 3 === 0 ? "primary" : index % 3 === 1 ? "success" : "warning"
                        }
                      >
                        <dt>{glanceBlocks.find((block) => block.id === id)!.title}</dt>
                        <dd title={`${formatExactTokens(metric?.numericValue)} tokens`}>
                          {formatTokens(metric?.numericValue)}
                        </dd>
                      </div>
                    );
                  })}
                </dl>
                <p className="glance-token-note">
                  {item.series?.estimated
                    ? "线程累计估算 · 含无归属记录"
                    : "本机记录 · 含无归属计数"}
                  {item.series?.limited ? " · 统计不完整" : ""}
                </p>
              </CardContent>
            </Card>
          );
        }
        if (definition.id === "usage.trend") {
          if (!item.series?.points.length)
            return (
              <Unavailable
                key={key}
                title={definition.title}
                item={item}
                onOpen={() => onOpen("usage")}
                actionLabel={`查看${definition.title}`}
                busy={busy}
              />
            );
          const maximum = Math.max(1, ...item.series.points.map((point) => point.tokens));
          return (
            <Card key={key} className="glance-trend-block" density="compact">
              <CardHeader>
                <CardTitle>
                  <ChartNoAxesColumn aria-hidden="true" /> 每日用量趋势
                </CardTitle>
                <span className="glance-block-unit">近 7 天</span>
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
                  {item.series.estimated ? "线程累计量估算" : "本机计数 · 含无归属记录"}
                  {item.series.limited ? " · 统计不完整" : ""}
                </p>
              </CardContent>
            </Card>
          );
        }
        const reset = item.metrics?.find((entry) => entry.id === "reset:available");
        return (
          <Card key={key} className="glance-reset-block" density="compact">
            <CardHeader>
              <CardTitle>
                <Ticket aria-hidden="true" /> 重置卡
              </CardTitle>
              <span>{reset?.value ?? "数量未知"}</span>
            </CardHeader>
            <CardContent>
              <p className="glance-token-note">在主窗口核对并兑换</p>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
