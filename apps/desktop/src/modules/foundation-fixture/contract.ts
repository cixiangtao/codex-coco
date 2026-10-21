import { z } from "zod";

/** Synthetic module data only; no accounts, network access or external application state. */
export const fixtureConfigSchema = z.strictObject({ label: z.string().trim().min(1).max(40) });
export const fixtureInputSchema = z.strictObject({ steps: z.number().int().min(1).max(20) });
export const fixtureResultSchema = z.strictObject({
  label: z.string(),
  completed: z.number().int(),
});
