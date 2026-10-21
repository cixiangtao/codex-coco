import { readdir, unlink } from "node:fs/promises";
import { join } from "node:path";
import { AppearanceAssets } from "./assets";
import { assetIdSchema, type GalleryItem } from "./contract";
export const bundledBackgrounds = [
  { key: "main/1.png", title: "主面板插画 1", layer: "main" },
  { key: "main/2.png", title: "主面板插画 2", layer: "main" },
  { key: "sidebar/1.png", title: "侧栏插画 1", layer: "sidebar" },
  { key: "sidebar/2.png", title: "侧栏插画 2", layer: "sidebar" },
  { key: "sidebar/3.png", title: "侧栏插画 3", layer: "sidebar" },
  { key: "wallpaper/1.jpg", title: "壁纸 1", layer: "wallpaper" },
  { key: "wallpaper/2.png", title: "壁纸 2", layer: "wallpaper" },
  { key: "wallpaper/3.png", title: "壁纸 3", layer: "wallpaper" },
  { key: "wallpaper/4.jpg", title: "壁纸 4", layer: "wallpaper" },
] as const;
export function createAppearanceGallery(options: {
  directory: string;
  resources: string;
  thumbnail(path: string): Promise<string | null>;
}) {
  const assets = new AppearanceAssets(options.directory);
  return {
    list: async (signal: AbortSignal): Promise<GalleryItem[]> => {
      const builtin = new Map<string, (typeof bundledBackgrounds)[number]>();
      for (const item of bundledBackgrounds) {
        signal.throwIfAborted();
        builtin.set(await assets.import(join(options.resources, item.key)), item);
      }
      const files = (await readdir(options.directory))
        .filter((id) => assetIdSchema.safeParse(id).success)
        .sort();
      const result: GalleryItem[] = [];
      let bytes = 0;
      for (const id of [...builtin.keys(), ...files.filter((id) => !builtin.has(id))].slice(
        0,
        60,
      )) {
        signal.throwIfAborted();
        try {
          await assets.bytes(id);
          const preview = await options.thumbnail(join(options.directory, id));
          if (!preview || preview.length > 24_000 || bytes + preview.length > 550_000) continue;
          bytes += preview.length;
          const item = builtin.get(id);
          result.push({
            id,
            title: item?.title ?? `自定义图片 ${result.filter((i) => !i.builtin).length + 1}`,
            layer: item?.layer ?? null,
            builtin: Boolean(item),
            preview,
          });
        } catch {
          signal.throwIfAborted();
        }
      }
      return result;
    },
    remove: async (id: string) => {
      await assets.bytes(id);
      await unlink(join(options.directory, id));
    },
  };
}
