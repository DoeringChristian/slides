import type { SlideElement } from '../types/presentation';
import { usePresentationStore } from './presentationStore';
import { readSlideForMutation, readKeyframeForMutation } from './currentMutation';
import { getActiveUndoManager } from '../collab/activeUndo';
import { copyNestedFields, setNestedPartial } from '../utils/editor/propertyFields';
import { transformSelection } from '../utils/editor/selectionProperties';
import type { ResizeUpdate } from '../utils/geometry/resizeGeometry';

export function commitSelectionProperties(slideId: string, ids: string[], make: (elements: SlideElement[]) => ResizeUpdate[]) {
  const slide = readSlideForMutation(slideId);
  if (!slide) return;
  const elements = ids.map(id => slide.elements[id]).filter(Boolean);
  const updates = make(elements);
  if (!updates.length) return;
  const undo = getActiveUndoManager();
  undo?.stopCapturing();
  usePresentationStore.getState().updateElements(slideId, updates);
  undo?.stopCapturing();
}
export function transformSelectedProperties(slideId: string, ids: string[], key: 'x' | 'y' | 'width' | 'height' | 'rotation', value: number) {
  commitSelectionProperties(slideId, ids, elements => transformSelection(elements, key, value));
}
export function setSelectedProperty(slideId: string, ids: string[], path: string, value: unknown, supports: (el: SlideElement) => boolean = () => true) {
  commitSelectionProperties(slideId, ids, elements => elements.filter(supports).map(el => ({ elementId: el.id, changes: setNestedPartial(el, path, value) })));
}
export function resetSelectedProperties(slideId: string, ids: string[], direction: 'previous' | 'next', fields?: string[]) {
  commitSelectionProperties(slideId, ids, elements => elements.flatMap(el => {
    const source = readKeyframeForMutation(slideId, el.id, direction);
    if (!source || source.type !== el.type) return [];
    // Group membership, identity and bindings describe structure, not parameters.
    const structural = new Set(['id', 'type', 'objectGroupIds', 'cropGroupId', 'containerId', 'startBinding', 'endBinding', 'children']);
    const paths = fields ?? [...new Set([...Object.keys(el), ...Object.keys(source)])].filter(key => !structural.has(key));
    return [{ elementId: el.id, changes: copyNestedFields(source, el, paths) }];
  }));
}
