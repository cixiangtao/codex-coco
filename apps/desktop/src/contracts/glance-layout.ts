import { z } from "zod";
import type { MainPage } from "./windows";

/** Static public information blocks, separate from background module lifecycles. */
export const glanceBlocks = [
  { id: "usage.primary", moduleId: "usage", title: "主要额度窗口", page: "usage" },
  { id: "usage.secondary", moduleId: "usage", title: "其他额度窗口", page: "usage" },
  { id: "usage.today", moduleId: "usage", title: "今日消耗", page: "usage" },
  { id: "usage.week", moduleId: "usage", title: "近 7 天消耗", page: "usage" },
  { id: "usage.month", moduleId: "usage", title: "近 30 天消耗", page: "usage" },
  { id: "usage.trend", moduleId: "usage", title: "每日用量趋势", page: "usage" },
  { id: "usage.reset", moduleId: "usage", title: "重置卡", page: "usage" },
  { id: "appearance.status", moduleId: "appearance", title: "布景连接状态", page: "appearance" },
  {
    id: "desktop-tools.status",
    moduleId: "desktop-tools",
    title: "系统与菜单栏状态",
    page: "settings",
  },
] as const satisfies readonly { id: string; moduleId: string; title: string; page: MainPage }[];
export type GlanceBlockId = (typeof glanceBlocks)[number]["id"];
export const glanceBlockIdSchema = z.enum(glanceBlocks.map((block) => block.id));
export const glanceLayoutSchema = z.strictObject({
  blocks: z
    .array(glanceBlockIdSchema)
    .max(glanceBlocks.length)
    .refine((ids) => new Set(ids).size === ids.length),
});
export type GlanceLayout = z.infer<typeof glanceLayoutSchema>;
export const defaultGlanceLayout: GlanceLayout = {
  blocks: [
    "usage.primary",
    "usage.secondary",
    "usage.today",
    "usage.week",
    "usage.month",
    "appearance.status",
    "desktop-tools.status",
  ],
};
export const saveGlanceLayoutSchema = z.strictObject({
  expectedRevision: z.number().int().nonnegative(),
  value: glanceLayoutSchema,
});
export type SaveGlanceLayout = z.infer<typeof saveGlanceLayoutSchema>;
/** Popovers may only permute the currently saved selection. */
export const reorderGlanceLayoutSchema = z.strictObject({
  expectedRevision: z.number().int().nonnegative(),
  blocks: glanceLayoutSchema.shape.blocks,
});
export type ReorderGlanceLayout = z.infer<typeof reorderGlanceLayoutSchema>;
export interface GlanceLayoutSnapshot {
  revision: number;
  value: GlanceLayout;
  health: "ok" | "missing" | "invalid" | "future-version" | "unavailable";
}
