import { afterEach, expect, it, vi } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ModuleRuntime } from "../apps/desktop/src/application/module-host";
import { ModuleConfigStore } from "../apps/desktop/src/application/module-config-store";
import { AppearanceAssets } from "../apps/desktop/src/modules/appearance/assets";
import type { AppearanceConnection } from "../apps/desktop/src/modules/appearance/cdp";
import type { AppearanceLauncher } from "../apps/desktop/src/modules/appearance/launcher";
import {
  appearanceConfigSchema,
  appearanceDefaults,
  type AppearanceConfig,
} from "../apps/desktop/src/modules/appearance/contract";
import { createAppearanceModule } from "../apps/desktop/src/modules/appearance/runtime";

const directories: string[] = [];
const lifetimes: { controller: AbortController; runtime: ModuleRuntime }[] = [];
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jGv8AAAAASUVORK5CYII=",
  "base64",
);

async function fixture(withImage = false) {
  const directory = await mkdtemp(join(tmpdir(), "codex-coco-appearance-startup-"));
  directories.push(directory);
  const assetsDirectory = join(directory, "assets");
  let config: AppearanceConfig = structuredClone(appearanceDefaults);
  if (withImage) {
    const source = join(directory, "image.png");
    await writeFile(source, png);
    const image = await new AppearanceAssets(assetsDirectory).import(source);
    config.main = { ...config.main, enabled: true, image };
  }
  const connection = {
    apply: vi.fn<AppearanceConnection["apply"]>(async () => 1),
    verify: vi.fn<AppearanceConnection["verify"]>(async () => 1),
    inspect: vi.fn<AppearanceConnection["inspect"]>(async () => 1),
    remove: vi.fn<AppearanceConnection["remove"]>(async () => 1),
  };
  const launcher = {
    selected: vi.fn<AppearanceLauncher["selected"]>(async () => true),
    choose: vi.fn<AppearanceLauncher["choose"]>(async () => true),
    port: vi.fn<AppearanceLauncher["port"]>(async () => 9229),
    probe: vi.fn<NonNullable<AppearanceLauncher["probe"]>>(async () => ({
      running: false,
      debugPort: null,
    })),
    launch: vi.fn<AppearanceLauncher["launch"]>(async () => 9330),
  };
  const confirmRestart = vi.fn<(signal: AbortSignal) => Promise<boolean>>(async () => false);
  const requestOperation = vi.fn(() => true);
  const definition = createAppearanceModule({
    directory: assetsDirectory,
    connection,
    launcher,
    confirmRestart,
    pickImage: async () => null,
  });
  const controller = new AbortController();
  return {
    directory,
    definition,
    connection,
    launcher,
    confirmRestart,
    requestOperation,
    controller,
    configuration: () => config,
    configure(value: Partial<AppearanceConfig>) {
      config = { ...config, ...value };
    },
    context: () => ({ signal: controller.signal, config, report: () => undefined }),
    async start() {
      const runtime = await definition.start(controller.signal, {
        configuration: () => config,
        requestOperation,
      });
      lifetimes.push({ controller, runtime });
      return runtime;
    },
  };
}

