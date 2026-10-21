import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, writeFile, readFile, rm, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { createUsageToolsService } from "../apps/desktop/src/modules/usage/tools";
const directories: string[] = [];
const fixture = fileURLToPath(new URL("./fixtures/usage-tools.mjs", import.meta.url));
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});
async function setup() {
  const directory = await mkdtemp(join(tmpdir(), "codex-coco-tools-"));
  directories.push(directory);
  const mode = join(directory, "mode");
  const trace = join(directory, "trace");
  const version = join(directory, "version");
  await writeFile(mode, "ready");
  const env = {
    ...process.env,
    FAKE_TOOL_MODE_FILE: mode,
    FAKE_TOOL_TRACE: trace,
    FAKE_TOOL_VERSION_FILE: version,
  };
  const options = {
    directory,
    rpc: { command: process.execPath, args: [fixture], env },
    command: { command: process.execPath, prefixArgs: [fixture], env },
    fetchImpl: async () =>
      new Response(JSON.stringify({ tag_name: "rust-v1.2.4", draft: false, prerelease: false })),
  };
  return { directory, mode, trace, options, service: createUsageToolsService(options) };
}
describe("explicit intelligence and CLI tools", () => {
  it("paginates models, runs structured samples with tools disabled and persists only summary history", async () => {
    const f = await setup();
    const signal = new AbortController().signal;
    await f.service.execute("list-models", {}, signal, () => undefined);
    expect(f.service.snapshot().models).toHaveLength(2);
    expect(JSON.stringify(f.service.snapshot())).not.toContain("private");
    await f.service.execute(
      "run-intelligence",
      { model: "controlled-model", effort: "high", runs: 2 },
      signal,
      () => undefined,
    );
    const state = f.service.snapshot();
    expect(state.samples.map((sample) => sample.correct)).toEqual([true, true]);
    expect(state.samples[0]).toMatchObject({
      inputTokens: 900,
      outputTokens: 30,
      reasoningTokens: 16,
    });
    expect(state.history[0]).toMatchObject({ completed: 2, correct: 2 });
    const history = await readFile(join(f.directory, "intelligence-history.json"), "utf8");
    expect(history).not.toMatch(/explanation|受控样本|private/);
    const commands = (await readFile(f.trace, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    const samples = commands.filter((command) => command.args.includes("exec"));
    expect(samples).toHaveLength(2);
    for (const sample of samples) {
      expect(sample.args).toContain("--ephemeral");
      expect(sample.args).toContain("--ignore-user-config");
      expect(sample.args).toContain("project_doc_max_bytes=0");
      expect(sample.args).toContain("shell_tool");
      expect(sample.args).toContain("unified_exec");
      expect(sample.args).toContain("read-only");
      expect(sample.cwd).not.toBe(f.directory);
      expect(() => process.kill(sample.pid, 0)).toThrow();
    }
    const restarted = createUsageToolsService(f.options);
    await restarted.execute("load-intelligence-history", {}, signal, () => undefined);
    expect(restarted.snapshot().history).toHaveLength(1);
  });
  it("rejects malformed model catalogs without treating them as callable model arguments", async () => {
    const f = await setup();
    await writeFile(f.mode, "models-invalid");
    await f.service.execute("list-models", {}, new AbortController().signal, () => undefined);
    expect(f.service.snapshot().error).toBe("MODELS_UNAVAILABLE");
    expect(f.service.snapshot().models).toEqual([]);
    expect(JSON.stringify(f.service.snapshot())).not.toContain("--unsafe-option");
  });
  it("does not mistake a 21 in the explanation for a correct answer, and distinguishes command failure", async () => {
    const f = await setup();
    const signal = new AbortController().signal;
    await writeFile(f.mode, "wrong");
    await f.service.execute(
      "run-intelligence",
      { model: null, effort: null, runs: 1 },
      signal,
      () => undefined,
    );
    expect(f.service.snapshot().samples[0]?.correct).toBe(false);
    await writeFile(f.mode, "failed");
    await f.service.execute(
      "run-intelligence",
      { model: null, effort: null, runs: 1 },
      signal,
      () => undefined,
    );
    expect(f.service.snapshot().samples[0]?.correct).toBeNull();
    expect(f.service.snapshot().error).toBe("SAMPLE_FAILED");
    expect(f.service.snapshot().history[0]?.completed).toBe(0);
  });
  it("cancels and force-terminates an owned sample process without recording false results", async () => {
    const f = await setup();
    await writeFile(f.mode, "hang");
    const controller = new AbortController();
    const pending = f.service.execute(
      "run-intelligence",
      { model: null, effort: null, runs: 3 },
      controller.signal,
      () => undefined,
    );
    const rejected = expect(pending).rejects.toThrow();
    let processId: number | undefined;
    const deadline = Date.now() + 3000;
    do {
      try {
        const commands = (await readFile(f.trace, "utf8"))
          .trim()
          .split("\n")
          .map((line) => JSON.parse(line));
        processId = commands.find((command) => command.args.includes("exec"))?.pid;
      } catch {}
      if (processId) break;
      await delay(10);
    } while (Date.now() < deadline);
    controller.abort();
    await rejected;
    expect(processId).toBeTypeOf("number");
    expect(() => process.kill(processId!, 0)).toThrow();
    expect(f.service.snapshot().samples).toHaveLength(0);
    expect(f.service.snapshot().history).toHaveLength(0);
  });
  it("preserves corrupt history, explicitly backs it up, then allows a clean rebuild", async () => {
    const f = await setup();
    const path = join(f.directory, "intelligence-history.json");
    await writeFile(path, "PRIVATE_CORRUPT");
    const signal = new AbortController().signal;
    await f.service.execute(
      "run-intelligence",
      { model: null, effort: null, runs: 1 },
      signal,
      () => undefined,
    );
    expect(f.service.snapshot().error).toBe("HISTORY_INVALID");
    expect(await readFile(path, "utf8")).toBe("PRIVATE_CORRUPT");
    await f.service.execute("clear-intelligence-history", {}, signal, () => undefined);
    expect(f.service.snapshot().history).toEqual([]);
    expect((await readdir(f.directory)).some((name) => name.endsWith(".bak"))).toBe(true);
  });
  it("checks and explicitly updates the CLI through its own updater, using controlled commands and release data", async () => {
    const f = await setup();
    const signal = new AbortController().signal;
    await f.service.execute("check-cli", {}, signal, () => undefined);
    expect(f.service.snapshot()).toMatchObject({
      cliVersion: "1.2.3",
      latestCliVersion: "1.2.4",
      error: null,
    });
    await f.service.execute("update-cli", {}, signal, () => undefined);
    expect(f.service.snapshot()).toMatchObject({
      cliVersion: "1.2.4",
      latestCliVersion: "1.2.4",
      error: null,
    });
  });
});
