import { createHash } from "node:crypto";
import { z } from "zod";
import { usageSnapshotSchema, type UsageFailureCode, type UsageSnapshot } from "./contract";

/** Fixed source failures are safe to map into a public result; original errors remain private. */
export class UsageReadError extends Error {
  constructor(public readonly code: UsageFailureCode) {
    super(code);
  }
}
const rawWindow = z.object({
  usedPercent: z.number().min(0),
  windowDurationMins: z.number().int().positive().nullish(),
  resetsAt: z.number().int().nonnegative().max(8_640_000_000_000).nullish(),
});
const rawBucket = z.object({ primary: rawWindow.nullish(), secondary: rawWindow.nullish() });
const responseSchema = z.object({
  rateLimitResetCredits: z.unknown().optional(),
  rateLimits: z.unknown().optional(),
  rateLimitsByLimitId: z.unknown().optional(),
});
const bucketId = z.string().regex(/^[a-zA-Z0-9_.:-]{1,80}$/);

/** Prefer the authoritative bucket map; whitelist numeric quota fields instead of copying the RPC. */
export function normalizeUsage(raw: unknown, capturedAt: number): UsageSnapshot {
  const parsed = responseSchema.safeParse(raw);
  if (!parsed.success) throw new UsageReadError("INVALID_RESPONSE");
  const value = parsed.data;
  let entries: [string, z.infer<typeof rawBucket>][] = [];
  if (value.rateLimitsByLimitId !== null && value.rateLimitsByLimitId !== undefined) {
    const mapped = z.record(bucketId, rawBucket).safeParse(value.rateLimitsByLimitId);
    if (!mapped.success) throw new UsageReadError("INVALID_RESPONSE");
    entries = Object.entries(mapped.data);
  } else if (value.rateLimits !== null && value.rateLimits !== undefined) {
    const legacy = rawBucket.extend({ limitId: bucketId.nullish() }).safeParse(value.rateLimits);
    if (!legacy.success) throw new UsageReadError("INVALID_RESPONSE");
    entries = [[legacy.data.limitId ?? "codex", legacy.data]];
  }
  if (entries.length > 20) throw new UsageReadError("INVALID_RESPONSE");
  const buckets = entries
    .map(([id, bucket]) => ({
      id,
      windows: (["primary", "secondary"] as const).flatMap((kind) => {
        const window = bucket[kind];
        return window
          ? [
              {
                kind,
                usedPercent: window.usedPercent,
                windowMinutes: window.windowDurationMins ?? null,
                resetsAt: window.resetsAt ?? null,
              },
            ]
          : [];
      }),
    }))
    .filter((bucket) => bucket.windows.length > 0)
    .sort(
      (a, b) => Number(b.id === "codex") - Number(a.id === "codex") || a.id.localeCompare(b.id),
    );
  const rawCredits = resetCreditDetails(raw);
  if (!buckets.length && !rawCredits) throw new UsageReadError("NO_LIMITS");
  return usageSnapshotSchema.parse({
    source: "codex-app-server",
    capturedAt,
    buckets,
    resetCredits: rawCredits
      ? {
          availableCount: rawCredits.availableCount,
          credits:
            rawCredits.credits
              ?.filter((credit) => credit.status === "available")
              .map((credit) => ({
                reference: creditReference(credit.id),
                expiresAt: credit.expiresAt ?? null,
              })) ?? null,
        }
      : null,
  });
}

const rawResetSchema = z.object({
  availableCount: z.number().int().min(0).max(1_000_000),
  credits: z
    .array(
      z.object({
        id: z.string().min(1).max(512),
        status: z.string().max(40),
        expiresAt: z.number().int().nonnegative().max(8_640_000_000_000).nullish(),
      }),
    )
    .max(100)
    .nullish(),
});
/** Opaque credit identifiers stay private; only a bounded reference is rendered. */
export function creditReference(id: string) {
  return createHash("sha256").update(id).digest("hex");
}
export function resetCreditDetails(raw: unknown) {
  const root = responseSchema.safeParse(raw);
  if (
    !root.success ||
    root.data.rateLimitResetCredits === null ||
    root.data.rateLimitResetCredits === undefined
  )
    return null;
  const result = rawResetSchema.safeParse(root.data.rateLimitResetCredits);
  return result.success ? result.data : null;
}
