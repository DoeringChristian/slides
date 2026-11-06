import type { SlideElement } from '../types/presentation';
import type { CurrentChange } from './currentMutation';
import { readSlideForMutation } from './currentMutation';
import { usePresentationStore } from './presentationStore';
import { getActiveUndoManager } from '../collab/activeUndo';
import { isOwnedScrubMutation, ownScrubMutation } from '../utils/editor/scrubMutation';
import { copyNestedFields } from '../utils/editor/propertyFields';
import { selectionResizeBounds, resizeSelection, rotateSelection } from '../utils/geometry/resizeGeometry';

const restores = new WeakSet<object>();
export function selectionProxy(elements: SlideElement[]): SlideElement {
  return { ...elements[0], ...selectionResizeBounds(elements), rotation: elements[0].rotation };
}
export function batchPropertyEditor(slideId: string, ids: string[], geometry: boolean, supports: (el: SlideElement) => boolean) {
  let baseline: SlideElement[] | null = null;
  const read = () => {
    const slide = readSlideForMutation(slideId);
    return ids.map(id => slide?.elements[id]).filter((el): el is SlideElement => !!el && supports(el));
  };
  const edit = (changes: CurrentChange<SlideElement>) => {
    const current = read();
    if (restores.has(changes)) baseline = null;
    const elements = geometry && isOwnedScrubMutation() && baseline ? baseline : current;
    if (!elements.length) return;
    let updates;
    if (geometry && !restores.has(changes)) {
      const proxy = selectionProxy(elements);
      const partial = typeof changes === 'function' ? changes(proxy) : changes;
      if ('rotation' in partial) updates = rotateSelection(elements, { x: proxy.x + proxy.width / 2, y: proxy.y + proxy.height / 2 }, (partial.rotation ?? proxy.rotation) - proxy.rotation);
      else if ('width' in partial || 'height' in partial) updates = resizeSelection(elements, proxy, { ...proxy, ...partial });
      else updates = elements.map(el => ({ elementId: el.id, changes: {
        ...('x' in partial ? { x: el.x + partial.x! - proxy.x } : {}),
        ...('y' in partial ? { y: el.y + partial.y! - proxy.y } : {}),
      } }));
    } else updates = elements.map(el => ({ elementId: el.id, changes: typeof changes === 'function' ? changes(el) : changes }));
    const undo = getActiveUndoManager(), discrete = !isOwnedScrubMutation();
    if (discrete) undo?.stopCapturing();
    usePresentationStore.getState().updateElements(slideId, updates);
    if (discrete) undo?.stopCapturing();
  };
  return Object.assign(edit, { commit: edit, snapshot: (fields: string[]): CurrentChange<SlideElement> => {
    const source = new Map(ownScrubMutation(read).map(el => [el.id, structuredClone(el)]));
    if (geometry) baseline = [...source.values()];
    const paths = geometry ? ['x','y','width','height','rotation','points','tangents','style','startBinding','endBinding'] : fields;
    const restore = (current: SlideElement) => source.has(current.id) ? copyNestedFields(source.get(current.id)!, current, paths) : {};
    restores.add(restore);
    return restore;
  } });
}
