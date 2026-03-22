import type { SlideElement, ShapeElement } from '../types/presentation';

export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Point {
  x: number;
  y: number;
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

/**
 * Calculate bounding box for lines/arrows from their points array.
 * Points are stored relative to element position.
 */
export function getLineBoundingBox(element: ShapeElement): BoundingBox {
  const points = element.points ?? [0, 0, element.width, 0];
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

  for (let i = 0; i < points.length; i += 2) {
    minX = Math.min(minX, points[i]);
    maxX = Math.max(maxX, points[i]);
    minY = Math.min(minY, points[i + 1]);
    maxY = Math.max(maxY, points[i + 1]);
  }

  return { x: element.x + minX, y: element.y + minY, width: maxX - minX, height: maxY - minY };
}

/**
 * Get the center point for rotation of a line/arrow.
 * Lines rotate around their midpoint, not the bounding box center.
 */
export function getLineCenter(element: ShapeElement): Point {
  const points = element.points ?? [0, 0, element.width, 0];
  return {
    x: element.x + (points[0] + points[2]) / 2,
    y: element.y + (points[1] + points[3]) / 2,
  };
}

/**
 * Get effective bounding box for any element.
 * Returns line bounding box for lines/arrows, standard bounds otherwise.
 */
export function getElementBounds(element: SlideElement): BoundingBox {
  if (element.type === 'shape') {
    const shape = element as ShapeElement;
    if (shape.shapeType === 'line' || shape.shapeType === 'arrow') {
      return getLineBoundingBox(shape);
    }
  }
  return { x: element.x, y: element.y, width: element.width, height: element.height };
}

/**
 * Get element center for rotation transform.
 * Handles special case for lines/arrows which rotate around line midpoint.
 */
export function getElementCenter(element: SlideElement): Point {
  if (element.type === 'shape') {
    const shape = element as ShapeElement;
    if (shape.shapeType === 'line' || shape.shapeType === 'arrow') {
      return getLineCenter(shape);
    }
  }
  return {
    x: element.x + element.width / 2,
    y: element.y + element.height / 2,
  };
}

/**
 * Build SVG rotation transform string for an element.
 */
export function getSVGRotationTransform(element: SlideElement): string | undefined {
  if (!element.rotation) return undefined;
  const center = getElementCenter(element);
  return `rotate(${element.rotation}, ${center.x}, ${center.y})`;
}
