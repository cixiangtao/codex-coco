import {
  mkdtemp,
  realpath,
  readFile,
  writeFile,
  mkdir,
  rename,
  unlink,
  copyFile,
  lstat,
  rm,
} from "node:fs/promises";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { createAppServerRequest, codexCommand, type ReaderOptions } from "./app-server";
import { runCodexCommand, type CommandOptions } from "./process";
import {
  intelligenceInputSchema,
  intelligenceHistorySchema,
  modelOptionSchema,
  usageToolsSchema,
  type UsageTools,
} from "./contract";

// The inherited sample is a reproducible compatibility check, not a general intelligence benchmark.
export const intelligencePrompt = `不使用任何外部工具回答以下问题。参赛者能通过手感区分圆形和五角星形，并在活动前决定取糖数目。在黑袋中，圆形的苹果/桃子/西瓜糖分别为7/9/8颗，五角星形分别为7/6/4颗。最少取出多少颗，才能保证拥有不同形状的苹果味和桃子味糖果（圆苹果配星桃，或圆桃配星苹果均可）？用 answer 给出整数，用 explanation 简要说明。`;
const finalAnswerSchema = z.strictObject({
  answer: z.number().int().min(0).max(1000),
  explanation: z.string().max(8192),
});
export interface UsageToolsService {
  reset?(): void;
  snapshot(): UsageTools;
  execute(
    name: string,
    input: unknown,
    signal: AbortSignal,
    report: (progress: number) => void,
  ): Promise<void>;
}
export function createUsageToolsService(options: {
  directory: string;
  rpc?: ReaderOptions;
  command?: CommandOptions;
  fetchImpl?: typeof fetch;
}): UsageToolsService {
  let state: UsageTools = {
    requestedRuns: null,
    installation: "unknown",
    models: [],
    samples: [],
    history: [],
    error: null,
    cliVersion: null,
    latestCliVersion: null,
  };
  const historyPath = join(options.directory, "intelligence-history.json");
  const historySchema = z.array(intelligenceHistorySchema).max(100);
  async function history() {
    try {
      if ((await lstat(historyPath)).size > 256 * 1024) throw new Error("HISTORY_INVALID");
      return historySchema.parse(JSON.parse(await readFile(historyPath, "utf8")));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw new Error("HISTORY_INVALID");
      return [];
    }
  }
  async function saveHistory() {
    await mkdir(dirname(historyPath), { recursive: true, mode: 0o700 });
    const temporary = `${historyPath}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, JSON.stringify(state.history), { flag: "wx", mode: 0o600 });
      await rename(temporary, historyPath);
    } finally {
      await unlink(temporary).catch(() => undefined);
    }
  }
  async function models(signal: AbortSignal) {
    const collected: UsageTools["models"] = [];
    let cursor: string | undefined;
    const seen = new Set<string>();
    for (let page = 0; page < 10; page++) {
      const response = await createAppServerRequest(
        {
          method: "model/list",
          params: { limit: 100, includeHidden: false, ...(cursor ? { cursor } : {}) },
        },
        options.rpc,
      )(signal);
      const parsed = z
        .object({
          data: z
            .array(
              z.object({
                id: z.string(),
                model: z.string().optional(),
                displayName: z.string().max(120),
                supportedReasoningEfforts: z.array(z.object({ reasoningEffort: z.string() })),
                defaultReasoningEffort: z.string().nullish(),
                isDefault: z.boolean().optional(),
              }),
            )
            .max(100),
          nextCursor: z.string().max(1000).nullish(),
        })
        .parse(response);
      for (const model of parsed.data) {
        const value = modelOptionSchema.parse({
          id: model.model ?? model.id,
          label: model.displayName,
          efforts: model.supportedReasoningEfforts.map((value) => value.reasoningEffort),
          defaultEffort: model.defaultReasoningEffort ?? null,
          isDefault: model.isDefault ?? false,
        });
        if (!seen.has(value.id)) {
          collected.push(value);
          seen.add(value.id);
        }
        if (collected.length > 200) throw new Error("MODELS_UNAVAILABLE");
      }
      if (!parsed.nextCursor) {
        state.models = collected;
        return;
      }
      if (parsed.nextCursor === cursor) throw new Error("MODELS_UNAVAILABLE");
      cursor = parsed.nextCursor;
    }
    throw new Error("MODELS_UNAVAILABLE");
  }
  return {
    reset: () => {
      state.models = [];
      state.samples = [];
      state.requestedRuns = null;
      state.error = null;
    },
    snapshot: () => usageToolsSchema.parse(state),
    execute: async (name, input, signal, report) => {
      state.error = null;
      try {
        if (name === "list-models") {
          await models(signal);
          return;
        }
        if (name === "load-intelligence-history") {
          state.history = await history();
          return;
        }
        if (name === "clear-intelligence-history") {
          try {
            await copyFile(historyPath, `${historyPath}.${randomUUID()}.bak`);
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
          }
          state.history = [];
          await saveHistory();
          return;
        }
        if (name === "check-cli" || name === "update-cli") {
          const directory = await mkdtemp(join(tmpdir(), "codex-coco-cli-"));
          try {
            if (name === "update-cli")
              await runCodexCommand(
                ["update"],
                { cwd: directory, signal, timeoutMs: 180_000 },
                {
                  ...options.command,
                  env: { ...(options.command?.env ?? process.env), CODEX_NON_INTERACTIVE: "1" },
                },
              );
            const output = await runCodexCommand(
              ["--version"],
              { cwd: directory, signal, timeoutMs: 5000 },
              options.command,
            );
            const version = output.trim().match(/(?:^|\s)(\d+\.\d+\.\d+)$/)?.[1];
            if (!version) throw new Error("CLI_UNAVAILABLE");
            state.cliVersion = version;
            const executable = await realpath(
              options.command?.command ??
                (await codexCommand(
                  {
                    ...(options.command?.env ?? process.env),
                    ...(await options.command?.environment?.()),
                  },
                  signal,
                )),
            );
            state.installation = executable.includes("/node_modules/")
              ? "package-manager"
              : executable.includes("/Cellar/") || executable.includes("/Caskroom/")
                ? "homebrew"
                : executable.includes("/.codex/packages/standalone/")
                  ? "standalone"
                  : "unknown";
            if (name === "update-cli") {
              if (state.latestCliVersion && versionBefore(version, state.latestCliVersion))
                throw new Error("UPDATE_FAILED");
              try {
                await models(signal);
              } catch {
                signal.throwIfAborted();
                state.error = "MODELS_UNAVAILABLE";
              }
              return;
            }
            const response = await (options.fetchImpl ?? fetch)(
              "https://api.github.com/repos/openai/codex/releases/latest",
              {
                signal: AbortSignal.any([signal, AbortSignal.timeout(10_000)]),
                redirect: "error",
                headers: { Accept: "application/vnd.github+json", "User-Agent": "Codex Coco" },
              },
            );
            if (!response.ok) throw new Error("CLI_UNAVAILABLE");
            const content = await response.text();
            if (content.length > 512 * 1024) throw new Error("CLI_UNAVAILABLE");
            const release = z
              .object({
                tag_name: z.string(),
                draft: z.literal(false),
                prerelease: z.literal(false),
              })
              .parse(JSON.parse(content));
            const latest = release.tag_name.match(/^rust-v(\d+\.\d+\.\d+)$/)?.[1];
            if (!latest) throw new Error("CLI_UNAVAILABLE");
            state.latestCliVersion = latest;
          } finally {
            await rm(directory, { recursive: true, force: true });
          }
          return;
        }
        if (name !== "run-intelligence") throw new Error("UNKNOWN_TOOL_OPERATION");
        const request = intelligenceInputSchema.parse(input);
        state.requestedRuns = request.runs;
        state.history = await history();
        state.samples = [];
        if (request.model && !state.models.some((model) => model.id === request.model))
          throw new Error("MODELS_UNAVAILABLE");
        const selected = state.models.find((model) => model.id === request.model);
        if (request.effort && !selected?.efforts.includes(request.effort))
          throw new Error("MODELS_UNAVAILABLE");
        const directory = await mkdtemp(join(tmpdir(), "codex-coco-intelligence-"));
        try {
          const schemaPath = join(directory, "answer.json");
          await writeFile(
            schemaPath,
            JSON.stringify({
              type: "object",
              properties: { answer: { type: "integer" }, explanation: { type: "string" } },
              required: ["answer", "explanation"],
              additionalProperties: false,
            }),
            { mode: 0o600 },
          );
          for (let index = 1; index <= request.runs; index++) {
            signal.throwIfAborted();
            const began = performance.now();
            try {
              const args = [
                "exec",
                "--json",
                "--ephemeral",
                "--skip-git-repo-check",
                "--ignore-user-config",
                "--ignore-rules",
                "-s",
                "read-only",
                "-c",
                'approval_policy="never"',
                "-c",
                'web_search="disabled"',
                "-c",
                "project_doc_max_bytes=0",
                "--output-schema",
                schemaPath,
              ];
              for (const feature of [
                "shell_tool",
                "unified_exec",
                "apps",
                "browser_use",
                "computer_use",
                "view_image",
                "memories",
                "skill_search",
                "workspace_dependencies",
                "code_mode_host",
              ])
                args.push("--disable", feature);
              if (request.model) args.push("-m", request.model);
              if (request.effort) args.push("-c", `model_reasoning_effort="${request.effort}"`);
              const output = await runCodexCommand(
                args,
                { cwd: directory, input: intelligencePrompt, signal, timeoutMs: 120_000 },
                options.command,
              );
              let answer: unknown;
              let usage: Record<string, unknown> = {};
              for (const line of output.split("\n")) {
                if (!line.trim()) continue;
                const event = z
                  .object({
                    type: z.string(),
                    item: z.unknown().optional(),
                    usage: z.unknown().optional(),
                  })
                  .parse(JSON.parse(line));
                if (event.type === "item.completed") {
                  const item = z
                    .object({ type: z.string(), text: z.string().optional() })
                    .parse(event.item);
                  if (item.type === "agent_message" && item.text) answer = JSON.parse(item.text);
                }
                if (event.type === "turn.completed")
                  usage = z.record(z.string(), z.unknown()).parse(event.usage ?? {});
              }
              const result = finalAnswerSchema.parse(answer);
              const counter = (value: unknown) =>
                typeof value === "number" && Number.isSafeInteger(value) && value >= 0
                  ? value
                  : null;
              state.samples.push({
                index,
                answer: result.answer,
                explanation: result.explanation,
                correct: result.answer === 21,
                elapsedMs: performance.now() - began,
                inputTokens: counter(usage.input_tokens),
                outputTokens: counter(usage.output_tokens),
                reasoningTokens: counter(usage.reasoning_output_tokens),
              });
            } catch {
              signal.throwIfAborted();
              state.samples.push({
                index,
                answer: null,
                explanation: "样本未完成，请检查 CLI 与模型访问权限。",
                correct: null,
                elapsedMs: performance.now() - began,
                inputTokens: null,
                outputTokens: null,
                reasoningTokens: null,
              });
              state.error = "SAMPLE_FAILED";
            }
            report((index / request.runs) * 100);
          }
        } finally {
          await rm(directory, { recursive: true, force: true });
          // Cancellation keeps completed samples and their summary, without inventing a result
          // for the interrupted sample. A cancellation before any answer leaves no history.
          if (!signal.aborted || state.samples.some((sample) => sample.correct !== null)) {
            const completed = state.samples.filter((sample) => sample.correct !== null);
            const rates = completed
              .filter((sample) => sample.outputTokens !== null && sample.elapsedMs > 0)
              .map((sample) => sample.outputTokens! / (sample.elapsedMs / 1000));
            state.history = [
              {
                id: randomUUID(),
                capturedAt: Date.now(),
                model: request.model ?? "CLI 默认模型",
                effort: request.effort,
                requested: request.runs,
                completed: completed.length,
                correct: completed.filter((sample) => sample.correct).length,
                averageTokensPerSecond: rates.length
                  ? rates.reduce((sum, value) => sum + value, 0) / rates.length
                  : null,
              },
              ...state.history,
            ].slice(0, 100);
            await saveHistory();
          }
        }
      } catch (error) {
        signal.throwIfAborted();
        state.error =
          error instanceof Error && error.message === "HISTORY_INVALID"
            ? "HISTORY_INVALID"
            : name === "list-models"
              ? "MODELS_UNAVAILABLE"
              : name === "update-cli"
                ? "UPDATE_FAILED"
                : name === "check-cli"
                  ? "CLI_UNAVAILABLE"
                  : "SAMPLE_FAILED";
      }
    },
  };
}

function versionBefore(current: string, target: string) {
  const left = current.split(".").map(Number);
  const right = target.split(".").map(Number);
  for (let index = 0; index < 3; index++) {
    if (left[index] !== right[index]) return left[index]! < right[index]!;
  }
  return false;
}
