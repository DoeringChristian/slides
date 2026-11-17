import type { SlideElement } from '../../types/presentation';
import { objectGroupRoot } from './objectGroups';
import { cropSnapTargets, groupCropBoundary } from './groupCrop';

export type Box = { x: number; y: number; width: number; height: number };
/** What align / distribute move as one: a selected group (relative to the
 *  entered group) or a lone element, and the box it shows. */
export interface ArrangeUnit { ids: string[]; box: Box }

const aabb = (el: SlideElement): Box => {
  if (!el.rotation) return { x: el.x, y: el.y, width: el.width, height: el.height };
  const cx = el.x + el.width / 2, cy = el.y + el.height / 2, r = el.rotation * Math.PI / 180;
  const hw = (Math.abs(el.width * Math.cos(r)) + Math.abs(el.height * Math.sin(r))) / 2;
  const hh = (Math.abs(el.width * Math.sin(r)) + Math.abs(el.height * Math.cos(r))) / 2;
  return { x: cx - hw, y: cy - hh, width: hw * 2, height: hh * 2 };
};

/**
 * The selection as align / distribute see it: each group is one unit, and
 * its box is what it shows — a cropped image counts by the area its crop
 * reveals (cropSnapTargets), not the image underneath, and a crop shape adds
 * nothing of its own when its image is in the unit (its area is the image's
 * visible part). Bound labels ride with their containers, so are left out.
 */
export function arrangeUnits(elements: Record<string, SlideElement>, selectedIds: string[], scope: string | null = null): ArrangeUnit[] {
  const selected = [...new Set(selectedIds)].map(id => elements[id])
    .filter((el): el is SlideElement => !!el && el.visible && !(el.type === 'text' && el.containerId));
  const visible = new Map(cropSnapTargets(Object.values(elements)).map(el => [el.id, el]));
  const units = new Map<string, SlideElement[]>();
  for (const el of selected) {
    const key = objectGroupRoot(el, scope) ?? `element:${el.id}`;
    units.set(key, [...(units.get(key) ?? []), el]);
  }
  return [...units.values()].map(members => {
    const shown = members.filter(m => !(groupCropBoundary(m)
      && members.some(o => o.type === 'image' && o.objectGroupIds?.includes(m.cropGroupId!))));
    const boxes = (shown.length ? shown : members).map(m => aabb(visible.get(m.id) ?? m));
    const x0 = Math.min(...boxes.map(b => b.x)), y0 = Math.min(...boxes.map(b => b.y));
    const x1 = Math.max(...boxes.map(b => b.x + b.width)), y1 = Math.max(...boxes.map(b => b.y + b.height));
    return { ids: members.map(m => m.id), box: { x: x0, y: y0, width: x1 - x0, height: y1 - y0 } };
  });
}

type Updates = Array<{ elementId: string; changes: Partial<Record<'x' | 'y', number>> }>;
const moveUnit = (unit: ArrangeUnit, elements: Record<string, SlideElement>, dx: number, dy: number): Updates =>
  Math.abs(dx) < 1e-9 && Math.abs(dy) < 1e-9 ? [] : unit.ids.map(id => ({ elementId: id, changes: {
    ...(dx ? { x: elements[id].x + dx } : {}), ...(dy ? { y: elements[id].y + dy } : {}) } }));

export type AlignEdge = 'left' | 'center-h' | 'right' | 'top' | 'center-v' | 'bottom';

/** Align the units' visible boxes to the selection's edge or centre. */
export function planAlign(elements: Record<string, SlideElement>, units: ArrangeUnit[], edge: AlignEdge): Updates {
  if (units.length < 2) return [];
  const left = Math.min(...units.map(u => u.box.x)), right = Math.max(...units.map(u => u.box.x + u.box.width));
  const top = Math.min(...units.map(u => u.box.y)), bottom = Math.max(...units.map(u => u.box.y + u.box.height));
  return units.flatMap(({ box, ...u }) => {
    const unit = { ...u, box };
    switch (edge) {
      case 'left': return moveUnit(unit, elements, left - box.x, 0);
      case 'center-h': return moveUnit(unit, elements, (left + right) / 2 - (box.x + box.width / 2), 0);
      case 'right': return moveUnit(unit, elements, right - (box.x + box.width), 0);
      case 'top': return moveUnit(unit, elements, 0, top - box.y);
      case 'center-v': return moveUnit(unit, elements, 0, (top + bottom) / 2 - (box.y + box.height / 2));
      case 'bottom': return moveUnit(unit, elements, 0, bottom - (box.y + box.height));
    }
  });
}

/** Google Slides–style distribute over the units' visible boxes: the
 *  outermost two stay, the ones between get equal gaps. */
export function planDistribute(elements: Record<string, SlideElement>, units: ArrangeUnit[], axis: 'h' | 'v'): Updates {
  if (units.length < 3) return [];
  const pos = axis === 'h' ? 'x' : 'y', size = axis === 'h' ? 'width' : 'height';
  const sorted = [...units].sort((a, b) => a.box[pos] - b.box[pos]);
  const first = sorted[0].box, last = sorted[sorted.length - 1].box;
  const total = sorted.reduce((sum, u) => sum + u.box[size], 0);
  const gap = (last[pos] + last[size] - first[pos] - total) / (sorted.length - 1);
  let cursor = first[pos];
  return sorted.flatMap(unit => {
    const d = cursor - unit.box[pos];
    cursor += unit.box[size] + gap;
    return axis === 'h' ? moveUnit(unit, elements, d, 0) : moveUnit(unit, elements, 0, d);
  });
}
