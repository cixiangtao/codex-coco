import type { ComponentProps } from "react";
import { cn } from "cn";

export type SurfaceTone = "neutral" | "primary" | "success" | "warning";

/** A functional surface: consistent corners, inset, elevation and optional data tone. */
export function Card({
  className,
  tone = "neutral",
  density = "default",
  ...props
}: ComponentProps<"section"> & { tone?: SurfaceTone; density?: "default" | "compact" }) {
  return (
    <section
      data-slot="card"
      data-tone={tone}
      data-density={density}
      className={cn("coco-card", className)}
      {...props}
    />
  );
}
export function CardHeader({ className, ...props }: ComponentProps<"header">) {
  return (
    <header data-slot="card-header" className={cn("coco-card-header", className)} {...props} />
  );
}
export function CardTitle({ className, children, ...props }: ComponentProps<"h3">) {
  return (
    <h3 data-slot="card-title" className={cn("coco-card-title", className)} {...props}>
      {children}
    </h3>
  );
}
export function CardDescription({ className, ...props }: ComponentProps<"p">) {
  return (
    <p data-slot="card-description" className={cn("coco-card-description", className)} {...props} />
  );
}
export function CardContent({ className, ...props }: ComponentProps<"div">) {
  return <div data-slot="card-content" className={cn("coco-card-content", className)} {...props} />;
}
export function CardFooter({ className, ...props }: ComponentProps<"footer">) {
  return (
    <footer data-slot="card-footer" className={cn("coco-card-footer", className)} {...props} />
  );
}
