import type { SlideElement } from '../../types/presentation';
import { objectGroupRoot } from './objectGroups';
import { shownExtent } from './groupCrop';
import { resizeSelection, selectionResizeBounds } from '../geometry/resizeGeometry';

export type Box = { x: number; y: number; width: number; height: number };
/** What align / distribute move as one: a selected group (relative to the
 *  entered group) or a lone element, and the box it shows. */
export interface ArrangeUnit { ids: string[]; box: Box }

/**
 * The selection as align / distribute see it: each group is one unit, and
 * its box is what it shows (shownExtent) — a cropped image by the area its
 * crop reveals, not the image underneath. Bound labels ride with their
 * containers, so are left out.
 */
export function arrangeUnits(elements: Record<string, SlideElement>, selectedIds: string[], scope: string | null = null): ArrangeUnit[] {
  const selected = [...new Set(selectedIds)].map(id => elements[id])
    .filter((el): el is SlideElement => !!el && el.visible && !(el.type === 'text' && el.containerId));
  const all = Object.values(elements);
  const units = new Map<string, SlideElement[]>();
  for (const el of selected) {
    const key = objectGroupRoot(el, scope) ?? `element:${el.id}`;
    units.set(key, [...(units.get(key) ?? []), el]);
  }
  return [...units.values()].map(members => ({ ids: members.map(m => m.id),
    box: shownExtent(members, all) ?? { x: members[0].x, y: members[0].y, width: 0, height: 0 } }));
}

/** The unit the others are arranged against: the one selected last (shift-
 *  click the reference object last). */
export function targetUnit(units: ArrangeUnit[], selectedIds: string[]): ArrangeUnit | undefined {
  for (let i = selectedIds.length - 1; i >= 0; i--) {
    const unit = units.find(u => u.ids.includes(selectedIds[i]));
    if (unit) return unit;
  }
  return units[units.length - 1];
}

type Updates = Array<{ elementId: string; changes: Partial<SlideElement> }>;
const moveUnit = (unit: ArrangeUnit, elements: Record<string, SlideElement>, dx: number, dy: number): Updates =>
  Math.abs(dx) < 1e-9 && Math.abs(dy) < 1e-9 ? [] : unit.ids.map(id => ({ elementId: id, changes: {
    ...(dx ? { x: elements[id].x + dx } : {}), ...(dy ? { y: elements[id].y + dy } : {}) } }));

export type AlignEdge = 'left' | 'center-h' | 'right' | 'top' | 'center-v' | 'bottom';

/** Align the units' visible boxes to the target's edge or centre (the unit
 *  selected last, which stays put); without a target, to the selection's. */
export function planAlign(elements: Record<string, SlideElement>, units: ArrangeUnit[], edge: AlignEdge, target?: ArrangeUnit): Updates {
  if (units.length < 2) return [];
  const ref = target ? [target] : units;
  const left = Math.min(...ref.map(u => u.box.x)), right = Math.max(...ref.map(u => u.box.x + u.box.width));
  const top = Math.min(...ref.map(u => u.box.y)), bottom = Math.max(...ref.map(u => u.box.y + u.box.height));
  return units.filter(u => u !== target).flatMap(({ box, ...u }) => {
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

/** Give every other unit the target's size (width and height of what it
 *  shows). Each scales as one object — a cropped image with its crop, a group
 *  with its members — and keeps its top-left corner. Free text scales its
 *  font to the target's height. */
export function planMatchSize(elements: Record<string, SlideElement>, units: ArrangeUnit[], target: ArrangeUnit): Updates {
  const members = (unit: ArrangeUnit) => unit.ids.map(id => elements[id]);
  const size = selectionResizeBounds(members(target));
  return units.filter(u => u !== target).flatMap(unit => {
    const els = members(unit);
    const start = selectionResizeBounds(els);
    if (Math.abs(start.width - size.width) < 1e-9 && Math.abs(start.height - size.height) < 1e-9) return [];
    // Free text cannot stretch — its box is its font size: it takes the
    // target's height, its width following the text.
    const [only] = els;
    if (els.length === 1 && only.type === 'text' && !only.containerId) {
      const k = size.height / start.height;
      return [{ elementId: only.id, changes: { x: start.x, y: start.y, width: only.width * k, height: only.height * k,
        style: { ...only.style, fontSize: only.style.fontSize * k } } as Partial<SlideElement> }];
    }
    return resizeSelection(els, start, { x: start.x, y: start.y, width: size.width, height: size.height });
  });
}
