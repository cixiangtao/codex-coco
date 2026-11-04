interface CardRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Packs the proposed row-major order without stretching Cards into another Card's dimensions. */
export function glanceGridPositions(
  rects: readonly CardRect[],
  width: number,
  gap: number,
  activeIndex: number,
  overIndex: number,
) {
  if (!rects.length || !rects[activeIndex] || !rects[overIndex]) return [];
  const indices = rects.map((_, index) => index);
  const [active] = indices.splice(activeIndex, 1);
  indices.splice(overIndex, 0, active!);
  const left = Math.min(...rects.map((rect) => rect.left));
  let top = Math.min(...rects.map((rect) => rect.top));
  let column = 0;
  let rowHeight = 0;
  const positions: { left: number; top: number }[] = [];
  for (const index of indices) {
    const rect = rects[index]!;
    const full = rect.width > width / 2;
    if (full && column === 1) {
      top += rowHeight + gap;
      column = 0;
      rowHeight = 0;
    }
    positions[index] = { left: left + column * ((width + gap) / 2), top };
    rowHeight = Math.max(rowHeight, rect.height);
    column += full ? 2 : 1;
    if (column === 2) {
      top += rowHeight + gap;
      column = 0;
      rowHeight = 0;
    }
  }
  return positions;
}
