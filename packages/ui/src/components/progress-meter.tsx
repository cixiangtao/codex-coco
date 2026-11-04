import type { ComponentProps } from "react";
import { cn } from "cn";
import type { SurfaceTone } from "./card";

/** A quiet capacity track with native meter semantics; unknown is never measured zero. */
export function ProgressMeter({
  value,
  label,
  tone = "primary",
  className,
  ...props
}: Omit<ComponentProps<"div">, "children"> & {
  value: number | null;
  label: string;
  tone?: SurfaceTone | "danger";
}) {
  const capacity =
    value !== null && Number.isFinite(value) ? Math.min(100, Math.max(0, value)) : null;
  return (
    <div {...props} className={cn("coco-progress-meter", className)} data-tone={tone}>
      {capacity === null ? (
        <span className="sr-only">{label}：暂无数据</span>
      ) : (
        <meter
          className="sr-only"
          min={0}
          max={100}
          value={capacity}
          aria-label={label}
          aria-valuetext={`剩余 ${Number(capacity.toFixed(1))}%`}
        />
      )}
      <span aria-hidden="true" style={{ transform: `scaleX(${(capacity ?? 0) / 100})` }} />
    </div>
  );
}
