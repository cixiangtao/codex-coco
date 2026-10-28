import { z } from "zod";

/** Public release identity is fixed by the application, never supplied through IPC. */
export const updateRepository = { owner: "cixiangtao", repo: "codex-coco" } as const;
export const releasesUrl = `https://github.com/${updateRepository.owner}/${updateRepository.repo}/releases`;
export const latestReleaseApi = `https://api.github.com/repos/${updateRepository.owner}/${updateRepository.repo}/releases/latest`;
export const stableVersionSchema = z
  .string()
  .max(80)
  .regex(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/);
const releaseUrlSchema = z.string().refine((value) => {
  if (!value.startsWith(`${releasesUrl}/tag/`)) return false;
  return stableVersionSchema.safeParse(value.slice(`${releasesUrl}/tag/`.length).replace(/^v/, ""))
    .success;
});
export const releaseCheckSchema = z.strictObject({
  version: stableVersionSchema,
  available: z.boolean(),
  releaseUrl: releaseUrlSchema,
});
export type ReleaseCheck = z.infer<typeof releaseCheckSchema>;
export const updatePreferencesSchema = z.strictObject({
  intervalHours: z.union([z.literal(0), z.number().int().min(4).max(168)]),
});
export type UpdatePreferences = z.infer<typeof updatePreferencesSchema>;
export const updateDefaults: UpdatePreferences = { intervalHours: 0 };
export const saveUpdatePreferencesSchema = z.strictObject({
  expectedRevision: z.number().int().nonnegative(),
  value: updatePreferencesSchema,
});
export type SaveUpdatePreferences = z.infer<typeof saveUpdatePreferencesSchema>;
export const updateActionSchema = z.discriminatedUnion("action", [
  z.strictObject({ action: z.enum(["check", "cancel", "reset", "open-release"]) }),
  z.strictObject({ action: z.literal("download"), confirmed: z.literal(true) }),
  z.strictObject({ action: z.literal("install"), confirmed: z.literal(true) }),
]);
export type UpdateAction = z.infer<typeof updateActionSchema>;
export const updateSnapshotSchema = z.strictObject({
  revision: z.number().int().nonnegative(),
  preferences: updatePreferencesSchema,
  currentVersion: z.string().max(80),
  phase: z.enum([
    "idle",
    "checking",
    "no-release",
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
      "SIGNED_INSTALL_REQUIRED",
      "CHECK_FAILED",
      "DOWNLOAD_FAILED",
      "INSTALL_FAILED",
      "SETTINGS_UNAVAILABLE",
    ])
    .nullable(),
  installSupported: z.boolean(),
  releaseUrl: releaseUrlSchema.nullable(),
  availableVersion: stableVersionSchema.nullable(),
  progress: z.number().min(0).max(100).nullable(),
  checkedAt: z.number().int().nonnegative().nullable(),
});
export type UpdateSnapshot = z.infer<typeof updateSnapshotSchema>;
