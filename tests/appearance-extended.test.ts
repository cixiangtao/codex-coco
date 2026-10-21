import { afterEach, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, readFile, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAppearanceLauncher } from "../apps/desktop/src/modules/appearance/launcher";
import { createAppearanceGallery } from "../apps/desktop/src/modules/appearance/gallery";
import { createAppearanceModule } from "../apps/desktop/src/modules/appearance/runtime";
import {
  appearanceDefaults,
  appearanceConfigSchema,
  appearanceResultSchema,
} from "../apps/desktop/src/modules/appearance/contract";
import { AppearanceDiscoveryError } from "../apps/desktop/src/modules/appearance/cdp";
const directories: string[] = [];
async function directory() {
  const path = await mkdtemp(join(tmpdir(), "codex-coco-appearance-extended-"));
  directories.push(path);
  return path;
}
afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});
it("private app selection validates a bundle, allocates loopback ports and never quits on normal launch", async () => {
  const dir = await directory();
  const path = join(dir, "Controlled Codex.app");
  await mkdir(join(path, "Contents"), { recursive: true });
  const canonical = await realpath(path);
  let running = false;
  const calls: string[][] = [];
  const launcher = createAppearanceLauncher({
    file: join(dir, "private.json"),
    pick: async () => path,
    bundleId: "dev.codex-coco.controlled",
    run: async (command, args) => {
      calls.push([command, ...args]);
      if (command.endsWith("plutil"))
        return JSON.stringify({
          CFBundleIdentifier: "dev.codex-coco.controlled",
          CFBundleExecutable: "Controlled Codex",
        });
      if (command.endsWith("ps"))
        return running ? join(canonical, "Contents/MacOS/Controlled Codex") : "";
      if (command.endsWith("osascript")) running = false;
      return "";
    },
  });
  expect(await launcher.selected()).toBe(false);
  await launcher.choose(AbortSignal.timeout(1000));
  const config = { ...appearanceDefaults, portMode: "auto" as const };
  const port = await launcher.launch(config, false, AbortSignal.timeout(1000));
  expect(port).toBeGreaterThan(1023);
  expect(await launcher.port(config)).toBe(port);
  expect(calls.find((c) => c[0] === "/usr/bin/open")).toContain(`--remote-debugging-port=${port}`);
  running = true;
  await expect(launcher.launch(config, false, AbortSignal.timeout(1000))).rejects.toThrow(
    "APP_RUNNING",
  );
  expect(calls.filter((c) => c[0] === "/usr/bin/osascript")).toHaveLength(0);
  await launcher.launch(config, true, AbortSignal.timeout(1000));
  expect(calls.filter((c) => c[0] === "/usr/bin/osascript")).toHaveLength(1);
  expect(await readFile(join(dir, "private.json"), "utf8")).toContain(canonical);
});
it("gallery imports all licensed backgrounds and returns only bounded image IDs and thumbnails", async () => {
  const dir = await directory();
  const gallery = createAppearanceGallery({
    directory: dir,
    resources: join(process.cwd(), "apps/desktop/resources/backgrounds"),
    thumbnail: async () => "data:image/jpeg;base64,preview",
  });
  const list = await gallery.list(AbortSignal.timeout(2000));
  expect(list).toHaveLength(8);
  expect(list.every((item) => item.builtin)).toBe(true);
  expect(JSON.stringify(list)).not.toContain(dir);
  expect(await gallery.list(AbortSignal.timeout(2000))).toEqual(list);
  await expect(gallery.remove("../auth.json")).rejects.toThrow();
});
it("background recovery is opt-in, retries discovery without owning an unreachable port, and serializes through the host", async () => {
  const dir = await directory();
  const request = vi.fn(() => true);
  const connection = {
    apply: vi.fn(async () => 1),
    verify: vi.fn(async () => 1),
    inspect: vi.fn(async () => 1),
    remove: vi.fn(async () => 1),
  };
  const module = createAppearanceModule({
    directory: dir,
    pickImage: async () => null,
    connection,
  });
  vi.useFakeTimers();
  const controller = new AbortController();
  const config = { ...appearanceDefaults, restoreOnEnable: true };
  const runtime = await module.start(controller.signal, {
    configuration: () => config,
    requestOperation: request,
  });
  await vi.advanceTimersByTimeAsync(3000);
  expect(request).toHaveBeenCalledWith("sync", {});
  await runtime.stop();
  await vi.advanceTimersByTimeAsync(9000); // Lifetime abort normally accompanies host stop.
  controller.abort();
  await runtime.stop();
  expect(connection.apply).not.toHaveBeenCalled();
  const second = await module.start(new AbortController().signal, {
    configuration: () => appearanceDefaults,
    requestOperation: request,
  });
  const context = {
    signal: AbortSignal.timeout(1000),
    config: appearanceDefaults,
    report: () => undefined,
  };
  connection.inspect.mockRejectedValueOnce(new AppearanceDiscoveryError("NOT_CONNECTED"));
  expect(appearanceResultSchema.parse(await second.execute("inspect", {}, context)).reason).toBe(
    "NOT_CONNECTED",
  );
  await second.stop();
  expect(connection.remove).not.toHaveBeenCalled();
});
it("migrates legacy configuration to manual restoration and validates named presets", () => {
  const { portMode, restoreOnEnable, presets, ...legacy } = appearanceDefaults;
  void portMode;
  void restoreOnEnable;
  void presets;
  expect(appearanceConfigSchema.parse(legacy)).toEqual(appearanceDefaults);
  expect(
    appearanceConfigSchema.safeParse({
      ...appearanceDefaults,
      presets: [{ id: "bad", title: "", look: legacy }],
    }).success,
  ).toBe(false);
});
