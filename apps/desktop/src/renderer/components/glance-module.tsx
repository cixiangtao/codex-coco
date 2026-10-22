import { ArrowUpRight, Palette, Activity, TriangleAlert } from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent } from "@codex-coco/ui/components/card";
import { Badge } from "@codex-coco/ui/components/badge";
import { Button } from "@codex-coco/ui/components/button";
import type { GlanceItem, GlancePhase } from "../../contracts/glance";
const phaseLabels: Record<GlancePhase, string> = {
  unavailable: "尚未接入",
  disabled: "已停用",
  starting: "启动中",
  running: "运行中",
  stopping: "停止中",
  error: "需要处理",
};
export function GlanceModule({
  item,
  busy,
  onOpen,
}: {
  item: GlanceItem;
  busy: boolean;
  onOpen(): void;
}) {
  const statistics = item.phase === "error" ? [] : (item.metrics ?? []);
  return (
    <Card className="glance-item" data-phase={item.phase} density="compact" aria-label={item.title}>
      <CardHeader>
        <div className="glance-module-title">
          {item.phase === "error" ? (
            <TriangleAlert aria-hidden="true" />
          ) : item.id === "appearance" ? (
            <Palette aria-hidden="true" />
          ) : (
            <Activity aria-hidden="true" />
          )}
          <CardTitle>{item.title}</CardTitle>
        </div>
        <Badge
          tone={
            item.phase === "error" ? "danger" : item.phase === "running" ? "success" : "neutral"
          }
        >
          {phaseLabels[item.phase]}
        </Badge>
        {item.phase !== "error" && (
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label={`打开${item.title}`}
            title={item.description}
            disabled={busy}
            onClick={() => {
              onOpen();
            }}
          >
            <ArrowUpRight />
          </Button>
        )}
      </CardHeader>
      {(item.phase === "error" || statistics.length > 0 || item.phase === "running") && (
        <CardContent>
          {(item.phase === "error" || item.phase === "running") && <p>{item.description}</p>}
          {statistics.length > 0 && (
            <dl className="glance-statistics">
              {statistics.map((metric) => (
                <div key={metric.id}>
                  <dt>{metric.label}</dt>
                  <dd>
                    <strong>{metric.value}</strong>
                    <span>{metric.detail}</span>
                  </dd>
                </div>
              ))}
            </dl>
          )}
        </CardContent>
      )}
      {item.phase === "error" && (
        <Button
          variant="ghost"
          className="glance-module-open"
          disabled={busy}
          onClick={() => {
            onOpen();
          }}
        >
          前往处理
          <ArrowUpRight data-icon="inline-end" />
        </Button>
      )}
    </Card>
  );
}
