import { inflateSync } from "node:zlib";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { decodeTrayGif } from "../apps/desktop/src/modules/desktop-tools/gif";
import { animationDelay } from "../apps/desktop/src/modules/desktop-tools/timing";
import { TrayContrast } from "../apps/desktop/src/modules/desktop-tools/contrast";
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
  it("tints dark and light transparent line art while retaining colorful artwork", () => {
    for (const color of [
      [0, 0, 0],
      [255, 255, 255],
    ]) {
      const contrast = new TrayContrast();
      const pixels = new Uint8Array(100 * 4);
      for (let index = 0; index < 40; index++) pixels.set([...color, 255], index * 4);
      contrast.add(pixels);
      expect(contrast.template).toBe(true);
    }
    const colorful = new TrayContrast();
    colorful.add(Uint8Array.from(Array.from({ length: 100 }, () => [230, 30, 80, 255]).flat()));
    expect(colorful.template).toBe(false);
    const empty = new TrayContrast();
    empty.add(new Uint8Array(400));
    expect(empty.template).toBe(false);
  });
  it.each(bundledTrayIcons)(
    "decodes licensed $title assets into bounded renderable frames",
    async (icon) => {
      const path = fileURLToPath(
        new URL(`../apps/desktop/resources/tray/${icon.id.slice(8)}.gif`, import.meta.url),
      );
      const result = decodeTrayGif(await readFile(path));
      if (icon.id === "builtin:zhiyin_basketball") expect(result.template).toBe(true);
      if (icon.id === "builtin:pink_cat") expect(result.template).toBe(false);
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
  it("keeps palette backgrounds transparent even when frame-local transparency has a different index", () => {
    // Two frames: transparent/black, then black at the left after disposal=2.
    // Global background is green (index 2); transparency is local index 1.
    const gif = Buffer.from(
      "47494638396102000100810200000000ffffff00ff00ff000021f90409010001002c00000000020001000002020c0a0021f90409010001002c00000000010001000002024401003b",
      "hex",
    );
    const result = decodeTrayGif(gif);
    const pixels = (index: number) => {
      const png = Buffer.from(result.frames[index]!.png, "base64"),
        chunks: Buffer[] = [];
      for (let at = 8; at < png.length;) {
        const length = png.readUInt32BE(at);
        if (png.toString("ascii", at + 4, at + 8) === "IDAT")
          chunks.push(png.subarray(at + 8, at + 8 + length));
        at += 12 + length;
      }
      const raw = inflateSync(Buffer.concat(chunks));
      return (x: number, y: number) =>
        Array.from(raw.subarray(y * 145 + 1 + x * 4, y * 145 + 1 + x * 4 + 4));
    };
    expect(pixels(0)(8, 15)[3]).toBe(0);
    expect(pixels(0)(26, 15)).toEqual([0, 0, 0, 255]);
    expect(pixels(1)(8, 15)).toEqual([0, 0, 0, 255]);
    expect(pixels(1)(26, 15)[3]).toBe(0);
    expect(result.template).toBe(true);
  });
  it("retains graphic control through metadata before the next image", () => {
    const prefix = "47494638396102000100810200000000ffffff00ff00ff000021f9040901000100";
    const application = "21ff0b4e45545343415045322e300301000000";
    const image = "2c00000000020001000002020c0a003b";
    const result = decodeTrayGif(Buffer.from(prefix + application + application + image, "hex"));
    expect(result.frames).toHaveLength(1);
    expect(result.frames[0]!.delay).toBe(16);
    expect(result.template).toBe(true);
  });
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
