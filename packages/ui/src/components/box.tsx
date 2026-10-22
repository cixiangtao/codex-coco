import type { ComponentProps } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "cn";

const boxVariants = cva("coco-box", {
  variants: {
    layout: { stack: "flex flex-col", row: "flex flex-row items-center", grid: "grid" },
    gap: { none: "gap-0", xs: "gap-1", sm: "gap-2", md: "gap-3", lg: "gap-4" },
    padding: { none: "p-0", sm: "p-3", md: "p-4", lg: "p-5" },
  },
  defaultVariants: { layout: "stack", gap: "md", padding: "none" },
});

/** Layout only. Surface, elevation and color belong to Card. */
export function Box({
  className,
  layout,
  gap,
  padding,
  ...props
}: ComponentProps<"div"> & VariantProps<typeof boxVariants>) {
  return (
    <div
      data-slot="box"
      className={cn(boxVariants({ layout, gap, padding }), className)}
      {...props}
    />
  );
}
