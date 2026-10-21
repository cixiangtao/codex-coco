import { z } from "zod";
export const updatePreferencesSchema = z.strictObject({
  source: z
    .string()
    .max(2048)
    .refine((value) => {
      if (!value) return true;
      return (
        z.url().safeParse(value).success &&
        value.startsWith("https://") &&
        !/[?#@\s]/.test(value) &&
        value.endsWith("/")
      );
    }, "请使用以 / 结尾且不含凭据的 HTTPS 更新目录。"),
  intervalHours: z.union([z.literal(0), z.number().int().min(4).max(168)]),
});
export type UpdatePreferences = z.infer<typeof updatePreferencesSchema>;
export const updateDefaults: UpdatePreferences = { source: "", intervalHours: 0 };
export const saveUpdatePreferencesSchema = z.strictObject({
  expectedRevision: z.number().int().nonnegative(),
  value: updatePreferencesSchema,
});
export type SaveUpdatePreferences = z.infer<typeof saveUpdatePreferencesSchema>;
export const updateActionSchema = z.discriminatedUnion("action", [
  z.strictObject({ action: z.enum(["check", "download", "cancel", "reset"]) }),
  z.strictObject({ action: z.literal("install"), confirmed: z.literal(true) }),
]);
export type UpdateAction = z.infer<typeof updateActionSchema>;
export const updateSnapshotSchema = z.strictObject({
  revision: z.number().int().nonnegative(),
  preferences: updatePreferencesSchema,
  currentVersion: z.string().max(80),
  phase: z.enum([
    "unconfigured",
    "idle",
    "checking",
    "available",
    "up-to-date",
    "downloading",
    "cancelling",
    "downloaded",
    "installing",
    "unsupported",
    "error",
  ]),
  reason: z
    .enum([
      "SOURCE_UNCONFIGURED",
      "SIGNED_INSTALL_REQUIRED",
      "CHECK_FAILED",
      "DOWNLOAD_FAILED",
      "INSTALL_FAILED",
      "SETTINGS_UNAVAILABLE",
    ])
    .nullable(),
  availableVersion: z.string().max(80).nullable(),
  progress: z.number().min(0).max(100).nullable(),
  checkedAt: z.number().int().nonnegative().nullable(),
});
export type UpdateSnapshot = z.infer<typeof updateSnapshotSchema>;
