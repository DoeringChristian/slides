import type { SlideElement } from '../../types/presentation';
import { getElementBounds } from '../geometry/geometry';

type Box = { x: number; y: number; width: number; height: number };

/** A press smaller than this (slide units) is a click, not an area. */
const CLICK_SIZE = 5;

const contains = (b: Box, x: number, y: number) => x >= b.x && x <= b.x + b.width && y >= b.y && y <= b.y + b.height;
const inside = (inner: Box, outer: Box) =>
  inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.width <= outer.x + outer.width && inner.y + inner.height <= outer.y + outer.height;

/**
 * What a Comment-tool press is about.
 *
 * - A click on an object: that object (topmost visible one under the point).
 * - A click on empty space: that spot — a zero-size region — so a comment
 *   like "put a chart here" carries its location.
 * - A drag: that area, plus the objects wholly inside it as context.
 */
export function commentTargetAt(
  elements: SlideElement[],
  box: Box,
  pressX: number,
  pressY: number,
): { elementIds: string[] | null; region: Box | null } {
  const visible = elements.filter(el => el.visible);
  if (box.width < CLICK_SIZE && box.height < CLICK_SIZE) {
    const hit = [...visible].reverse().find(el => contains(getElementBounds(el), pressX, pressY));
    return hit ? { elementIds: [hit.id], region: null } : { elementIds: null, region: { x: pressX, y: pressY, width: 0, height: 0 } };
  }
  const within = visible.filter(el => inside(getElementBounds(el), box)).map(el => el.id);
  return { elementIds: within.length ? within : null, region: { ...box } };
}
