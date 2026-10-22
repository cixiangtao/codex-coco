import { Switch as SwitchPrimitive } from "@base-ui/react/switch";
import { cn } from "cn";

export function Switch({ className, ...props }: SwitchPrimitive.Root.Props) {
  return (
    <SwitchPrimitive.Root data-slot="switch" className={cn("coco-switch", className)} {...props}>
      <SwitchPrimitive.Thumb className="coco-switch-thumb" />
    </SwitchPrimitive.Root>
  );
}
