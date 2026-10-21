import { afterEach, describe, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { decodeTrayGif } from "../apps/desktop/src/modules/desktop-tools/gif";
import { animationDelay } from "../apps/desktop/src/modules/desktop-tools/timing";
import {
  createDesktopToolsModule,
  type DesktopToolsDependencies,
} from "../apps/desktop/src/modules/desktop-tools/runtime";
import {
  desktopToolsDefaults,
  desktopToolsResultSchema,
  bundledTrayIcons,
} from "../apps/desktop/src/modules/desktop-tools/contract";

afterEach(() => vi.useRealTimers());
describe("local tray frames", () => {
  it.each(bundledTrayIcons)(
    "decodes licensed $title assets into bounded renderable frames",
    async (icon) => {
      const path = fileURLToPath(
        new URL(`../apps/desktop/resources/tray/${icon.id.slice(8)}.gif`, import.meta.url),
      );
      const result = decodeTrayGif(await readFile(path));
      expect(result.frames.length).toBeGreaterThan(1);
      expect(result.frames.length).toBeLessThanOrEqual(300);
      expect(
        result.frames.every((frame) => frame.delay >= 16 && frame.png.startsWith("iVBOR")),
      ).toBe(true);
      expect(new Set(result.frames.map((frame) => frame.png)).size).toBeGreaterThan(1);
      expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThan(1024 * 1024);
      if (icon.id === "builtin:everonecat0") expect(result.frames).toHaveLength(121);
    },
  );
  it("rejects malformed and excessive logical dimensions before allocating frames", () => {
    const minimal = Buffer.from(
      "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
      "base64",
    );
    minimal.writeUInt16LE(65535, 6);
    minimal.writeUInt16LE(65535, 8);
    expect(() => decodeTrayGif(minimal)).toThrow("IMAGE_INVALID");
    expect(() => decodeTrayGif(Buffer.from("not a gif"))).toThrow();
  });
  it("applies base speed and CPU multiplier only when requested and caps frame frequency", () => {
    expect(animationDelay(100, 1, 0.9, false)).toBe(100);
    expect(animationDelay(100, 2, 0.5, false)).toBe(50);
    expect(animationDelay(100, 1, 0.5, true)).toBe(50);
    expect(animationDelay(100, 3, 1, true)).toBe(16);
  });
});
describe("desktop preference ownership", () => {
  function deps() {
    let openAtLogin = false;
    return {
      login: () => ({ supported: true, enabled: openAtLogin }),
      setLogin: vi.fn(async (value: boolean) => {
        openAtLogin = value;
      }),
      menuBar: vi.fn(async () => ({ frameCount: 2 })),
      resetMenuBar: vi.fn(),
      importIcon: vi.fn(async () => null),
      removeIcon: vi.fn(async () => undefined),
      sharing: vi.fn(async () => undefined),
      chooseSharedDirectory: vi.fn(async () => undefined),
      revealSnapshot: vi.fn(),
    } satisfies DesktopToolsDependencies;
  }
  it("restores only its menu-bar policy and never changes OS login items on start or configuration save", async () => {
    vi.useFakeTimers();
    const dependencies = deps();
    const request = vi.fn(() => true);
    const controller = new AbortController();
    const module = createDesktopToolsModule(dependencies);
    const runtime = await module.start(controller.signal, {
      configuration: () => desktopToolsDefaults,
      requestOperation: request,
    });
    await vi.advanceTimersByTimeAsync(500);
    expect(request).toHaveBeenCalledWith("apply-menu-bar", {});
    expect(dependencies.setLogin).not.toHaveBeenCalled();
    runtime.configurationChanged!({ ...desktopToolsDefaults, launchAtLogin: true });
    await vi.advanceTimersByTimeAsync(500);
    expect(dependencies.setLogin).not.toHaveBeenCalled();
    const response = desktopToolsResultSchema.parse(
      await runtime.execute(
        "apply-login",
        {},
        {
          signal: controller.signal,
          config: { ...desktopToolsDefaults, launchAtLogin: true },
          report: () => undefined,
        },
      ),
    );
    expect(response.openAtLogin).toBe(true);
    expect(dependencies.setLogin).toHaveBeenCalledTimes(1);
    controller.abort();
    await runtime.stop();
    const count = request.mock.calls.length;
    await vi.advanceTimersByTimeAsync(5000);
    expect(request).toHaveBeenCalledTimes(count);
    expect(dependencies.resetMenuBar).toHaveBeenCalledTimes(1);
    expect(dependencies.setLogin).toHaveBeenCalledTimes(1);
    expect(dependencies.sharing).toHaveBeenLastCalledWith(false);
  });
  it("does not remove the selected icon, and maps native failures without exposing paths", async () => {
    const dependencies = deps();
    dependencies.menuBar.mockRejectedValueOnce(new Error("PRIVATE_PATH"));
    const module = createDesktopToolsModule(dependencies);
    const controller = new AbortController();
    const runtime = await module.start(controller.signal, {
      configuration: () => desktopToolsDefaults,
      requestOperation: () => false,
    });
    const result = await runtime.execute(
      "apply-menu-bar",
      {},
      { signal: controller.signal, config: desktopToolsDefaults, report: () => undefined },
    );
    expect(result).toMatchObject({ status: "error", reason: "APPLY_FAILED" });
    expect(JSON.stringify(result)).not.toContain("PRIVATE");
    const id = "a".repeat(64) + ".png";
    const removal = await runtime.execute(
      "remove-tray-icon",
      { id },
      {
        signal: controller.signal,
        config: { ...desktopToolsDefaults, iconId: id },
        report: () => undefined,
      },
    );
    expect(removal).toMatchObject({ status: "error" });
    expect(dependencies.removeIcon).not.toHaveBeenCalled();
    controller.abort();
    await runtime.stop();
  });
});
