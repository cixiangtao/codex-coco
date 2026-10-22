import type { ComponentProps } from "react";
import { cn } from "cn";
import type { SurfaceTone } from "./card";

export function Badge({
  className,
  tone = "neutral",
  ...props
}: ComponentProps<"span"> & { tone?: SurfaceTone | "danger" }) {
  return (
    <span data-slot="badge" data-tone={tone} className={cn("coco-badge", className)} {...props} />
  );
}
