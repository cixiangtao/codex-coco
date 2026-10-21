import { z } from "zod";

/** Only serializable, explicitly public data may cross the module bridge. */
export type JsonValue = z.infer<ReturnType<typeof z.json>>;
export const moduleIdSchema = z.string().regex(/^[a-z][a-z0-9-]{0,47}$/);
export const moduleTargetSchema = z.strictObject({ moduleId: moduleIdSchema });
export const enableModuleSchema = moduleTargetSchema.extend({ enabled: z.boolean() });
export const saveModuleConfigSchema = moduleTargetSchema.extend({
  expectedRevision: z.number().int().nonnegative(),
  value: z.json(),
});
export const runModuleOperationSchema = moduleTargetSchema.extend({
  operation: z.string().regex(/^[a-z][a-z0-9-]{0,47}$/),
  input: z.json(),
});
export const cancelModuleOperationSchema = moduleTargetSchema.extend({ operationId: z.uuid() });

export interface ModuleConfigSnapshot {
  schemaVersion: number;
  revision: number;
  enabled: boolean;
  value: JsonValue;
  health: "ok" | "missing" | "invalid" | "future-version" | "unavailable";
}
export interface ModuleOperationSnapshot {
  id: string;
  name: string;
  generation: number;
  phase: "running" | "cancelling" | "succeeded" | "cancelled" | "failed";
  progress: number;
  result: JsonValue;
  error: string | null;
}
/** revision orders host events; config.revision independently guards persistent writes. */
export interface ModuleSnapshot {
  id: string;
  title: string;
  revision: number;
  generation: number;
  phase: "disabled" | "starting" | "running" | "stopping" | "error";
  error: string | null;
  config: ModuleConfigSnapshot;
  operations: string[];
  operation: ModuleOperationSnapshot | null;
}
export type EnableModuleInput = z.infer<typeof enableModuleSchema>;
export type SaveModuleConfigInput = z.infer<typeof saveModuleConfigSchema>;
export type RunModuleOperationInput = z.infer<typeof runModuleOperationSchema>;
export type CancelModuleOperationInput = z.infer<typeof cancelModuleOperationSchema>;
