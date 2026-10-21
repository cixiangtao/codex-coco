import type { MainPage } from "../../contracts/windows";
import { Activity, Layers3, Palette, Settings2 } from "lucide-react";

/** Stable page identifiers stay independent of runtime module IDs and IPC channels. */
export const navigation = [
  { id: "usage", label: "用量", icon: Activity, group: "primary" },
  { id: "appearance", label: "外观", icon: Palette, group: "primary" },
  { id: "modules", label: "模块管理", icon: Layers3, group: "utility" },
  { id: "settings", label: "设置", icon: Settings2, group: "utility" },
] as const;
export type PageId = MainPage;
