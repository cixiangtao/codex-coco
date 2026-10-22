import type { ComponentProps } from "react";
import { cn } from "cn";
import type { SurfaceTone } from "./card";

interface ProgressRingProps extends Omit<ComponentProps<"div">, "children"> {
  value: number | null;
  label: string;
  caption?: string;
  valuePrefix?: string;
  tone?: SurfaceTone | "danger";
  size?: "sm" | "md";
  animated?: boolean;
}

/** Capacity geometry is numeric; unknown values never become a fabricated zero. */
export function ProgressRing({
  value,
  label,
  caption,
  valuePrefix = "",
  tone = "primary",
  size = "md",
  animated = true,
  className,
  ...props
}: ProgressRingProps) {
  const capacity =
    value !== null && Number.isFinite(value) ? Math.min(100, Math.max(0, value)) : null;
  const text = capacity === null ? "—" : `${Number(capacity.toFixed(1))}%`;
  return (
    <div
      {...props}
      className={cn("coco-progress-ring", className)}
      data-slot="progress-ring"
      data-tone={tone}
      data-size={size}
      data-animated={animated}
      data-empty={capacity === null || capacity === 0}
    >
      {capacity === null ? (
        <span className="sr-only">{label}：暂无数据</span>
      ) : (
        <meter
          className="sr-only"
          min={0}
          max={100}
          value={capacity}
          aria-label={label}
          aria-valuetext={`${valuePrefix} ${text}`.trim()}
        />
      )}
      <svg viewBox="0 0 100 100" aria-hidden="true">
        <circle cx="50" cy="50" r="42" className="coco-ring-track" />
        <circle
          cx="50"
          cy="50"
          r="42"
          pathLength="100"
          strokeDasharray="100 100"
          strokeDashoffset={100 - (capacity ?? 0)}
          className="coco-ring-value"
        />
      </svg>
      <div className="coco-ring-label" aria-hidden="true">
        <strong>
          {valuePrefix && <span className="sr-only">{valuePrefix} </span>}
          {text}
        </strong>
        {caption && <span>{caption}</span>}
      </div>
    </div>
  );
}
