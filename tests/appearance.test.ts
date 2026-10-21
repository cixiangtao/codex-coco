import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AppearanceAssets, imageType } from "../apps/desktop/src/modules/appearance/assets";
import {
  appearanceConfigSchema,
  appearanceDefaults,
  appearanceResultSchema,
} from "../apps/desktop/src/modules/appearance/contract";
import {
  buildAppearanceCss,
  injectionExpression,
} from "../apps/desktop/src/modules/appearance/css";
import {
  validateDebuggerUrl,
  isAppearanceTarget,
  type AppearanceConnection,
} from "../apps/desktop/src/modules/appearance/cdp";
import { illustrationPosition } from "../apps/desktop/src/modules/appearance/contract";
import { createAppearanceModule } from "../apps/desktop/src/modules/appearance/runtime";
import { ModuleHost } from "../apps/desktop/src/application/module-host";

const directories: string[] = [];
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jGv8AAAAASUVORK5CYII=",
  "base64",
);
async function directory() {
  const path = await mkdtemp(join(tmpdir(), "codex-coco-appearance-"));
  directories.push(path);
  return path;
}
afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("appearance assets and CSS", () => {
  it("copies and deduplicates raster images, rejects traversal and detects tampering", async () => {
    const dir = await directory();
    const source = join(dir, "misleading.svg");
    await writeFile(source, png);
    const assets = new AppearanceAssets(join(dir, "assets"));
    const id = await assets.import(source);
    expect(await assets.import(source)).toBe(id);
    await writeFile(source, "replaced original");
    expect(await assets.dataUrl(id)).toContain("data:image/png;base64,");
    await expect(assets.dataUrl("../auth.json")).rejects.toThrow();
    await writeFile(join(dir, "assets", id), Buffer.concat([png, Buffer.from("changed")]));
    await expect(assets.dataUrl(id)).rejects.toThrow("IMAGE_INVALID");
    expect(() => imageType(Buffer.from('<svg onload="alert(1)">'))).toThrow("IMAGE_INVALID");
  });
  it("validates ranges and produces independent enabled layers without file URLs", async () => {
    const dir = await directory();
    const source = join(dir, "image.png");
    await writeFile(source, png);
    const assets = new AppearanceAssets(join(dir, "assets"));
    const image = await assets.import(source);
    const config = structuredClone(appearanceDefaults);
    config.main = { ...config.main, enabled: true, image, x: 20, y: 80 };
    const css = await buildAppearanceCss(config, assets);
    expect(css).toContain("left 20% bottom 20%");
    expect(css).toContain("pointer-events:none");
    expect(css).not.toMatch(/file:|auth.json|left-panel|background-attachment/);
    config.wallpaper = { ...config.wallpaper, enabled: true, image, transparency: 0.5 };
    config.sidebar = { ...config.sidebar, enabled: true, image };
    const all = await buildAppearanceCss(config, assets);
    expect(all).toContain('data-codex-coco-surface="sidebar"');
    expect(all).toContain("50%, transparent");
    expect(injectionExpression(all)).not.toContain(dir);
    expect(appearanceConfigSchema.safeParse({ ...config, port: 80 }).success).toBe(false);
    await expect(buildAppearanceCss(appearanceDefaults, assets)).rejects.toThrow("NO_IMAGES");
  });
  it("keeps illustration anchors shared with the preview, including exact center and edges", () => {
    expect(illustrationPosition(0, 100)).toBe("left 0% bottom 0%");
    expect(illustrationPosition(50, 50)).toBe("center center");
    expect(illustrationPosition(82, 76)).toBe("right 18% bottom 24%");
    expect(isAppearanceTarget("app://-/index.html?second=1")).toBe(true);
    for (const url of [
      "app://-/index.html.evil",
      "app://evil/index.html",
      "https://-/index.html",
      "app://-/index.html?avatar-overlay",
    ])
      expect(isAppearanceTarget(url)).toBe(false);
  });
  it("accepts only the exact loopback port and page debugger route", () => {
    expect(validateDebuggerUrl("ws://127.0.0.1:9229/devtools/page/test", 9229)).toContain("test");
    for (const url of [
      "ws://example.com:9229/devtools/page/test",
      "ws://127.0.0.1:1234/devtools/page/test",
      "ws://user@127.0.0.1:9229/devtools/page/test",
      "ws://127.0.0.1:9229/devtools/browser/test",
      "ws://127.0.0.1:9229/devtools/page/test?next=remote",
      "file:///private",
    ])
      expect(() => validateDebuggerUrl(url, 9229)).toThrow();
  });
});

