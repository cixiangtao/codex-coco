import { Tabs as TabsPrimitive } from "@base-ui/react/tabs";
import { cn } from "cn";

export function Tabs({ className, ...props }: TabsPrimitive.Root.Props) {
  return <TabsPrimitive.Root data-slot="tabs" className={cn("coco-tabs", className)} {...props} />;
}
export function TabsList({ className, ...props }: TabsPrimitive.List.Props) {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      className={cn("coco-tabs-list", className)}
      {...props}
    />
  );
}
export function TabsTrigger({ className, ...props }: TabsPrimitive.Tab.Props) {
  return (
    <TabsPrimitive.Tab
      data-slot="tabs-trigger"
      className={cn("coco-tabs-trigger", className)}
      {...props}
    />
  );
}
export function TabsContent({ className, ...props }: TabsPrimitive.Panel.Props) {
  return (
    <TabsPrimitive.Panel
      data-slot="tabs-content"
      keepMounted
      className={cn("coco-tabs-content", className)}
      {...props}
    />
  );
}
