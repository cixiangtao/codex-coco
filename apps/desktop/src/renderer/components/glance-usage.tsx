import { ArrowUpRight, Clock3, UserRound } from "lucide-react";
import { Card, CardHeader, CardContent } from "@codex-coco/ui/components/card";
import { Badge } from "@codex-coco/ui/components/badge";
import { Button } from "@codex-coco/ui/components/button";
import { ProgressRing } from "@codex-coco/ui/components/progress-ring";
import type { GlanceItem } from "../../contracts/glance";
import { freshnessLabel, recoveryLabel, shortDateTime } from "../lib/presentation-time";

/** A monitor composed only from the read-only, validated public projection. */
export function GlanceUsage({
  item,
  now,
  busy,
  onOpen,
}: {
  item: GlanceItem;
  now: number;
  busy: boolean;
  onOpen(): void;
}) {
  const capacities = item.metrics?.filter((metric) => metric.progress !== undefined) ?? [];
  const statistics =
    item.metrics?.filter((metric) => metric.progress === undefined && metric.unit === "tokens") ??
    [];
  const extras =
    item.metrics?.filter((metric) => metric.progress === undefined && metric.unit !== "tokens") ??
    [];
  const groups = new Map<string, typeof capacities>();
  const stale =
    item.capturedAt !== undefined &&
    (now - item.capturedAt > 10 * 60_000 ||
      capacities.some(
        (metric) =>
          metric.resetsAt !== null && metric.resetsAt !== undefined && metric.resetsAt <= now,
      ));
  for (const metric of capacities) {
    const group = metric.group ?? "订阅额度";
    groups.set(group, [...(groups.get(group) ?? []), metric]);
  }
  return (
    <Card className="glance-monitor" aria-label={item.title} density="compact">
      <CardHeader className="glance-monitor-heading">
        <div className="glance-identity">
          <span className="glance-avatar">
            <UserRound aria-hidden="true" />
          </span>
          <div>
            <h2>{item.identity?.label ?? item.title}</h2>
            {item.identity ? (
              <Badge tone="primary">{item.identity.plan}</Badge>
            ) : (
              <p>{item.description}</p>
            )}
          </div>
        </div>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label={`打开${item.title}`}
          disabled={busy}
          onClick={onOpen}
        >
          <ArrowUpRight />
        </Button>
      </CardHeader>
      <CardContent>
        <div className="glance-capacity-groups">
          {[...groups].map(([group, metrics]) => (
            <section key={group} aria-label={group}>
              {groups.size > 1 && <h3 className="glance-group-title">{group}</h3>}
              <div className="glance-quota-grid">
                {metrics.map((metric, index) => {
                  const tone =
                    metric.progress! <= 5 ? "warning" : index % 2 === 0 ? "primary" : "success";
                  return (
                    <div key={metric.id} className="glance-quota" data-tone={tone}>
                      <h3>
                        {metric.label.startsWith(`${group} · `)
                          ? metric.label.slice(group.length + 3)
                          : metric.label}
                      </h3>
                      <ProgressRing
                        value={metric.progress!}
                        label={metric.label}
                        valuePrefix="剩余"
                        caption="剩余额度"
                        size="sm"
                        tone={tone}
                      />
                      <div className="glance-quota-reset">
                        <Clock3 aria-hidden="true" />
                        <span>
                          {metric.resetsAt === undefined
                            ? metric.detail
                            : recoveryLabel(metric.resetsAt, now)}
                        </span>
                      </div>
                      {metric.resetsAt !== null && metric.resetsAt !== undefined && (
                        <time dateTime={new Date(metric.resetsAt).toISOString()}>
                          {shortDateTime(metric.resetsAt)}
                        </time>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
        {statistics.length > 0 && (
          <div className="glance-activity">
            <div className="glance-section-label">
              <h3>本机用量</h3>
              <span>tokens · 含无归属记录</span>
            </div>
            <dl className="glance-statistics">
              {statistics.map((metric) => (
                <div key={metric.id}>
                  <dt>{metric.label}</dt>
                  <dd title={`${metric.value} · ${metric.detail}`}>
                    <strong>
                      {metric.numericValue === undefined
                        ? metric.value
                        : new Intl.NumberFormat("en", {
                            notation: "compact",
                            maximumFractionDigits: 1,
                          }).format(metric.numericValue)}
                    </strong>
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        )}
        {extras.length > 0 && (
          <dl className="glance-extra">
            {extras.map((metric) => (
              <div key={metric.id} title={metric.detail}>
                <dt>{metric.label}</dt>
                <dd>{metric.value}</dd>
              </div>
            ))}
          </dl>
        )}
        {item.capturedAt !== undefined && (
          <p
            className="glance-captured"
            data-stale={stale}
            title={`读取于 ${shortDateTime(item.capturedAt)} · 请在主窗口刷新确认`}
          >
            <span aria-hidden="true" />
            {freshnessLabel(item.capturedAt, now)}
            <span>{stale ? "请刷新确认" : "服务额度记录"}</span>
          </p>
        )}
      </CardContent>
    </Card>
  );
}
