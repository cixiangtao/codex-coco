import { z } from "zod";

import { imageAssetIdSchema as assetIdSchema } from "../../contracts/media";
export { imageAssetIdSchema as assetIdSchema } from "../../contracts/media";
const layerSchema = z.strictObject({
  enabled: z.boolean(),
  image: assetIdSchema.nullable(),
  size: z.number().int().min(80).max(1200),
  x: z.number().min(0).max(100),
  y: z.number().min(0).max(100),
  blur: z.number().min(0).max(30),
  opacity: z.number().min(0).max(1),
});
export const appearanceLookSchema = z.strictObject({
  port: z.number().int().min(1024).max(65535),
  wallpaper: z.strictObject({
    enabled: z.boolean(),
    image: assetIdSchema.nullable(),
    fit: z.enum(["cover", "contain"]),
    x: z.number().min(0).max(100),
    y: z.number().min(0).max(100),
    transparency: z.number().min(0).max(1),
  }),
  main: layerSchema,
  sidebar: layerSchema,
});
export const appearanceConfigSchema = appearanceLookSchema.extend({
  portMode: z.enum(["fixed", "auto"]).default("fixed"),
  restoreOnEnable: z.boolean().default(false),
  presets: z
    .array(
      z.strictObject({
        id: z.uuid(),
        title: z.string().trim().min(1).max(60),
        look: appearanceLookSchema,
      }),
    )
    .max(12)
    .default([]),
});
export const galleryItemSchema = z.strictObject({
  id: assetIdSchema,
  title: z.string().max(80),
  layer: z.enum(["wallpaper", "main", "sidebar"]).nullable(),
  builtin: z.boolean(),
  preview: z.string().max(24_000),
});
export type GalleryItem = z.infer<typeof galleryItemSchema>;
export type AppearanceConfig = z.infer<typeof appearanceConfigSchema>;
export const appearanceDefaults: AppearanceConfig = {
  port: 9229,
  portMode: "fixed",
  restoreOnEnable: false,
  presets: [],
  wallpaper: { enabled: false, image: null, fit: "cover", x: 50, y: 50, transparency: 1 },
  main: { enabled: false, image: null, size: 360, x: 82, y: 76, blur: 0, opacity: 1 },
  sidebar: { enabled: false, image: null, size: 240, x: 50, y: 80, blur: 0, opacity: 0.24 },
};
export const appearanceFailureSchema = z.enum([
  "APP_NOT_SELECTED",
  "APP_RUNNING",
  "LAUNCH_FAILED",
  "IMAGE_IN_USE",
  "NOT_CONNECTED",
  "INVALID_TARGET",
  "IMAGE_INVALID",
  "IMAGE_MISSING",
  "NO_IMAGES",
  "APPLY_FAILED",
  "RESTORE_FAILED",
  "REMOVE_FIRST",
]);
export type AppearanceFailure = z.infer<typeof appearanceFailureSchema>;
export const appearanceFailures: Record<AppearanceFailure, string> = {
  APP_NOT_SELECTED: "请先选择 Codex 应用。",
  APP_RUNNING: "所选应用仍在运行。请保存工作后使用明确重启，或手动关闭后再启动。",
  LAUNCH_FAILED: "应用启动未完成，请检查所选应用与系统权限。",
  IMAGE_IN_USE: "这张图片仍被图层或预设使用，请先解除选择。",
  NOT_CONNECTED: "无法连接本机调试端口，请先为 Codex 开启远程调试。",
  INVALID_TARGET: "调试端口没有可识别的 Codex 主窗口。",
  IMAGE_INVALID: "图片无法导入，请选择不超过 25 MiB 的 PNG、JPEG、WebP、GIF 或 AVIF 文件。",
  IMAGE_MISSING: "已选图片不存在，请重新导入。",
  NO_IMAGES: "请先为至少一个已启用的图层选择图片。",
  APPLY_FAILED: "布景应用未完成，请检查连接后重试或撤销。",
  RESTORE_FAILED: "部分窗口尚未确认撤销，请恢复连接后再次撤销。",
  REMOVE_FIRST: "请先撤销原端口上的布景，再连接另一个端口。",
};
export const appearanceResultSchema = z.strictObject({
  status: z.enum(["ready", "error"]),
  active: z.boolean(),
  targets: z.number().int().nonnegative(),
  checkedAt: z.number().int().nonnegative(),
  reason: appearanceFailureSchema.nullable(),
  appSelected: z.boolean().default(false),
  connectedPort: z.number().int().nullable().default(null),
  gallery: z.array(galleryItemSchema).max(60).default([]),
  imported: assetIdSchema.nullable(),
  preview: z.string().max(400_000).nullable(),
});
export type AppearanceResult = z.infer<typeof appearanceResultSchema>;
export const emptyAppearanceInput = z.strictObject({});
export const assetInputSchema = z.strictObject({ id: assetIdSchema });