afterEach(async () => {
  for (const { controller, runtime } of lifetimes.splice(0)) {
    controller.abort();
    await runtime.stop();
  }
  vi.useRealTimers();
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

it.each([1, 2])(
  "migrates v%i settings without enabling a disabled module or changing the saved scene",
  async (version) => {
    const setup = await fixture(true);
    const { connectOnEnable, ...legacy } = setup.configuration();
    expect(connectOnEnable).toBe(true);
    const file = join(setup.directory, "appearance.json");
    await writeFile(
      file,
      JSON.stringify({ schemaVersion: version, revision: 7, enabled: false, value: legacy }),
    );
    const store = new ModuleConfigStore(file, setup.definition.config);
    expect(await store.load()).toMatchObject({
      schemaVersion: 3,
      enabled: false,
      health: "ok",
      value: { ...legacy, connectOnEnable: true },
    });
    expect(JSON.parse(await readFile(file, "utf8")).value).toEqual({
      ...legacy,
      connectOnEnable: true,
    });
    expect(
      appearanceConfigSchema.parse({ ...legacy, connectOnEnable: false }).connectOnEnable,
    ).toBe(false);
  },
);

it("retries a busy startup dispatch, accepts it only once and does not launch outside the host task", async () => {
  const setup = await fixture();
  vi.useFakeTimers();
  setup.requestOperation.mockReturnValueOnce(false).mockReturnValueOnce(false);
  await setup.start();
  await vi.advanceTimersByTimeAsync(99);
  expect(setup.requestOperation).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(201);
  expect(setup.requestOperation.mock.calls).toEqual([
    ["connect-on-enable", {}],
    ["connect-on-enable", {}],
    ["connect-on-enable", {}],
  ]);
  await vi.advanceTimersByTimeAsync(30_000);
  expect(setup.requestOperation).toHaveBeenCalledTimes(3);
  expect(setup.launcher.launch).not.toHaveBeenCalled();
});

it.each(["stop", "abort"])("cancels rejected startup retries on %s", async (action) => {
  const setup = await fixture();
  vi.useFakeTimers();
  setup.requestOperation.mockReturnValue(false);
  const runtime = await setup.start();
  await vi.advanceTimersByTimeAsync(100);
  expect(setup.requestOperation).toHaveBeenCalledTimes(1);
  if (action === "stop") await runtime.stop();
  else setup.controller.abort();
  await vi.advanceTimersByTimeAsync(10_000);
  expect(setup.requestOperation).toHaveBeenCalledTimes(1);
  expect(setup.launcher.launch).not.toHaveBeenCalled();
});

it("keeps the automatic-connection opt-out and missing application selection free of launch side effects", async () => {
  const setup = await fixture();
  setup.configure({ connectOnEnable: false });
  vi.useFakeTimers();
  const runtime = await setup.start();
  await vi.advanceTimersByTimeAsync(10_000);
  expect(setup.requestOperation).not.toHaveBeenCalledWith("connect-on-enable", {});
  await runtime.execute("connect-on-enable", {}, setup.context());
  expect(setup.launcher.launch).not.toHaveBeenCalled();
  setup.configure({ connectOnEnable: true });
  setup.launcher.selected.mockResolvedValue(false);
  expect(await runtime.execute("connect-on-enable", {}, setup.context())).toMatchObject({
    connection: "not-selected",
    appSelected: false,
  });
  expect(setup.launcher.choose).not.toHaveBeenCalled();
  expect(setup.launcher.launch).not.toHaveBeenCalled();
  expect(setup.confirmRestart).not.toHaveBeenCalled();
});

it("cold starts a selected application, waits for its window and verifies the saved scene before success", async () => {
  const setup = await fixture(true);
  const runtime = await setup.start();
  let ready!: (targets: number) => void;
  setup.connection.inspect.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        ready = resolve;
      }),
  );
  const context = setup.context();
  const connecting = runtime.execute("connect-on-enable", {}, context);
  await vi.waitFor(() => expect(setup.connection.inspect).toHaveBeenCalled());
  expect(setup.launcher.launch).toHaveBeenCalledWith(context.config, false, context.signal);
  expect(setup.confirmRestart).not.toHaveBeenCalled();
  expect(setup.connection.apply).not.toHaveBeenCalled();
  ready(1);
  expect(await connecting).toMatchObject({
    status: "ready",
    active: true,
    connection: "ready",
    connectedPort: 9330,
    targets: 1,
  });
  expect(setup.connection.apply).toHaveBeenCalledWith(9330, expect.any(String), context.signal);
  expect(setup.connection.verify).toHaveBeenCalledWith(
    9330,
    context.signal,
    setup.connection.apply.mock.calls[0]![1],
  );
});

it("reuses the running application's verified debug port without launching or requesting a restart", async () => {
  const setup = await fixture(true);
  setup.launcher.probe.mockResolvedValue({ running: true, debugPort: 9441 });
  const runtime = await setup.start();
  const context = setup.context();
  expect(await runtime.execute("connect-on-enable", {}, context)).toMatchObject({
    status: "ready",
    active: true,
    connection: "ready",
    connectedPort: 9441,
  });
  expect(setup.connection.inspect).toHaveBeenCalledWith(9441, context.signal);
  expect(setup.connection.apply).toHaveBeenCalledWith(9441, expect.any(String), context.signal);
  expect(setup.launcher.launch).not.toHaveBeenCalled();
  expect(setup.confirmRestart).not.toHaveBeenCalled();
});

