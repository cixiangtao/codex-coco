import { createHash } from "node:crypto";
import { mkdir, open, writeFile, lstat } from "node:fs/promises";
import { join } from "node:path";
import { imageAssetIdSchema as assetIdSchema } from "../contracts/media";

const MAX_IMAGE_BYTES = 25 * 1024 * 1024;
/** Recognizes raster bytes; file extensions and SVG content never become executable CSS. */
export function imageType(bytes: Buffer) {
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return "png";
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return "jpg";
  if (["GIF87a", "GIF89a"].includes(bytes.subarray(0, 6).toString())) return "gif";
  if (bytes.subarray(0, 4).toString() === "RIFF" && bytes.subarray(8, 12).toString() === "WEBP")
    return "webp";
  if (
    bytes.subarray(4, 8).toString() === "ftyp" &&
    ["avif", "avis"].includes(bytes.subarray(8, 12).toString())
  )
    return "avif";
  throw new Error("IMAGE_INVALID");
}
export async function readImageBytes(path: string) {
  const file = await open(path, "r");
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.size > MAX_IMAGE_BYTES || stat.size < 12)
      throw new Error("IMAGE_INVALID");
    const bytes = Buffer.alloc(stat.size + 1);
    let length = 0;
    while (length < bytes.length) {
      const chunk = await file.read(bytes, length, bytes.length - length, length);
      if (!chunk.bytesRead) break;
      length += chunk.bytesRead;
    }
    if (length > MAX_IMAGE_BYTES || length !== stat.size) throw new Error("IMAGE_INVALID");
    return bytes.subarray(0, length);
  } finally {
    await file.close();
  }
}
/** Content addressed copies isolate custom assets from the original file and private paths. */
export class MediaAssets {
  constructor(private readonly directory: string) {}
  async import(path: string) {
    const bytes = await readImageBytes(path);
    const type = imageType(bytes);
    const id = `${createHash("sha256").update(bytes).digest("hex")}.${type}`;
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    try {
      await writeFile(join(this.directory, id), bytes, { flag: "wx", mode: 0o600 });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
    return id;
  }
  async bytes(id: string) {
    assetIdSchema.parse(id);
    const path = join(this.directory, id);
    if (!(await lstat(path)).isFile()) throw new Error("IMAGE_MISSING");
    const bytes = await readImageBytes(path);
    imageType(bytes);
    if (createHash("sha256").update(bytes).digest("hex") !== id.split(".")[0])
      throw new Error("IMAGE_INVALID");
    return bytes;
  }
  async dataUrl(id: string) {
    const bytes = await this.bytes(id);
    const type = imageType(bytes);
    return `data:image/${type === "jpg" ? "jpeg" : type};base64,${bytes.toString("base64")}`;
  }
}