describe("appearance lifecycle", () => {
  async function setup() {
    const dir = await directory();
    const image = join(dir, "image.png");
    await writeFile(image, png);
    const connection = {
      apply: vi.fn<AppearanceConnection["apply"]>(async () => 2),
      remove: vi.fn<AppearanceConnection["remove"]>(async () => 2),
      inspect: vi.fn(async () => 2),
      verify: vi.fn(async () => 2),
    } satisfies AppearanceConnection;
    const definition = createAppearanceModule({
      directory: join(dir, "assets"),
      pickImage: async () => image,
      connection,
    });
    const host = new ModuleHost([definition], join(dir, "config"));
    await host.load();
    const controller = new AbortController();
    const request = vi.fn(() => true);
    const runtime = await definition.start(controller.signal, {
      configuration: () => appearanceDefaults,
      requestOperation: request,
    });
    const config = structuredClone(appearanceDefaults);
    const execute = (name: string) =>
      runtime.execute(name, {}, { signal: controller.signal, config, report: () => undefined });
    return { host, runtime, connection, config, controller, execute, request };
  }
  it("does no target work on enable, applies explicitly, schedules serialized sync and restores on stop", async () => {
    const f = await setup();
    expect(f.connection.inspect).not.toHaveBeenCalled();
    expect(f.connection.apply).not.toHaveBeenCalled();
    const imported = appearanceResultSchema.parse(await f.execute("import-image"));
    f.config.main = { ...f.config.main, enabled: true, image: imported.imported };
    vi.useFakeTimers();
    expect(appearanceResultSchema.parse(await f.execute("apply")).active).toBe(true);
    await vi.advanceTimersByTimeAsync(3000);
    expect(f.request).toHaveBeenCalledWith("sync", {});
    await f.runtime.stop();
    expect(f.connection.remove).toHaveBeenCalledWith(9229, expect.any(AbortSignal));
    const calls = f.request.mock.calls.length;
    await vi.advanceTimersByTimeAsync(9000);
    expect(f.request).toHaveBeenCalledTimes(calls);
    await f.host.shutdown();
  });
  it("retains ownership after partial failure, rejects a port change and reports failed restoration", async () => {
    const f = await setup();
    const imported = appearanceResultSchema.parse(await f.execute("import-image"));
    f.config.main = { ...f.config.main, enabled: true, image: imported.imported };
    f.connection.apply.mockRejectedValueOnce(new Error("PRIVATE_PATH_AND_TOKEN"));
    const failed = await f.execute("apply");
    expect(failed).toMatchObject({ status: "error", reason: "APPLY_FAILED" });
    expect(JSON.stringify(failed)).not.toContain("PRIVATE");
    f.config.port = 9230;
    expect(await f.execute("apply")).toMatchObject({ reason: "REMOVE_FIRST" });
    f.connection.remove.mockRejectedValueOnce(new Error("remote error"));
    expect(await f.execute("remove")).toMatchObject({ status: "error", reason: "RESTORE_FAILED" });
    await f.runtime.stop();
    expect(f.connection.remove.mock.calls.at(-1)?.[0]).toBe(9229);
    await f.host.shutdown();
  });
  it("keeps the last applied look separate from configuration saved for a later application", async () => {
    const f = await setup();
    const imported = appearanceResultSchema.parse(await f.execute("import-image"));
    f.config.main = { ...f.config.main, enabled: true, image: imported.imported, x: 20 };
    await f.execute("apply");
    f.config.main = { ...f.config.main, x: 90 };
    f.connection.verify.mockRejectedValueOnce(new Error("RELOAD"));
    await f.execute("sync");
    expect(f.connection.apply.mock.calls.at(-1)?.[1]).toContain("20%");
    await f.execute("apply");
    expect(f.connection.apply.mock.calls.at(-1)?.[1]).toContain("right 10%");
    await f.runtime.stop();
    await f.host.shutdown();
  });
  it("verifies before reporting active and removes the applied look when all layers are off", async () => {
    const f = await setup();
    const imported = appearanceResultSchema.parse(await f.execute("import-image"));
    f.config.main = { ...f.config.main, enabled: true, image: imported.imported };
    f.connection.verify.mockRejectedValueOnce(new Error("UNSUPPORTED_LAYOUT"));
    expect(await f.execute("apply")).toMatchObject({ active: false, status: "error" });
    expect(f.runtime.state?.()).toMatchObject({ active: false, status: "error", preview: null });
    await f.execute("import-image");
    expect(f.runtime.state?.()).toMatchObject({ status: "error", reason: "APPLY_FAILED" });
    expect(await f.execute("apply")).toMatchObject({ active: true });
    expect(await f.execute("import-image")).toMatchObject({ active: true });
    expect(f.runtime.state?.()).toMatchObject({ active: true, imported: null });
    f.config.main.enabled = false;
    expect(await f.execute("apply")).toMatchObject({ active: false, connectedPort: null });
    expect(f.connection.remove).toHaveBeenCalledWith(9229, expect.any(AbortSignal));
    await f.runtime.stop();
    await f.host.shutdown();
  });
  it("host rejects stale background requests once a runtime is disabled", async () => {
    const dir = await directory();
    let request: ((name: string, input: {}) => boolean) | undefined;
    const definition = createAppearanceModule({
      directory: join(dir, "assets"),
      pickImage: async () => null,
    });
    const original = definition.start;
    definition.start = async (signal, context) => {
      request = context.requestOperation;
      return original(signal, context);
    };
    const host = new ModuleHost([definition], join(dir, "config"));
    await host.load();
    await host.setEnabled({ moduleId: "appearance", enabled: true });
    await host.setEnabled({ moduleId: "appearance", enabled: false });
    expect(request?.("inspect", {})).toBe(false);
    expect(await readFile(join(dir, "config/appearance.json"), "utf8")).toContain(
      '"enabled": false',
    );
    await host.shutdown();
  });
});
