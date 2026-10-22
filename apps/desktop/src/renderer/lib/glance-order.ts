import type { GlanceBlockId } from "../../contracts/glance-layout";

/** Moves one selected block to a final index without changing selection or mutating the input. */
export function moveGlanceBlock(
  blocks: readonly GlanceBlockId[],
  id: GlanceBlockId,
  index: number,
) {
  const next = [...blocks];
  const from = next.indexOf(id);
  if (from < 0 || !Number.isInteger(index)) return next;
  next.splice(from, 1);
  next.splice(Math.max(0, Math.min(index, next.length)), 0, id);
  return next;
}
