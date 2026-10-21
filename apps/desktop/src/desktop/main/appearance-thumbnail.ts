import { nativeImage } from "electron";
import { imageSizeFromFile } from "image-size/fromFile";

/** Read headers without decoding the full image on the main thread; preserve EXIF orientation. */
export async function appearanceThumbnail(
  path: string,
  bounds: { width: number; height: number },
  limit: number,
) {
  const metadata = await imageSizeFromFile(path);
  const rotated = metadata.orientation !== undefined && metadata.orientation >= 5;
  const width = rotated ? metadata.height : metadata.width;
  const height = rotated ? metadata.width : metadata.height;
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
  const scale = Math.min(1, bounds.width / width, bounds.height / height);
  let image = await nativeImage.createThumbnailFromPath(path, {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  });
  if (image.isEmpty()) return null;
  for (let attempt = 0; attempt < 5; attempt++) {
    const preview = image.toDataURL();
    if (preview.length < limit) return preview;
    const size = image.getSize();
    image = image.resize({
      width: Math.max(1, Math.floor(size.width * 0.7)),
      height: Math.max(1, Math.floor(size.height * 0.7)),
    });
  }
  return null;
}
