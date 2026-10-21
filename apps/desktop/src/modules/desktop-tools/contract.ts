import { z } from "zod";
import { imageAssetIdSchema } from "../../contracts/media";
export const bundledTrayIcons = [
  { id: "builtin:mongmong", title: "萌萌兔" },
  { id: "builtin:cat", title: "猫砸键盘" },
  { id: "builtin:gojo_satoru", title: "五条悟" },
  { id: "builtin:pink_cat", title: "粉色猫猫" },
  { id: "builtin:zhiyin_basketball", title: "只因篮球" },
  { id: "builtin:big_mouse_frog", title: "大嘴青蛙" },
  { id: "builtin:xiaolan_turn", title: "小蓝转圈" },
  { id: "builtin:karby", title: "星之卡比" },
  { id: "builtin:txbb", title: "天线宝宝" },
  { id: "builtin:zhiyin", title: "只因铁山靠" },
  { id: "builtin:3body", title: "金凯瑞摇" },
  { id: "builtin:baby_circle", title: "可爱小圈圈" },
  { id: "builtin:cat2", title: "猫砸键盘盘" },
  { id: "builtin:cat3", title: "猫猫摇爪" },
  { id: "builtin:color_worm", title: "彩虹毛毛虫" },
  { id: "builtin:everonecat0", title: "Everyone Cat" },
  { id: "builtin:hoshiguma", title: "星熊警官" },
  { id: "builtin:jerry", title: "Jerry" },
  { id: "builtin:my0", title: "BenignX" },
] as const;
export const nativeTrayIcons = [
  { id: "grid", title: "模块网格" },
  { id: "adaptive", title: "额度进度" },
  { id: "bot", title: "像素机器人" },
  { id: "spark", title: "像素星光" },
  { id: "pulse", title: "像素脉冲" },
  { id: "pixel-cat", title: "像素猫" },
  { id: "pixel-ghost", title: "像素幽灵" },
] as const;
export const trayIconIdSchema = z.union([
  z.enum(["grid", "adaptive", "bot", "spark", "pulse", "pixel-cat", "pixel-ghost"]),
  z.enum(bundledTrayIcons.map((value) => value.id)),
  imageAssetIdSchema,
]);
export const desktopToolsConfigSchema = z.strictObject({
  launchAtLogin: z.boolean(),
  iconId: trayIconIdSchema,
  animate: z.boolean(),
  followsCpu: z.boolean(),
  speed: z.number().min(0.5).max(3),
  iconSpeeds: z
    .record(trayIconIdSchema, z.number().min(0.5).max(3))
    .refine((value) => Object.keys(value).length <= 80),
  customIcons: z
    .array(z.strictObject({ id: imageAssetIdSchema, title: z.string().min(1).max(80) }))
    .max(40),
  shareWidgetSnapshot: z.boolean(),
});
export type DesktopToolsConfig = z.infer<typeof desktopToolsConfigSchema>;
export const desktopToolsDefaults: DesktopToolsConfig = {
  launchAtLogin: false,
  iconId: "grid",
  animate: false,
  followsCpu: false,
  speed: 1,
  iconSpeeds: {},
  customIcons: [],
  shareWidgetSnapshot: false,
};
export const trayFramesSchema = z.strictObject({
  frames: z
    .array(z.strictObject({ png: z.string().max(100_000), delay: z.number().min(16).max(10_000) }))
    .min(1)
    .max(300),
});
export type TrayFrames = z.infer<typeof trayFramesSchema>;
export const desktopToolsResultSchema = z.strictObject({
  status: z.enum(["ready", "error"]),
  reason: z
    .enum(["IMAGE_INVALID", "IMAGE_MISSING", "SYSTEM_UNAVAILABLE", "APPLY_FAILED"])
    .nullable(),
  loginSupported: z.boolean(),
  openAtLogin: z.boolean(),
  imported: imageAssetIdSchema.nullable(),
  preview: z.string().max(200_000).nullable(),
  frameCount: z.number().int().min(0).max(300),
  sharing: z.boolean(),
});
export const desktopToolsInputSchema = z.strictObject({});
export const removeTrayIconSchema = z.strictObject({ id: imageAssetIdSchema });
