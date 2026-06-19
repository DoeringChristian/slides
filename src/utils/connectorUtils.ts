import type { SlideElement, ShapeElement, ConnectorBinding } from '../types/presentation';
import { pathBounds } from './pathShapes';

// Rotate a point around a center by an angle (in degrees)
function rotatePoint(
  px: number,
  py: number,
  cx: number,
  cy: number,
  angleDeg: number
): { x: number; y: number } {
  const rad = angleDeg * Math.PI / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const dx = px - cx;
  const dy = py - cy;
  return {
    x: cx + dx * cos - dy * sin,
    y: cy + dx * sin + dy * cos,
  };
}

// Get the rotation origin for an element
// SVG rotates all elements around the center of their bounding box
function getRotationOrigin(el: SlideElement): { x: number; y: number } {
  return { x: el.x + el.width / 2, y: el.y + el.height / 2 };
}

export function getBindingTarget(
  point: { x: number; y: number },
  elements: SlideElement[],
  excludeId: string,
  threshold: number = 30
): ConnectorBinding | null {
  let bestDist = threshold;
  let bestBinding: ConnectorBinding | null = null;

  for (const el of elements) {
    if (el.id === excludeId) continue;
    // Path shapes (lines, arrows, curves) can't be a binding target themselves.
    if (el.type === 'shape' && el.shapeType === 'path') continue;

    const rotation = el.rotation || 0;
    const origin = getRotationOrigin(el);

    // Define anchor points in local (unrotated) coordinates
    const cx = el.x + el.width / 2;
    const cy = el.y + el.height / 2;
    const localAnchors: Array<{ anchor: ConnectorBinding['anchor']; x: number; y: number }> = [
      { anchor: 'center', x: cx, y: cy },
      { anchor: 'top', x: cx, y: el.y },
      { anchor: 'bottom', x: cx, y: el.y + el.height },
      { anchor: 'left', x: el.x, y: cy },
      { anchor: 'right', x: el.x + el.width, y: cy },
    ];

    // Rotate anchor points around the element's rotation origin
    for (const a of localAnchors) {
      const rotated = rotatePoint(a.x, a.y, origin.x, origin.y, rotation);
      const dist = Math.sqrt((point.x - rotated.x) ** 2 + (point.y - rotated.y) ** 2);
      if (dist < bestDist) {
        bestDist = dist;
        bestBinding = { elementId: el.id, anchor: a.anchor };
      }
    }
  }

  return bestBinding;
}

export function getAnchorPoint(
  element: SlideElement,
  anchor: string
): { x: number; y: number } | null {
  if (!element) return null;

  const cx = element.x + element.width / 2;
  const cy = element.y + element.height / 2;
  const rotation = element.rotation || 0;
  const origin = getRotationOrigin(element);

  // Get anchor point in local (unrotated) coordinates
  let localPoint: { x: number; y: number };
  switch (anchor) {
    case 'center': localPoint = { x: cx, y: cy }; break;
    case 'top': localPoint = { x: cx, y: element.y }; break;
    case 'bottom': localPoint = { x: cx, y: element.y + element.height }; break;
    case 'left': localPoint = { x: element.x, y: cy }; break;
    case 'right': localPoint = { x: element.x + element.width, y: cy }; break;
    default: localPoint = { x: cx, y: cy };
  }

  // Rotate the anchor point around the element's rotation origin
  return rotatePoint(localPoint.x, localPoint.y, origin.x, origin.y, rotation);
}

export function resolveBindingPoint(
  binding: ConnectorBinding,
  elements: Record<string, SlideElement>
): { x: number; y: number } | null {
  const target = elements[binding.elementId];
  if (!target) return null;
  return getAnchorPoint(target, binding.anchor);
}

/**
 * Recompute a path shape's (x, y, width, height, points) so that its first
 * and/or last vertex tracks the connector anchor of `anchorElementId`.
 *
 * Works for ANY vertex count — old code assumed `pts[0..3]` (a 2-vertex
 * line), which on a curve with N > 2 was silently truncating the vertex
 * list down to 2 every time the bound-to element moved. Returns null when
 * the shape isn't a bound path or no rebind is needed.
 */
export function rebindPathToMovedAnchor(
  shape: ShapeElement,
  anchorElementId: string,
  elements: Record<string, SlideElement>,
): { x: number; y: number; width: number; height: number; points: number[] } | null {
  if (shape.shapeType !== 'path') return null;
  const pts = shape.points;
  if (!pts || pts.length < 4) return null;

  // Working set: every vertex in absolute slide coords. Only the first /
  // last get overwritten if a binding moved — interior vertices keep
  // their absolute positions, so a curved path holds its shape.
  const abs = pts.slice();
  for (let i = 0; i < abs.length; i += 2) {
    abs[i] += shape.x;
    abs[i + 1] += shape.y;
  }

  let changed = false;
  if (shape.startBinding?.elementId === anchorElementId) {
    const pt = resolveBindingPoint(shape.startBinding, elements);
    if (pt) { abs[0] = pt.x; abs[1] = pt.y; changed = true; }
  }
  if (shape.endBinding?.elementId === anchorElementId) {
    const pt = resolveBindingPoint(shape.endBinding, elements);
    if (pt) {
      const lastX = abs.length - 2;
      abs[lastX] = pt.x;
      abs[lastX + 1] = pt.y;
      changed = true;
    }
  }
  if (!changed) return null;

  const b = pathBounds(abs);
  return { x: b.x, y: b.y, width: b.width, height: b.height, points: b.points };
}
