import type { SlideElement, ConnectorBinding } from '../types/presentation';

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

    const cx = el.x + el.width / 2;
    const cy = el.y + el.height / 2;

    const anchors: Array<{ anchor: ConnectorBinding['anchor']; x: number; y: number }> = [
      { anchor: 'center', x: cx, y: cy },
      { anchor: 'top', x: cx, y: el.y },
      { anchor: 'bottom', x: cx, y: el.y + el.height },
      { anchor: 'left', x: el.x, y: cy },
      { anchor: 'right', x: el.x + el.width, y: cy },
    ];

    for (const a of anchors) {
      const dist = Math.sqrt((point.x - a.x) ** 2 + (point.y - a.y) ** 2);
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

  switch (anchor) {
    case 'center': return { x: cx, y: cy };
    case 'top': return { x: cx, y: element.y };
    case 'bottom': return { x: cx, y: element.y + element.height };
    case 'left': return { x: element.x, y: cy };
    case 'right': return { x: element.x + element.width, y: cy };
    default: return { x: cx, y: cy };
  }
}

export function resolveBindingPoint(
  binding: ConnectorBinding,
  elements: Record<string, SlideElement>
): { x: number; y: number } | null {
  const target = elements[binding.elementId];
  if (!target) return null;
  return getAnchorPoint(target, binding.anchor);
}
