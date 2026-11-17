import type { SlideElement } from '../../types/presentation';
import type { ElementBounds } from '../../hooks/useAlignmentGuides';
import { objectGroupRoot } from '../model/objectGroups';
import { shownBoxes, shownExtent } from '../model/groupCrop';

/**
 * What a dragged object snaps to: every object (a group within the entered
 * group, or a lone element) by the box it shows — a cropped image by its
 * visible area. A group's members are also alignment targets (their edges
 * line up), but equal spacing is measured between whole objects only, so
 * hidden crop shapes and a group's insides never make spacing guides.
 * `single` gives a lone element's bounds (text-flow aware).
 */
export function unitSnapSources(rest: SlideElement[], all: SlideElement[], scope: string | null,
  single: (el: SlideElement) => ElementBounds): ElementBounds[] {
  const units = new Map<string, SlideElement[]>();
  for (const el of rest) {
    const key = objectGroupRoot(el, scope) ?? `element:${el.id}`;
    units.set(key, [...(units.get(key) ?? []), el]);
  }
  return [...units.values()].flatMap(members => {
    if (members.length === 1) return [single(members[0])];
    const box = shownExtent(members, all);
    if (!box) return [];
    const inner = [...shownBoxes(members, all).entries()].flatMap(([, b]) => b ? [{ ...b, alignOnly: true }] : []);
    return [box, ...inner];
  });
}

/** The box a dragged set shows, at the positions `at` gives (its start). */
export function draggedExtent(ids: Iterable<string>, elements: Record<string, SlideElement>,
  at: (el: SlideElement) => { x: number; y: number }): ElementBounds | null {
  const set = [...ids].map(id => elements[id]).filter(Boolean).map(el => ({ ...el, ...at(el) }) as SlideElement);
  const all = Object.values(elements).map(el => set.find(s => s.id === el.id) ?? el);
  return set.length ? shownExtent(set, all) : null;
}
