import type { MainPage } from "./windows";
import { z } from "zod";

export type GlancePhase =
  | "unavailable"
  | "disabled"
  | "starting"
  | "running"
  | "stopping"
  | "error";
/** Public presentation only; module configuration, task results and credentials stay out. */
export interface GlanceItem {
  id: string;
  title: string;
  phase: GlancePhase;
  description: string;
  page: MainPage;
  metrics?: GlanceMetric[];
  capturedAt?: number;
  statusText?: string;
  identity?: { label: string; plan: string };
}
/** Explicitly public presentation fields, never an arbitrary module result. */
export interface GlanceMetric {
  id: string;
  label: string;
  value: string;
  detail: string;
  progress?: number | undefined;
  numericValue?: number | undefined;
  unit?: string | undefined;
  resetsAt?: number | null | undefined;
  group?: string | undefined;
}
export const glanceDetailSchema = z.strictObject({
  page: z.enum(["usage", "appearance", "modules", "settings"]).optional(),
  phase: z.enum(["unavailable", "disabled", "starting", "running", "stopping", "error"]).optional(),
  description: z.string().max(256),
  metrics: z
    .array(
      z.strictObject({
        id: z.string().regex(/^[a-zA-Z0-9_.:-]{1,100}$/),
        label: z.string().max(120),
        value: z.string().max(120),
        detail: z.string().max(120),
        progress: z.number().min(0).max(100).optional(),
        numericValue: z.number().nonnegative().max(Number.MAX_SAFE_INTEGER).optional(),
        unit: z.string().max(24).optional(),
        resetsAt: z.number().int().min(0).max(8_640_000_000_000_000).nullable().optional(),
        group: z.string().max(120).optional(),
      }),
    )
    .max(40)
    .optional(),
  statusText: z.string().max(120).optional(),
  capturedAt: z.number().int().nonnegative().optional(),
  identity: z.strictObject({ label: z.string().max(120), plan: z.string().max(80) }).optional(),
});
export type GlanceDetail = z.infer<typeof glanceDetailSchema>;
export interface GlanceSnapshot {
  /** Monotonic within this host session, independent of settings and module revisions. */
  revision: number;
  items: GlanceItem[];
}
