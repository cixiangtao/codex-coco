import { parseGIF, decompressFrame } from "gifuct-js";
import { rgbaPng } from "../../application/png.ts";
import { trayFramesSchema, type TrayFrames } from "./contract.ts";
/** Composes GIF disposal/transparency frame by frame and reduces frames to 2× menu-bar pixels. */
export function decodeTrayGif(
  bytes: Buffer,
  report: (value: number) => void = () => undefined,
): TrayFrames {
  const gif = parseGIF(Uint8Array.from(bytes).buffer);
  const width = gif.lsd.width;
  const height = gif.lsd.height;
  const frames = gif.frames.filter((frame) => "image" in frame);
  if (
    width < 1 ||
    height < 1 ||
    width * height > 4_000_000 ||
    !frames.length ||
    frames.length > 300
  )
    throw new Error("IMAGE_INVALID");
  const pixels = frames.reduce(
    (sum, frame) => sum + frame.image.descriptor.width * frame.image.descriptor.height,
    0,
  );
  if (pixels > 32_000_000) throw new Error("IMAGE_INVALID");
  let canvas = new Uint8Array(width * height * 4);
  const background = gif.gct?.[gif.lsd.backgroundColorIndex];
  const firstTransparent =
    frames[0]?.gce?.extras?.transparentColorGiven &&
    frames[0]?.gce?.transparentColorIndex === gif.lsd.backgroundColorIndex;
  if (background && !firstTransparent)
    for (let at = 0; at < canvas.length; at += 4) canvas.set([...background, 255], at);
  let restore: Uint8Array<ArrayBuffer> | null = null;
  let previous: {
    left: number;
    top: number;
    width: number;
    height: number;
    disposal: number;
    transparent: number;
  } | null = null;
  const result: TrayFrames = { frames: [] };
  let encodedBytes = 0;
  for (let index = 0; index < frames.length; index++) {
    if (previous?.disposal === 2) {
      const background = gif.gct?.[gif.lsd.backgroundColorIndex];
      const transparent = previous.transparent === gif.lsd.backgroundColorIndex;
      for (let y = previous.top; y < previous.top + previous.height; y++)
        for (let x = previous.left; x < previous.left + previous.width; x++) {
          const at = (y * width + x) * 4;
          canvas[at] = background?.[0] ?? 0;
          canvas[at + 1] = background?.[1] ?? 0;
          canvas[at + 2] = background?.[2] ?? 0;
          canvas[at + 3] = transparent || !background ? 0 : 255;
        }
    }
    if (previous?.disposal === 3 && restore) canvas = restore;
    const frame = decompressFrame(frames[index]!, gif.gct, true);
    const { left, top, width: fw, height: fh } = frame.dims;
    if (left < 0 || top < 0 || fw < 1 || fh < 1 || left + fw > width || top + fh > height)
      throw new Error("IMAGE_INVALID");
    restore = frame.disposalType === 3 ? canvas.slice() : null;
    for (let y = 0; y < fh; y++)
      for (let x = 0; x < fw; x++) {
        const at = (y * fw + x) * 4;
        if (frame.patch[at + 3] === 0) continue;
        canvas.set(frame.patch.subarray(at, at + 4), ((top + y) * width + left + x) * 4);
      }
    const scaled = new Uint8Array(36 * 36 * 4);
    const scale = Math.min(36 / width, 36 / height);
    const dw = Math.max(1, Math.round(width * scale));
    const dh = Math.max(1, Math.round(height * scale));
    const ox = Math.floor((36 - dw) / 2);
    const oy = Math.floor((36 - dh) / 2);
    for (let y = 0; y < dh; y++)
      for (let x = 0; x < dw; x++) {
        const sx = Math.min(width - 1, Math.floor(x / scale));
        const sy = Math.min(height - 1, Math.floor(y / scale));
        scaled.set(
          canvas.subarray((sy * width + sx) * 4, (sy * width + sx) * 4 + 4),
          ((oy + y) * 36 + ox + x) * 4,
        );
      }
    const png = rgbaPng(36, 36, scaled).toString("base64");
    encodedBytes += png.length;
    if (encodedBytes > 900_000) throw new Error("IMAGE_INVALID");
    result.frames.push({ png, delay: Math.max(16, Math.min(10_000, frame.delay || 100)) });
    previous = {
      left,
      top,
      width: fw,
      height: fh,
      disposal: frame.disposalType,
      transparent: frame.transparentIndex,
    };
    report(Math.round(((index + 1) / frames.length) * 100));
  }
  return trayFramesSchema.parse(result);
}
