import { createInterface } from "node:readline";
import { appendFileSync, readFileSync } from "node:fs";
const trace = (method) => {
  if (process.env.FAKE_USAGE_TRACE)
    appendFileSync(
      process.env.FAKE_USAGE_TRACE,
      `${JSON.stringify({ method, pid: process.pid })}\n`,
    );
};
trace("spawn");
const mode = () =>
  process.env.FAKE_USAGE_MODE_FILE
    ? readFileSync(process.env.FAKE_USAGE_MODE_FILE, "utf8").trim()
    : (process.env.FAKE_USAGE_MODE ?? "ready");
if (mode() === "ignore-term") {
  process.on("SIGTERM", () => trace("term"));
  setInterval(() => {}, 1000);
}
const send = (id, result) => process.stdout.write(`${JSON.stringify({ id, result })}\n`);
createInterface({ input: process.stdin }).on("line", (line) => {
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
            usedPercent: mode() === "invalid-quota" ? "invalid" : 25,
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
      email: "private@example.com",
      token: "private-token",
    };
    const response = `${JSON.stringify({ id: request.id, result })}\n`;
    // Deliberately split the JSON-RPC frame across chunks.
    process.stdout.write(response.slice(0, 41));
    setTimeout(() => process.stdout.write(response.slice(41)), 5);
  } else process.exit(9);
});
