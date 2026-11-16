import type { SlideElement } from '../../types/presentation';
import { getElementBounds, getRotationCenter } from '../geometry/geometry';
import { objectGroupRoot } from '../model/objectGroups';

type Box = { x: number; y: number; width: number; height: number };

/** Axis-aligned extent of an element as drawn, rotation included. */
export function visualExtent(el: SlideElement): Box {
  const b = getElementBounds(el);
  if (!el.rotation) return b;
  const c = getRotationCenter(el), r = el.rotation * Math.PI / 180, cos = Math.cos(r), sin = Math.sin(r);
  const pts = [[b.x, b.y], [b.x + b.width, b.y], [b.x, b.y + b.height], [b.x + b.width, b.y + b.height]]
    .map(([x, y]) => [c.x + (x - c.x) * cos - (y - c.y) * sin, c.y + (x - c.x) * sin + (y - c.y) * cos]);
  const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
  return { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) };
}

const within = (inner: Box, outer: Box) =>
  inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.width <= outer.x + outer.width && inner.y + inner.height <= outer.y + outer.height;

/** The unit an element is selected as: its outermost object group within the
 *  entered group (`scope`), or itself. */
export const selectionUnit = (el: SlideElement, scope: string | null) => objectGroupRoot(el, scope) ?? el.id;

/**
 * What a selection rectangle selects (Inkscape / Excalidraw rule): an object
 * only when the rectangle wholly contains it, a group only when it wholly
 * contains every visible member. Touching is not enough. Hidden objects are
 * never picked; a bound label follows its container rather than being picked
 * on its own. Returns the selected element ids, in slide order.
 */
export function marqueeSelection(
  elements: Record<string, SlideElement>,
  order: string[],
  rect: Box,
  scope: string | null = null,
): string[] {
  const candidates = order.map(id => elements[id]).filter((el): el is SlideElement =>
    !!el && el.visible && !(el.type === 'text' && el.containerId && elements[el.containerId]));
  const members = new Map<string, SlideElement[]>();
  for (const el of candidates) {
    const unit = selectionUnit(el, scope);
    members.set(unit, [...(members.get(unit) ?? []), el]);
  }
  const picked = new Set<string>();
  for (const group of members.values()) {
    if (group.every(el => within(visualExtent(el), rect))) group.forEach(el => picked.add(el.id));
  }
  return candidates.filter(el => picked.has(el.id)).map(el => el.id);
}
