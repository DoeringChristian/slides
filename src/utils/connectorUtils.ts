import type { SlideElement, ConnectorBinding, ShapeElement } from '../types/presentation';

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
// Konva rotates shapes around their (x, y) position
// For center-based shapes (ellipse, triangle, star), x/y is the center
// For other shapes (rect, text, image), x/y is the top-left corner
function getRotationOrigin(el: SlideElement): { x: number; y: number } {
  if (el.type === 'shape') {
    const shape = el as ShapeElement;
    if (['ellipse', 'triangle', 'star'].includes(shape.shapeType)) {
      // Center-based shapes: rotation origin is at the center
      return { x: el.x + el.width / 2, y: el.y + el.height / 2 };
    }
  }
  // For rect, text, image, line, arrow: rotation origin is at (x, y) which is top-left
  return { x: el.x, y: el.y };
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
    // Only bind to non-line/non-arrow shapes, text, and images
    if (el.type === 'shape' && (el.shapeType === 'line' || el.shapeType === 'arrow')) continue;

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
