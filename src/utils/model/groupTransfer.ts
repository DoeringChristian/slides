import type { Slide, SlideElement } from '../../types/presentation';
import { copyNestedFields } from '../editor/propertyFields';
import { expandWithBoundTexts } from './syncDependents';

/** Transfer membership includes hidden children and crop boundaries. Selection
 * expansion intentionally excludes those, so it cannot define a copy unit. */
export function transferIds(source: Slide, ids: string[]): string[] {
  const roots = new Set(ids.flatMap(id => source.elements[id]?.objectGroupIds?.slice(0, 1) ?? []));
  const members = new Set(expandWithBoundTexts(source.elements, source.elementOrder,
    [...ids, ...source.elementOrder.filter(id => roots.has(source.elements[id]?.objectGroupIds?.[0] ?? ''))]));
  return source.elementOrder.filter(id => members.has(id));
}
export function planSlideTransfer(source: Slide, target: Slide, ids: string[], fields: string[]) {
  return transferIds(source, ids).map(elementId => {
    const from = source.elements[elementId], to = target.elements[elementId];
    // Existing keyframes keep all unrelated paint, geometry and visibility.
    // Membership/crop metadata travels together to repair partial groups.
    const changes: Partial<SlideElement> = to ? {
      ...copyNestedFields(from, to, fields),
      ...(fields.includes('fillStyle') && from.type === 'shape' ? {fillStyle: from.fillStyle ?? 'solid'} : {}),
      ...(from.objectGroupIds?.length ? {objectGroupIds: [...from.objectGroupIds]} : {}),
      ...(from.type === 'shape' && from.cropGroupId ? {cropGroupId: from.cropGroupId} : {}),
    } : structuredClone(from);
    return {slideId: target.id, elementId, changes};
  });
}

/** Missing objects use a neighbouring keyframe for their object-list identity. */
export function objectListElements(slides: Record<string, Slide>, order: string[], active: string) {
  const index = order.indexOf(active);
  const sources = [active, ...order.slice(0,index).reverse(), ...order.slice(index+1)];
  const elements: Record<string, SlideElement> = {};
  for (const id of sources) for (const el of Object.values(slides[id]?.elements ?? {})) {
    if (!elements[el.id]) elements[el.id] = id === active ? el : {...el, visible: false};
  }
  return elements;
}
