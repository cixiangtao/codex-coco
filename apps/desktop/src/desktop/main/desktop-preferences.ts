import { app, dialog, nativeImage, shell } from "electron";
import { Worker } from "node:worker_threads";
import { join, isAbsolute } from "node:path";
import { readFile, writeFile, mkdir, rename, unlink, lstat } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { MediaAssets } from "../../application/media-assets";
import { rgbaPng } from "../../application/png";
import { runWorkerTask } from "../../application/worker-task";
import type { DesktopToolsDependencies } from "../../modules/desktop-tools/runtime";
import {
  trayFramesSchema,
  bundledTrayIcons,
  type DesktopToolsConfig,
  type TrayFrames,
} from "../../modules/desktop-tools/contract";
import type { GlanceSnapshot } from "../../contracts/glance";
import type { MenuBarController } from "./menu-bar";

export function nativePixelFrames(id: string, snapshot: GlanceSnapshot): TrayFrames {
  const rgba = new Uint8Array(36 * 36 * 4);
  const pixel = (x: number, y: number) => {
    for (let dy = 0; dy < 2; dy++)
      for (let dx = 0; dx < 2; dx++) {
        const at = ((y * 2 + dy) * 36 + x * 2 + dx) * 4;
        rgba[at + 3] = 255;
      }
  };
  const bar = (x: number, y: number, w: number, h: number) => {
    for (let row = y; row < y + h; row++) for (let col = x; col < x + w; col++) pixel(col, row);
  };
  if (id === "grid") {
    bar(3, 3, 5, 5);
    bar(10, 3, 5, 5);
    bar(3, 10, 5, 5);
    bar(10, 10, 5, 5);
  }
  if (id === "bot") {
    bar(4, 5, 10, 9);
    bar(8, 2, 2, 3);
    bar(2, 7, 2, 5);
    bar(14, 7, 2, 5);
    for (const x of [6, 11])
      for (let dy = 0; dy < 2; dy++)
        for (let dx = 0; dx < 2; dx++) {
          const at = ((8 + dy) * 2 * 36 + (x + dx) * 2) * 4;
          for (let a = 0; a < 2; a++)
            for (let b = 0; b < 2; b++) rgba[at + (a * 36 + b) * 4 + 3] = 0;
        }
  }
  if (id === "spark")
    for (let y = 2; y < 16; y++)
      for (let x = 2; x < 16; x++)
        if (
          Math.abs(x - 8.5) + Math.abs(y - 8.5) < 7 &&
          (Math.abs(x - 8.5) < 2 || Math.abs(y - 8.5) < 2)
        )
          pixel(x, y);
  if (id === "pulse")
    for (let x = 1; x < 17; x++) {
      const y = x === 5 ? 12 : x === 6 ? 3 : x === 7 ? 14 : x === 8 ? 7 : 9;
      pixel(x, y);
      if (x > 1) pixel(x - 1, y);
    }
  if (id === "adaptive") {
    const usage = snapshot.items.find((item) => item.id === "usage");
    const windows = usage?.phase === "running" ? usage.metrics?.slice(0, 2) : undefined;
    for (let index = 0; index < 2; index++) {
      const value = Number(windows?.[index]?.value.match(/([\d.]+)%/)?.[1] ?? 0);
      bar(2, 3 + index * 7, 14, 1);
      bar(2, 7 + index * 7, 14, 1);
      bar(2, 3 + index * 7, 1, 5);
      bar(15, 3 + index * 7, 1, 5);
      const fill = Math.round((Math.max(0, Math.min(100, value)) / 100) * 10);
      if (fill) bar(4, 5 + index * 7, fill, 1);
    }
  }
  return { frames: [{ png: rgbaPng(36, 36, rgba).toString("base64"), delay: 100 }] };
}
/** Electron adapters own OS calls; the module sees only bounded public results. */
export function createDesktopPreferences(options: {
  directory: string;
  resources: string;
  workerPath: string;
  menuBar: () => MenuBarController | undefined;
  glance: () => GlanceSnapshot;
}) {
  const iconDirectory = join(options.directory, "tray-icons");
  const assets = new MediaAssets(iconDirectory);
  let config: DesktopToolsConfig | null = null;
  let sharing = false;
  let sharingFailed = false;
  let customSharedDirectory: string | null = null;
  let queue: Promise<unknown> = Promise.resolve();
  const defaultSharedDirectory = join(options.directory, "shared");
  const sharedChoice = join(options.directory, "shared-directory.json");
  const target = () =>
    join(customSharedDirectory ?? defaultSharedDirectory, "codex-coco-widget.json");
  function publish(snapshot: GlanceSnapshot, running = true) {
    if (!sharing && running) return;
    const path = target();
    const body = JSON.stringify({
      version: 1,
      appRunning: running,
      capturedAt: Date.now(),
      items: snapshot.items,
    });
    if (Buffer.byteLength(body, "utf8") > 256 * 1024) {
      sharingFailed = true;
      return;
    }
    queue = queue
      .catch(() => undefined)
      .then(async () => {
        await mkdir(customSharedDirectory ?? defaultSharedDirectory, {
          recursive: true,
          mode: 0o700,
        });
        const temporary = `${path}.${randomUUID()}.tmp`;
        try {
          await writeFile(temporary, body, { mode: 0o600, flag: "wx" });
          await rename(temporary, path);
        } finally {
          await unlink(temporary).catch(() => undefined);
        }
      })
      .then(
        () => {
          sharingFailed = false;
        },
        () => {
          sharingFailed = true;
        },
      );
  }
  async function decode(path: string, signal: AbortSignal, report: (value: number) => void) {
    return trayFramesSchema.parse(
      await runWorkerTask(
        () =>
          new Worker(options.workerPath, {
            stdout: true,
            stderr: true,
            resourceLimits: { maxOldGenerationSizeMb: 128 },
          }),
        { path },
        { signal, report },
      ),
    );
  }
  async function frames(
    value: DesktopToolsConfig,
    signal: AbortSignal,
    report: (value: number) => void,
  ): Promise<{ value: TrayFrames; template: boolean }> {
    const id = value.iconId;
    if (["grid", "adaptive", "bot", "spark", "pulse"].includes(id))
      return { value: nativePixelFrames(id, options.glance()), template: true };
    if (id === "pixel-cat" || id === "pixel-ghost") {
      const images = await Promise.all(
        [0, 1, 2, 3].map(async (index) => {
          const image = nativeImage
            .createFromBuffer(await readFile(join(options.resources, "tray", `${id}-${index}.png`)))
            .resize({ width: 36, height: 36 });
          return { png: image.toPNG().toString("base64"), delay: id === "pixel-cat" ? 360 : 420 };
        }),
      );
      return { value: { frames: images }, template: true };
    }
    if (id.startsWith("builtin:")) {
      if (!bundledTrayIcons.some((icon) => icon.id === id)) throw new Error("IMAGE_INVALID");
      return {
        value: await decode(join(options.resources, "tray", `${id.slice(8)}.gif`), signal, report),
        template: false,
      };
    }
    await assets.bytes(id);
    signal.throwIfAborted();
    if (id.endsWith(".gif"))
      return { value: await decode(join(iconDirectory, id), signal, report), template: false };
    const image = await nativeImage.createThumbnailFromPath(join(iconDirectory, id), {
      width: 36,
      height: 36,
    });
    if (image.isEmpty()) throw new Error("IMAGE_INVALID");
    return {
      value: { frames: [{ png: image.toPNG().toString("base64"), delay: 100 }] },
      template: false,
    };
  }
  const dependencies: DesktopToolsDependencies = {
    login: () => {
      if (process.platform !== "darwin" || !app.isPackaged)
        return { supported: false, enabled: false };
      try {
        return {
          supported: process.platform === "darwin",
          enabled: app.getLoginItemSettings().openAtLogin,
        };
      } catch {
        return { supported: false, enabled: false };
      }
    },
    setLogin: async (enabled) => {
      if (process.platform !== "darwin" || !app.isPackaged) throw new Error("SYSTEM_UNAVAILABLE");
      app.setLoginItemSettings({ openAtLogin: enabled });
    },
    menuBar: async (value, signal, report) => {
      const selected = await frames(value, signal, report);
      signal.throwIfAborted();
      config = value;
      options.menuBar()?.configureIcon(selected.value, {
        animate: value.animate,
        followsCpu: value.followsCpu,
        speed: value.speed,
        template: selected.template,
      });
      return { frameCount: selected.value.frames.length };
    },
    resetMenuBar: () => {
      config = null;
      options.menuBar()?.resetIcon();
    },
    importIcon: async (signal) => {
      const choice = await dialog.showOpenDialog({
        title: "导入菜单栏图标",
        properties: ["openFile"],
        filters: [
          { name: "图片或 GIF", extensions: ["png", "jpg", "jpeg", "webp", "gif", "avif"] },
        ],
      });
      signal.throwIfAborted();
      if (choice.canceled || !choice.filePaths[0]) return null;
      const id = await assets.import(choice.filePaths[0]);
      signal.throwIfAborted();
      if (id.endsWith(".gif")) {
        const decoded = await decode(join(iconDirectory, id), signal, () => undefined);
        return { id, preview: `data:image/png;base64,${decoded.frames[0]!.png}` };
      }
      const image = await nativeImage.createThumbnailFromPath(join(iconDirectory, id), {
        width: 72,
        height: 72,
      });
      if (image.isEmpty()) throw new Error("IMAGE_INVALID");
      return { id, preview: image.toDataURL() };
    },
    removeIcon: async (id) => {
      await assets.bytes(id);
      await unlink(join(iconDirectory, id));
    },
    sharing: async (enabled) => {
      if (enabled && !sharing) {
        try {
          if ((await lstat(sharedChoice)).size > 8192) throw new Error("INVALID_SHARED_DIRECTORY");
          const parsed = JSON.parse(await readFile(sharedChoice, "utf8")) as {
            directory?: unknown;
          };
          if (typeof parsed.directory === "string" && isAbsolute(parsed.directory))
            customSharedDirectory = parsed.directory;
          else throw new Error("INVALID_SHARED_DIRECTORY");
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        }
      }
      const wasSharing = sharing;
      sharing = enabled;
      if (enabled) publish(options.glance());
      else if (wasSharing) publish(options.glance(), false);
      await queue;
      if (sharingFailed) throw new Error("SHARING_FAILED");
    },
    chooseSharedDirectory: async () => {
      const choice = await dialog.showOpenDialog({
        title: "选择 Widget 共享容器目录",
        properties: ["openDirectory"],
      });
      if (choice.canceled || !choice.filePaths[0]) return;
      await queue;
      customSharedDirectory = choice.filePaths[0];
      await mkdir(options.directory, { recursive: true, mode: 0o700 });
      const temporary = `${sharedChoice}.${randomUUID()}.tmp`;
      try {
        await writeFile(temporary, JSON.stringify({ directory: customSharedDirectory }), {
          mode: 0o600,
          flag: "wx",
        });
        await rename(temporary, sharedChoice);
      } finally {
        await unlink(temporary).catch(() => undefined);
      }
      if (sharing) {
        publish(options.glance());
        await queue;
      }
    },
    revealSnapshot: () => shell.showItemInFolder(target()),
  };
  return {
    dependencies,
    updateGlance: (snapshot: GlanceSnapshot) => {
      if (config?.iconId === "adaptive")
        options.menuBar()?.configureIcon(nativePixelFrames("adaptive", snapshot), {
          animate: false,
          followsCpu: false,
          speed: 1,
          template: true,
        });
      publish(snapshot);
    },
    flush: async () => {
      await queue;
    },
  };
}
