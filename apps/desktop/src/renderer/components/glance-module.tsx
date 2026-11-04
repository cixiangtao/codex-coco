import type { ReactNode } from "react";
import { formatTokens } from "../lib/token-format";
import { ArrowUpRight, Palette, Activity, TriangleAlert, Info } from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent } from "@codex-coco/ui/components/card";
import { Button } from "@codex-coco/ui/components/button";
import { Tooltip, TooltipTrigger, TooltipContent } from "@codex-coco/ui/components/tooltip";
import {
  appearanceQuickActionLabels,
  type AppearanceQuickAction,
  type GlanceItem,
  type GlancePhase,
} from "../../contracts/glance";
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
  onAppearanceAction,
  handle,
}: {
  item: GlanceItem;
  busy: boolean;
  onOpen(): void;
  onAppearanceAction?: ((action: AppearanceQuickAction) => void) | undefined;
  handle?: ReactNode;
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
        <span className="glance-phase" data-phase={item.phase}>
          {item.busy ? "处理中" : phaseLabels[item.phase]}
        </span>
        <div className="glance-card-actions">
          <Tooltip>
            <TooltipTrigger
              render={<Button variant="ghost" size="icon-xs" />}
              aria-label={`${item.title}状态详情`}
            >
              <Info />
            </TooltipTrigger>
            <TooltipContent side="bottom">{item.description}</TooltipContent>
          </Tooltip>
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
          {handle}
        </div>
      </CardHeader>
      {(item.phase === "error" || statistics.length > 0 || item.busy || item.appearanceAction) && (
        <CardContent>
          <p>{item.description}</p>
          {statistics.length > 0 && (
            <dl className="glance-statistics">
              {statistics.map((metric) => (
                <div key={metric.id}>
                  <dt>{metric.label}</dt>
                  <dd>
                    <strong>
                      {metric.unit === "tokens" && metric.numericValue !== undefined
                        ? `${formatTokens(metric.numericValue)} tokens`
                        : metric.value}
                    </strong>
                    <span>{metric.detail}</span>
                  </dd>
                </div>
              ))}
            </dl>
          )}
        </CardContent>
      )}
      {item.appearanceAction && onAppearanceAction && (
        <Button
          size="sm"
          disabled={busy || item.busy}
          onClick={() => onAppearanceAction(item.appearanceAction!)}
        >
          {appearanceQuickActionLabels[item.appearanceAction]}
        </Button>
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
