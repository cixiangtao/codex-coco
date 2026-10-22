import type { ComponentProps } from "react";
import { cn } from "cn";

export function Skeleton({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      aria-hidden="true"
      className={cn("coco-skeleton", className)}
      {...props}
    />
  );
}