it("keeps a running ordinary instance after declined consent and never re-prompts from monitoring", async () => {
  const setup = await fixture(true);
  setup.launcher.probe.mockResolvedValue({ running: true, debugPort: null });
  const runtime = await setup.start();
  expect(await runtime.execute("connect-on-enable", {}, setup.context())).toMatchObject({
    connection: "needs-restart",
    active: false,
  });
  expect(setup.confirmRestart).toHaveBeenCalledTimes(1);
  for (let i = 0; i < 3; i++) await runtime.execute("monitor", {}, setup.context());
  expect(setup.confirmRestart).toHaveBeenCalledTimes(1);
  expect(setup.launcher.launch).not.toHaveBeenCalled();
  expect(setup.connection.apply).not.toHaveBeenCalled();
  expect(setup.connection.remove).not.toHaveBeenCalled();
});

it.each([
  { running: true, debugPort: null, restart: true },
  { running: false, debugPort: null, restart: false },
  { running: true, debugPort: 9442, restart: null },
])(
  "rechecks the target after consent before launch or reuse: %j",
  async ({ running, debugPort, restart }) => {
    const setup = await fixture(true);
    setup.launcher.probe
      .mockResolvedValueOnce({ running: true, debugPort: null })
      .mockResolvedValue({ running, debugPort });
    setup.confirmRestart.mockResolvedValue(true);
    const runtime = await setup.start();
    expect(await runtime.execute("connect-on-enable", {}, setup.context())).toMatchObject({
      status: "ready",
      active: true,
      connection: "ready",
      connectedPort: debugPort ?? 9330,
    });
    expect(setup.confirmRestart).toHaveBeenCalledTimes(1);
    if (restart === null) expect(setup.launcher.launch).not.toHaveBeenCalled();
    else
      expect(setup.launcher.launch).toHaveBeenCalledWith(
        setup.configuration(),
        restart,
        setup.controller.signal,
      );
  },
);

it.each(["cancel-task", "disable-policy", "stop-runtime"])(
  "does not launch after %s while restart confirmation is pending",
  async (action) => {
    const setup = await fixture();
    setup.launcher.probe.mockResolvedValue({ running: true, debugPort: null });
    let answer!: (accepted: boolean) => void;
    setup.confirmRestart.mockImplementation(
      () =>
        new Promise((resolve) => {
          answer = resolve;
        }),
    );
    const runtime = await setup.start();
    const connecting = runtime.execute("connect-on-enable", {}, setup.context());
    // Install a rejection handler before cancellation to avoid an unhandled task rejection.
    const settled = connecting.then(
      (value) => ({ value }),
      (error: unknown) => ({ error }),
    );
    await vi.waitFor(() => expect(setup.confirmRestart).toHaveBeenCalledTimes(1));
    if (action === "cancel-task") setup.controller.abort(new Error("CONTROLLED_CANCEL"));
    else if (action === "stop-runtime") await runtime.stop();
    else {
      setup.configure({ connectOnEnable: false });
      runtime.configurationChanged?.(setup.configuration());
    }
    answer(true);
    const result = await settled;
    if (action === "cancel-task") expect(result).toHaveProperty("error");
    expect(setup.launcher.launch).not.toHaveBeenCalled();
    expect(setup.connection.apply).not.toHaveBeenCalled();
  },
);

it("reports an opened connection without applying a scene when every saved layer is disabled", async () => {
  const setup = await fixture();
  const runtime = await setup.start();
  expect(await runtime.execute("connect-on-enable", {}, setup.context())).toMatchObject({
    status: "ready",
    connection: "ready",
    connectedPort: 9330,
    active: false,
  });
  expect(setup.launcher.launch).toHaveBeenCalledTimes(1);
  expect(setup.connection.apply).not.toHaveBeenCalled();
  expect(setup.connection.verify).not.toHaveBeenCalled();
});

