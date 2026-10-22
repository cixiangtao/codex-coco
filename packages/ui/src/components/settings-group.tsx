import type { ComponentProps, ReactNode } from "react";
import { cn } from "cn";
import { Field } from "./field";

/** Inset settings list. It owns grouping and dividers, never application persistence. */
export function SettingsGroup({
  title,
  description,
  children,
  className,
  ...props
}: Omit<ComponentProps<"fieldset">, "title"> & { title?: ReactNode; description?: ReactNode }) {
  return (
    <fieldset
      data-slot="settings-group"
      className={cn("coco-settings-group", className)}
      {...props}
    >
      {title && <legend>{title}</legend>}
      <div className="coco-settings-group-body">{children}</div>
      {description && <p className="coco-settings-group-note">{description}</p>}
    </fieldset>
  );
}
/** Existing FieldLabel / FieldDescription semantics remain attached to their controls. */
export function SettingsRow({
  className,
  layout = "inline",
  ...props
}: ComponentProps<typeof Field> & { layout?: "inline" | "stacked" }) {
  return (
    <Field
      data-slot="settings-row"
      data-layout={layout}
      className={cn("coco-settings-row", className)}
      {...props}
    />
  );
}
