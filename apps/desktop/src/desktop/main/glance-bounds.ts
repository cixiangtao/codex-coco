export interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}
/** Uses Electron DIP coordinates, including negative monitor origins and constrained work areas. */
export function glanceBounds(anchor: Bounds, workArea: Bounds): Bounds {
  const margin = Math.min(8, Math.floor(Math.min(workArea.width, workArea.height) / 4));
  const width = Math.min(360, workArea.width - margin * 2);
  const height = Math.min(520, workArea.height - margin * 2);
  const minX = workArea.x + margin;
  const maxX = workArea.x + workArea.width - width - margin;
  const minY = workArea.y + margin;
  const maxY = workArea.y + workArea.height - height - margin;
  const below = anchor.y + anchor.height + 4;
  const preferredY =
    below + height <= workArea.y + workArea.height - margin ? below : anchor.y - height - 4;
  return {
    x: Math.round(Math.min(maxX, Math.max(minX, anchor.x + anchor.width / 2 - width / 2))),
    y: Math.round(Math.min(maxY, Math.max(minY, preferredY))),
    width,
    height,
  };
}
