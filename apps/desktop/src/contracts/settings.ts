import { z } from "zod";
import {
  defaultTheme,
  normalizePrimaryColor,
  themeModes,
  themePresetIds,
} from "@codex-coco/ui/theme/contract";

export const themeSchema = z.strictObject({
  mode: z.enum(themeModes),
  presetId: z.enum(themePresetIds),
  primaryColor: z
    .string()
    .transform((value, context) => {
      const color = normalizePrimaryColor(value);
      if (color === null) {
        context.addIssue({ code: "custom", message: "请输入有效的 HEX 颜色" });
        return z.NEVER;
      }
      return color;
    })
    .nullable(),
});
export const settingsSchema = z.strictObject({
  schemaVersion: z.literal(1),
  revision: z.number().int().nonnegative(),
  theme: themeSchema,
});
export const saveThemeSchema = z.strictObject({
  expectedRevision: z.number().int().nonnegative(),
  theme: themeSchema,
});
export type Settings = z.infer<typeof settingsSchema>;
export type SaveThemeInput = z.infer<typeof saveThemeSchema>;
export type SettingsHealth = "ok" | "missing" | "invalid" | "future-version";
export interface SettingsSnapshot {
  settings: Settings;
  health: SettingsHealth;
}

/** Each caller receives a fresh default; configuration ownership belongs to the host. */
export function createDefaultSettings(): Settings {
  return { schemaVersion: 1, revision: 0, theme: { ...defaultTheme } };
}
