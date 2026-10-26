import { createInterface } from "node:readline";
import { readFileSync, writeFileSync, appendFileSync } from "node:fs";
const args = process.argv.slice(2);
const mode = () => {
  try {
    return readFileSync(process.env.FAKE_TOOL_MODE_FILE, "utf8").trim();
  } catch {
    return "ready";
  }
};
const trace = () => {
  if (process.env.FAKE_TOOL_TRACE)
    appendFileSync(
      process.env.FAKE_TOOL_TRACE,
      JSON.stringify({ args, cwd: process.cwd(), pid: process.pid }) + "\n",
    );
};
trace();
if (args.includes("--version")) {
  let version = "1.2.3";
  try {
    version = readFileSync(process.env.FAKE_TOOL_VERSION_FILE, "utf8");
  } catch {}
  process.stdout.write(`codex-cli ${version}\n`);
  process.exit(0);
} else if (args.includes("update")) {
  writeFileSync(process.env.FAKE_TOOL_VERSION_FILE, "1.2.4");
  process.exit(0);
} else if (args.includes("exec")) {
  let input = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk) => {
    input += chunk;
  });
  process.stdin.on("end", () => {
    if (mode() === "hang") {
      process.on("SIGTERM", () => undefined);
      setInterval(() => undefined, 1000);
      return;
    }
    if (mode() === "failed") {
      process.stderr.write("private failure");
      process.exit(2);
    }
    const answer = mode() === "wrong" ? 22 : 21;
    const text =
      mode() === "malformed"
        ? "not structured JSON"
        : JSON.stringify({
            answer,
            explanation: "受控样本说明，可能出现数字21，但以answer字段判定。",
          });
    process.stdout.write(
      JSON.stringify({ type: "item.completed", item: { type: "agent_message", text } }) + "\n",
    );
    process.stdout.write(
      JSON.stringify({
        type: "turn.completed",
        usage: { input_tokens: 900, output_tokens: 30, reasoning_output_tokens: 16 },
      }) + "\n",
    );
  });
} else {
  createInterface({ input: process.stdin }).on("line", (line) => {
    const request = JSON.parse(line);
    const send = (value) =>
      process.stdout.write(JSON.stringify({ id: request.id, result: value }) + "\n");
    if (request.method === "initialize") send({});
    else if (request.method === "initialized") return;
    else if (request.method === "account/read")
      send({
        account: { type: "chatgpt", email: "private@example.test", accessToken: "private-token" },
      });
    else if (request.method === "config/read") {
      if (mode() === "config-unsupported") {
        process.stdout.write(JSON.stringify({ id: request.id, error: { code: -32601 } }) + "\n");
        return;
      }
      send({
        config: {
          model: mode() === "config-invalid" ? "--unsafe-option" : "controlled-model",
          model_reasoning_effort: "high",
          secret: "private-token",
          mcp_servers: { private: { command: "private-command" } },
        },
        layers: [{ path: "/private/config.toml" }],
      });
    } else if (request.method === "model/list") {
      if (mode() === "models-invalid") {
        send({ data: [{ id: "--unsafe-option" }], nextCursor: null });
        return;
      }
      const second = request.params?.cursor === "second";
      send({
        data: [
          {
            id: second ? "controlled-second" : "controlled-model",
            model: second ? "controlled-second" : "controlled-model",
            displayName: second ? "受控模型二" : "受控模型",
            supportedReasoningEfforts: [{ reasoningEffort: "medium" }, { reasoningEffort: "high" }],
            defaultReasoningEffort: "medium",
            isDefault: !second,
            private: "private-token",
          },
        ],
        nextCursor: second ? null : "second",
      });
    } else if (request.method === "account/rateLimits/read")
      send({
        rateLimits: {
          primary: { usedPercent: 25, windowDurationMins: 300, resetsAt: 2_000_000_000 },
        },
      });
    else
      process.stdout.write(
        JSON.stringify({ id: request.id, error: { code: -32601, message: "private error" } }) +
          "\n",
      );
  });
}
