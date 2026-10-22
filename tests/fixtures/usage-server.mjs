import { createInterface } from "node:readline";
import { appendFileSync, readFileSync } from "node:fs";
const trace = (method) => {
  if (process.env.FAKE_USAGE_TRACE)
    appendFileSync(
      process.env.FAKE_USAGE_TRACE,
      `${JSON.stringify({ method, pid: process.pid, home: process.env.CODEX_HOME })}\n`,
    );
};
trace("spawn");
const mode = () =>
  process.env.FAKE_USAGE_MODE_FILE
    ? readFileSync(process.env.FAKE_USAGE_MODE_FILE, "utf8").trim()
    : (process.env.FAKE_USAGE_MODE ?? "ready");
if (process.argv.includes("--version")) {
  process.stdout.write("codex-cli 1.2.3\n");
  process.exit(0);
}
if (process.argv.includes("exec")) {
  trace("exec");
  setInterval(() => {}, 1000);
  process.stdin.resume();
  await new Promise(() => {});
}
if (mode() === "ignore-term") {
  process.on("SIGTERM", () => trace("term"));
  setInterval(() => {}, 1000);
}
const send = (id, result) => process.stdout.write(`${JSON.stringify({ id, result })}\n`);
createInterface({ input: process.stdin }).on("line", async (line) => {
  const request = JSON.parse(line);
  trace(request.method);
  if (request.method === "initialize") {
    if (mode() === "exit") process.exit(0);
    if (mode() === "malformed") {
      process.stdout.write("private-invalid-json\n");
      return;
    }
    if (mode() === "oversized") {
      process.stdout.write("x".repeat(1024 * 1024 + 1));
      return;
    }
    process.stderr.write("private-token-from-stderr\n");
    send(request.id, { userAgent: "private-agent" });
  } else if (request.method === "initialized") {
    process.stdout.write(
      `${JSON.stringify({ method: "account/updated", params: { email: "private@example.com" } })}\n`,
    );
  } else if (request.method === "account/read") {
    send(request.id, {
      account:
        mode() === "signed-out"
          ? null
          : {
              type: mode() === "api-key" ? "apiKey" : "chatgpt",
              email: "private@example.com",
              planType: "plus",
              accessToken: "private-token",
            },
    });
  } else if (request.method === "account/rateLimits/read") {
    if (mode() === "hang") return;
    if (mode() === "error" || mode() === "unsupported") {
      process.stdout.write(
        `${JSON.stringify({ id: request.id, error: { code: mode() === "unsupported" ? -32601 : -32000, message: "private-token" } })}\n`,
      );
      return;
    }
    if (mode() === "empty") {
      send(request.id, { rateLimits: null, rateLimitsByLimitId: {} });
      return;
    }
    const result = {
      rateLimitsByLimitId: {
        codex: {
          primary: {
            usedPercent: mode() === "invalid-quota" ? "invalid" : mode() === "exhausted" ? 100 : 25,
            windowDurationMins: 300,
            resetsAt: Math.floor(Date.now() / 1000) + 3600,
          },
          secondary: {
            usedPercent: 60,
            windowDurationMins: 10080,
            resetsAt: Math.floor(Date.now() / 1000) + 86400,
          },
          email: "private@example.com",
          accessToken: "private-token",
        },
      },
      rateLimitResetCredits: mode().startsWith("reset")
        ? {
            availableCount: 1,
            credits: [
              {
                id: "private-credit-id",
                status: "available",
                expiresAt: Math.floor(Date.now() / 1000) + 3600,
              },
            ],
          }
        : null,
      email: "private@example.com",
      token: "private-token",
    };
    const response = `${JSON.stringify({ id: request.id, result })}\n`;
    // Deliberately split the JSON-RPC frame across chunks.
    process.stdout.write(response.slice(0, 41));
    setTimeout(() => process.stdout.write(response.slice(41)), 5);
  } else if (request.method === "model/list") {
    send(request.id, {
      data: [
        {
          id: "test-model",
          model: "test-model",
          displayName: "受控模型",
          supportedReasoningEfforts: [{ reasoningEffort: "high" }],
          defaultReasoningEffort: "high",
          isDefault: true,
        },
      ],
      nextCursor: null,
    });
  } else if (request.method === "account/rateLimitResetCredit/consume") {
    const key = request.params.idempotencyKey;
    let entries = [];
    try {
      entries = JSON.parse(readFileSync(process.env.FAKE_RESET_LEDGER, "utf8"));
    } catch {}
    const repeated = entries.includes(key);
    if (!repeated) {
      entries.push(key);
      const { writeFileSync } = await import("node:fs");
      writeFileSync(process.env.FAKE_RESET_LEDGER, JSON.stringify(entries));
    }
    if (mode() === "reset-hang") return;
    if (mode() === "reset-pending")
      process.stdout.write(
        `${JSON.stringify({ id: request.id, error: { code: -32000, message: "private mutation result uncertain" } })}\n`,
      );
    else send(request.id, { outcome: repeated ? "alreadyRedeemed" : "reset" });
  } else process.exit(9);
});
