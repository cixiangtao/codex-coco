export function animationDelay(base: number, speed: number, cpu: number, followsCpu: boolean) {
  const multiplier = followsCpu ? 1 / Math.max(0.1, 1 - Math.max(0, Math.min(1, cpu))) : 1;
  return Math.max(16, base / Math.max(0.5, Math.min(3, speed)) / multiplier);
}
