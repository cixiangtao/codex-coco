import { nativeImage, type NativeImage } from "electron";
import { cpus } from "node:os";
import type { TrayFrames } from "../../modules/desktop-tools/contract";

import { animationDelay } from "../../modules/desktop-tools/timing";

function ticks() {
  return cpus().reduce(
    (sum, cpu) => {
      const { idle, ...busy } = cpu.times;
      const busyTicks = Object.values(busy).reduce((sum, value) => sum + value, 0);
      return { busy: sum.busy + busyTicks, total: sum.total + busyTicks + idle };
    },
    { busy: 0, total: 0 },
  );
}
/** Owns all animation/CPU timers; static icons have no resident sampling. */
export class TrayAnimation {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private sampler: ReturnType<typeof setInterval> | undefined;
  private index = 0;
  private cpu = 0;
  private images: NativeImage[] = [];
  constructor(private readonly update: (image: NativeImage) => void) {}
  configure(
    frames: TrayFrames,
    options: { animate: boolean; followsCpu: boolean; speed: number; template: boolean },
  ) {
    this.stop();
    this.images = frames.frames.map((frame) => {
      const image = nativeImage.createEmpty();
      image.addRepresentation({ scaleFactor: 2, buffer: Buffer.from(frame.png, "base64") });
      image.setTemplateImage(options.template);
      return image;
    });
    this.update(this.images[0]!);
    if (!options.animate || frames.frames.length < 2) return;
    if (options.followsCpu) {
      let previous = ticks();
      this.sampler = setInterval(() => {
        const next = ticks();
        const total = next.total - previous.total;
        this.cpu = total > 0 ? Math.max(0, Math.min(1, (next.busy - previous.busy) / total)) : 0;
        previous = next;
      }, 3000);
    }
    const advance = () => {
      this.timer = setTimeout(
        () => {
          this.index = (this.index + 1) % this.images.length;
          this.update(this.images[this.index]!);
          advance();
        },
        animationDelay(
          frames.frames[this.index]!.delay,
          options.speed,
          this.cpu,
          options.followsCpu,
        ),
      );
    };
    advance();
  }
  stop() {
    clearTimeout(this.timer);
    clearInterval(this.sampler);
    this.timer = undefined;
    this.sampler = undefined;
    this.images = [];
    this.index = 0;
    this.cpu = 0;
  }
}
