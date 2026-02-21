export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function getBoundingBox(boxes: BoundingBox[]): BoundingBox {
  if (boxes.length === 0) return { x: 0, y: 0, width: 0, height: 0 };

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const box of boxes) {
    minX = Math.min(minX, box.x);
    minY = Math.min(minY, box.y);
    maxX = Math.max(maxX, box.x + box.width);
    maxY = Math.max(maxY, box.y + box.height);
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

export function boxesIntersect(a: BoundingBox, b: BoundingBox): boolean {
  return !(a.x + a.width < b.x || b.x + b.width < a.x ||
           a.y + a.height < b.y || b.y + b.height < a.y);
}

export function snapToGrid(value: number, gridSize: number): number {
  return Math.round(value / gridSize) * gridSize;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/** Snap angle to nearest increment (in degrees). */
export function snapAngle(degrees: number, increment: number = 15): number {
  return Math.round(degrees / increment) * increment;
}

/** Constrain a point so the angle from `base` to `point` is a multiple of `increment` degrees. */
export function constrainToAngle(
  point: { x: number; y: number },
  base: { x: number; y: number },
  increment: number = 15
): { x: number; y: number } {
  const dx = point.x - base.x;
  const dy = point.y - base.y;
  const angle = Math.atan2(dy, dx) * 180 / Math.PI;
  const snapped = Math.round(angle / increment) * increment;
  const rad = snapped * Math.PI / 180;
  const dist = Math.sqrt(dx * dx + dy * dy);
  return { x: base.x + dist * Math.cos(rad), y: base.y + dist * Math.sin(rad) };
}
