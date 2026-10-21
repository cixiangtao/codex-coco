/** Samples visible pixels across frames; monochrome line art can use the native menu-bar tint.
 * Colorful artwork retains its colors. Both RGBA and BGRA inputs are supported because only
 * neutral colors are eligible; transparent RGB values never influence the decision.
 */
export class TrayContrast {
  private visible = 0;
  private transparent = 0;
  private colored = 0;
  private dark = 0;
  private bright = 0;
  private lightTotal = 0;
  add(pixels: Uint8Array) {
    for (let at = 0; at + 3 < pixels.length; at += 4) {
      if (pixels[at + 3]! < 32) {
        this.transparent++;
        continue;
      }
      this.visible++;
      const channels = [pixels[at]!, pixels[at + 1]!, pixels[at + 2]!];
      if (Math.max(...channels) - Math.min(...channels) > 40) this.colored++;
      const gray = (channels[0]! + channels[1]! + channels[2]!) / 3;
      this.lightTotal += gray / 255;
      if (gray < 115) this.dark++;
      if (gray > 192) this.bright++;
    }
  }
  get template() {
    if (this.visible < 12 || this.colored / this.visible > 0.12) return false;
    return (
      (this.dark / this.visible >= 0.62 && this.lightTotal / this.visible <= 0.42) ||
      (this.bright / this.visible >= 0.85 &&
        this.transparent / (this.visible + this.transparent) >= 0.05)
    );
  }
}
