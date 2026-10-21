import { nativeImage } from "electron";

/** Authored 2× monochrome module-grid glyph; embedded PNG avoids asset-path differences after packaging. */
export function createTrayIcon() {
  const image = nativeImage.createEmpty();
  image.addRepresentation({
    scaleFactor: 2,
    buffer: Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAR0lEQVR4nGNgGAWjABP8JxJTS9/gdQCp8uTqG3XAqAMGrwMGPBsOmANGwSgY8EQ4aBxAqvzwKwlHHTDqgAHPhqO14SigCwAA+fr/AVHNI7sAAAAASUVORK5CYII=",
      "base64",
    ),
  });
  image.setTemplateImage(true);
  return image;
}