it("does not relaunch a target closed after startup when synchronization or monitoring runs", async () => {
  const setup = await fixture(true);
  const runtime = await setup.start();
  await runtime.execute("connect-on-enable", {}, setup.context());
  setup.connection.inspect.mockRejectedValue(new Error("NOT_CONNECTED"));
  setup.connection.verify.mockRejectedValue(new Error("NOT_CONNECTED"));
  setup.connection.apply.mockRejectedValue(new Error("NOT_CONNECTED"));
  await runtime.execute("monitor", {}, setup.context());
  await runtime.execute("sync", {}, setup.context());
  expect(setup.launcher.launch).toHaveBeenCalledTimes(1);
  expect(setup.confirmRestart).not.toHaveBeenCalled();
});

it("reports verification failure instead of treating a successful process launch as an applied scene", async () => {
  const setup = await fixture(true);
  setup.connection.verify.mockRejectedValue(new Error("PRIVATE_NATIVE_PATH_AND_COMMAND"));
  const runtime = await setup.start();
  const result = await runtime.execute("connect-on-enable", {}, setup.context());
  expect(result).toMatchObject({ status: "error", reason: "APPLY_FAILED", active: false });
  expect(JSON.stringify(result)).not.toContain("PRIVATE_NATIVE");
  expect(setup.launcher.launch).toHaveBeenCalledTimes(1);
  expect(setup.connection.apply).toHaveBeenCalledTimes(1);
});

it("lets an explicit scene removal supersede a startup connection waiting for the host", async () => {
  const setup = await fixture();
  vi.useFakeTimers();
  setup.requestOperation.mockReturnValue(false);
  const runtime = await setup.start();
  await vi.advanceTimersByTimeAsync(100);
  await runtime.execute("remove", {}, setup.context());
  await vi.advanceTimersByTimeAsync(10_000);
  expect(setup.requestOperation).toHaveBeenCalledTimes(1);
  expect(setup.launcher.launch).not.toHaveBeenCalled();
});

it("preserves opt-in restoration through a manually opened CDP port when no application is selected", async () => {
  const setup = await fixture(true);
  setup.configure({ connectOnEnable: true, restoreOnEnable: true, port: 9450 });
  setup.launcher.selected.mockResolvedValue(false);
  vi.useFakeTimers();
  const runtime = await setup.start();
  await vi.advanceTimersByTimeAsync(100);
  expect(setup.requestOperation).toHaveBeenCalledWith("connect-on-enable", {});
  const context = setup.context();
  expect(await runtime.execute("connect-on-enable", {}, context)).toMatchObject({
    connection: "not-selected",
    appSelected: false,
  });
  expect(setup.connection.apply).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(3000);
  expect(setup.requestOperation).toHaveBeenCalledWith("sync", {});
  expect(await runtime.execute("sync", {}, context)).toMatchObject({
    status: "ready",
    active: true,
    connection: "ready",
    connectedPort: 9450,
  });
  expect(setup.connection.apply).toHaveBeenCalledWith(9450, expect.any(String), context.signal);
  expect(setup.connection.verify).toHaveBeenCalledWith(9450, context.signal, expect.any(String));
  expect(setup.launcher.launch).not.toHaveBeenCalled();
  expect(setup.launcher.choose).not.toHaveBeenCalled();
  expect(setup.confirmRestart).not.toHaveBeenCalled();
});

it.each([false, true])(
  "does not continue a pending process probe after stop (consent already given: %s)",
  async (confirmed) => {
    const setup = await fixture();
    let finishProbe!: (value: { running: boolean; debugPort: number | null }) => void;
    if (confirmed) {
      setup.launcher.probe.mockResolvedValueOnce({ running: true, debugPort: null });
      setup.confirmRestart.mockResolvedValue(true);
    }
    setup.launcher.probe.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishProbe = resolve;
        }),
    );
    const runtime = await setup.start();
    const connecting = runtime.execute("connect-on-enable", {}, setup.context());
    await vi.waitFor(() => expect(setup.launcher.probe).toHaveBeenCalledTimes(confirmed ? 2 : 1));
    await runtime.stop();
    const cancelled = expect(connecting).rejects.toThrow("NOT_CONNECTED");
    finishProbe({ running: false, debugPort: null });
    await cancelled;
    expect(setup.launcher.launch).not.toHaveBeenCalled();
    expect(setup.connection.inspect).not.toHaveBeenCalled();
    expect(setup.connection.apply).not.toHaveBeenCalled();
    expect(setup.confirmRestart).toHaveBeenCalledTimes(confirmed ? 1 : 0);
  },
);
