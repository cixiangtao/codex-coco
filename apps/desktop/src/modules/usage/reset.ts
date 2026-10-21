import { mkdir, readFile, writeFile, rename, unlink, lstat } from "node:fs/promises";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { createAppServerRequest, type ReaderOptions } from "./app-server";
import { creditReference, resetCreditDetails } from "./normalize";
import { resetFeedbackSchema, type ResetFeedback } from "./contract";

const storedSchema = z.strictObject({
  version: z.literal(1),
  attempts: z
    .array(
      z.strictObject({
        feedback: resetFeedbackSchema,
        scope: z.string().regex(/^[a-f0-9]{64}$/),
        creditId: z.string().max(512).nullable(),
      }),
    )
    .max(30),
});
const outcomeSchema = z.object({
  outcome: z.enum(["reset", "alreadyRedeemed", "nothingToReset", "noCredit"]),
});
export interface ResetService {
  latest(): Promise<ResetFeedback | null>;
  consume(
    input: { attemptKey: string; reference: string | null },
    raw: unknown,
    scope: string | null,
    signal: AbortSignal,
  ): Promise<ResetFeedback>;
}
/** Writes the redemption intent before sending it; retries retain the same idempotency key. */
export function createResetService(path: string, options: ReaderOptions = {}): ResetService {
  async function read() {
    try {
      if ((await lstat(path)).size > 64 * 1024) throw new Error("RESET_STATE_INVALID");
      return storedSchema.parse(JSON.parse(await readFile(path, "utf8")));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT")
        throw new Error("RESET_STATE_INVALID");
      return { version: 1 as const, attempts: [] };
    }
  }
  async function persist(value: z.infer<typeof storedSchema>) {
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    const temporary = `${path}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, JSON.stringify(value), { flag: "wx", mode: 0o600 });
      await rename(temporary, path);
    } finally {
      await unlink(temporary).catch(() => undefined);
    }
  }
  return {
    latest: async () => (await read()).attempts.at(-1)?.feedback ?? null,
    consume: async (input, raw, scope, signal) => {
      signal.throwIfAborted();
      const state = await read();
      let attempt = state.attempts.find((value) => value.feedback.attemptKey === input.attemptKey);
      if (attempt && attempt.feedback.reference !== input.reference)
        throw new Error("RESET_ATTEMPT_MISMATCH");
      if (attempt && (!scope || attempt.scope !== scope)) throw new Error("RESET_ACCOUNT_CHANGED");
      if (!attempt) {
        if (!scope) throw new Error("RESET_ACCOUNT_UNCONFIRMED");
        const credits = resetCreditDetails(raw);
        const credit = input.reference
          ? credits?.credits?.find(
              (value) =>
                creditReference(value.id) === input.reference && value.status === "available",
            )
          : null;
        if (input.reference && !credit) throw new Error("RESET_CREDIT_STALE");
        if (!credits || credits.availableCount <= 0) throw new Error("RESET_NO_CREDIT");
        const pending = state.attempts.find(
          (value) => value.scope === scope && value.feedback.outcome === "pending",
        );
        if (pending) throw new Error("RESET_PENDING_ATTEMPT");
        attempt = {
          feedback: {
            attemptKey: input.attemptKey,
            reference: input.reference,
            outcome: "pending",
            updatedAt: Date.now(),
          },
          scope,
          creditId: credit?.id ?? null,
        };
        state.attempts.push(attempt);
        while (state.attempts.length > 30) {
          const removable = state.attempts.findIndex(
            (value) => value.feedback.outcome !== "pending",
          );
          if (removable < 0) throw new Error("RESET_STATE_FULL");
          state.attempts.splice(removable, 1);
        }
        await persist(state);
      }
      if (
        ["reset", "alreadyRedeemed", "nothingToReset", "noCredit"].includes(
          attempt.feedback.outcome,
        )
      )
        return attempt.feedback;
      try {
        const response = await createAppServerRequest(
          {
            method: "account/rateLimitResetCredit/consume",
            expectedScope: attempt.scope,
            params: {
              idempotencyKey: attempt.feedback.attemptKey,
              ...(attempt.creditId ? { creditId: attempt.creditId } : {}),
            },
          },
          options,
        )(signal);
        const outcome = outcomeSchema.parse(response).outcome;
        attempt.feedback = { ...attempt.feedback, outcome, updatedAt: Date.now() };
        await persist(state);
        return attempt.feedback;
      } catch {
        signal.throwIfAborted();
        return attempt.feedback;
      }
    },
  };
}
