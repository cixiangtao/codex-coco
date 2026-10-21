import { setTimeout as delay } from "node:timers/promises";
import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import {
  createUsageReader,
  usageAccountScope,
  type ReaderOptions,
} from "../apps/desktop/src/modules/usage/app-server";
import { createResetService } from "../apps/desktop/src/modules/usage/reset";
import { creditReference, normalizeUsage } from "../apps/desktop/src/modules/usage/normalize";
import {
  UsageNotifications,
  type UsageNotifier,
} from "../apps/desktop/src/modules/usage/notifications";
const directories: string[] = [];
const server = fileURLToPath(new URL("./fixtures/usage-server.mjs", import.meta.url));
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "codex-coco-reset-"));
  directories.push(directory);
  const mode = join(directory, "mode");
  const ledger = join(directory, "ledger");
  const trace = join(directory, "trace");
  await writeFile(mode, "reset-ready");
  const options: ReaderOptions = {
    command: process.execPath,
    args: [server],
    timeoutMs: 500,
    env: {
      ...process.env,
      FAKE_USAGE_MODE_FILE: mode,
      FAKE_RESET_LEDGER: ledger,
      FAKE_USAGE_TRACE: trace,
    },
  };
  const path = join(directory, "attempts.json");
  return {
    directory,
    mode,
    ledger,
    trace,
    options,
    path,
    read: createUsageReader(options),
    service: createResetService(path, options),
  };
}
describe("reset credit privacy and durable idempotency", () => {
  it("exposes only a reference, count and expiry, excluding raw credit IDs and server copy", () => {
    const result = normalizeUsage(
      {
        rateLimits: { primary: { usedPercent: 5 } },
        rateLimitResetCredits: {
          availableCount: 4,
          credits: [
            {
              id: "private-id",
              status: "available",
              expiresAt: 2_000_000_000,
              title: "PRIVATE_PROMPT",
              accessToken: "private-token",
            },
            { id: "spent", status: "consumed", expiresAt: null },
          ],
        },
      },
      123,
    );
    expect(result.resetCredits).toEqual({
      availableCount: 4,
      credits: [{ reference: creditReference("private-id"), expiresAt: 2_000_000_000 }],
    });
    expect(JSON.stringify(result)).not.toMatch(/private|accessToken|title|description/);
    expect(
      normalizeUsage({ rateLimitResetCredits: { availableCount: 1, credits: null } }, 123)
        .resetCredits?.credits,
    ).toBeNull();
  });
  it("persists an uncertain redemption and reuses its key after restart without consuming twice", async () => {
    const f = await fixture();
    const signal = new AbortController().signal;
    const raw = await f.read(signal);
    const scope = usageAccountScope(raw);
    expect(scope).toMatch(/^[a-f0-9]{64}$/);
    const input = { attemptKey: randomUUID(), reference: creditReference("private-credit-id") };
    await writeFile(f.mode, "reset-pending");
    expect(await f.service.consume(input, raw, scope, signal)).toMatchObject({
      outcome: "pending",
      attemptKey: input.attemptKey,
    });
    expect(JSON.parse(await readFile(f.ledger, "utf8"))).toEqual([input.attemptKey]);
    const restarted = createResetService(f.path, f.options);
    expect(await restarted.latest()).toMatchObject({
      outcome: "pending",
      attemptKey: input.attemptKey,
    });
    await expect(
      restarted.consume({ ...input, attemptKey: randomUUID() }, raw, scope, signal),
    ).rejects.toThrow("RESET_PENDING_ATTEMPT");
    await writeFile(f.mode, "reset-ready");
    expect(await restarted.consume(input, raw, scope, signal)).toMatchObject({
      outcome: "alreadyRedeemed",
    });
    const events = (await readFile(f.trace, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    const count = events.filter(
      (event) => event.method === "account/rateLimitResetCredit/consume",
    ).length;
    expect(await restarted.consume(input, raw, scope, signal)).toMatchObject({
      outcome: "alreadyRedeemed",
    });
    const after = (await readFile(f.trace, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(
      after.filter((event) => event.method === "account/rateLimitResetCredit/consume"),
    ).toHaveLength(count);
    expect(JSON.parse(await readFile(f.ledger, "utf8"))).toEqual([input.attemptKey]);
  });
  it("leaves an in-flight cancelled redemption recoverable without losing the original key", async () => {
    const f = await fixture();
    const raw = await f.read(new AbortController().signal);
    const input = { attemptKey: randomUUID(), reference: creditReference("private-credit-id") };
    await writeFile(f.mode, "reset-hang");
    const controller = new AbortController();
    const pending = f.service.consume(input, raw, usageAccountScope(raw), controller.signal);
    const rejected = expect(pending).rejects.toThrow();
    const deadline = Date.now() + 2000;
    while (Date.now() < deadline) {
      try {
        if ((await readFile(f.ledger, "utf8")).includes(input.attemptKey)) break;
      } catch {}
      await delay(10);
    }
    controller.abort();
    await rejected;
    expect(await createResetService(f.path, f.options).latest()).toMatchObject({
      attemptKey: input.attemptKey,
      outcome: "pending",
    });
  });
  it("rejects stale references, unconfirmed accounts and reuse against another account", async () => {
    const f = await fixture();
    const signal = new AbortController().signal;
    const raw = await f.read(signal);
    const scope = usageAccountScope(raw);
    const input = { attemptKey: randomUUID(), reference: creditReference("private-credit-id") };
    await expect(f.service.consume(input, raw, null, signal)).rejects.toThrow(
      "RESET_ACCOUNT_UNCONFIRMED",
    );
    await expect(
      f.service.consume({ ...input, reference: "f".repeat(64) }, raw, scope, signal),
    ).rejects.toThrow("RESET_CREDIT_STALE");
    await f.service.consume(input, raw, scope, signal);
    await expect(f.service.consume(input, raw, "f".repeat(64), signal)).rejects.toThrow(
      "RESET_ACCOUNT_CHANGED",
    );
    expect(JSON.stringify(await f.service.latest())).not.toContain("private-credit-id");
  });
  it("sends one imminent expiry notification while keeping normal quota transitions separate", async () => {
    const f = await fixture();
    const raw = await f.read(new AbortController().signal);
    const data = normalizeUsage(raw, Date.now());
    const events: Parameters<UsageNotifier>[0][] = [];
    const notify = new UsageNotifications((value) => {
      events.push(value);
      return true;
    });
    const { usageDefaults } = await import("../apps/desktop/src/modules/usage/contract");
    const config = { ...usageDefaults, notificationsEnabled: true };
    notify.success(data, config);
    notify.success(data, config);
    expect(events.filter((value) => value.kind === "expiry")).toHaveLength(1);
  });
});
