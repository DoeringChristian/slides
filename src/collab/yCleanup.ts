import * as Y from 'yjs';
import { getYElement, getYRoot, getYSlide } from './ySchema';

export function objectVisibleAnywhereInY(doc: Y.Doc, elementId: string): boolean {
  const order = (getYRoot(doc).get('slideOrder') as Y.Array<string>).toArray();
  return order.some((slideId) => getYElement(doc, slideId, elementId)?.get('visible') === true);
}

/** Presence, NOT visibility: Y twin of objectExistsAnywhere — true when any
 *  slide's elements map contains the id, even if hidden everywhere. */
export function objectExistsAnywhereInY(doc: Y.Doc, objectId: string): boolean {
  const order = (getYRoot(doc).get('slideOrder') as Y.Array<string>).toArray();
  return order.some((slideId) => getYElement(doc, slideId, objectId) !== undefined);
}

export function resourceReferencedInY(doc: Y.Doc, resourceId: string): boolean {
  const order = (getYRoot(doc).get('slideOrder') as Y.Array<string>).toArray();
  for (const slideId of order) {
    const slide = getYSlide(doc, slideId);
    const elements = slide?.get('elements') as Y.Map<Y.Map<unknown>> | undefined;
    if (!elements) continue;
    for (const el of elements.values()) {
      if (el.get('type') === 'image' && el.get('resourceId') === resourceId) return true;
    }
  }
  return false;
}

/**
 * Remove an object's element from all Y slides and drop its image resource when
 * no remaining slide references it. The object registry itself is owned by callers.
 */
export function purgeObjectInY(doc: Y.Doc, objectId: string) {
  const root = getYRoot(doc);
  const order = (root.get('slideOrder') as Y.Array<string>).toArray();
  let resourceIdToCheck: string | null = null;

  for (const sid of order) {
    const slide = getYSlide(doc, sid);
    const elements = slide?.get('elements') as Y.Map<Y.Map<unknown>> | undefined;
    const el = elements?.get(objectId);
    if (!el) continue;

    if (el.get('type') === 'image') {
      const rid = el.get('resourceId');
      if (typeof rid === 'string') resourceIdToCheck = rid;
    }

    elements!.delete(objectId);
    const elementOrder = slide?.get('elementOrder') as Y.Array<string> | undefined;
    if (elementOrder) {
      const idx = elementOrder.toArray().indexOf(objectId);
      if (idx !== -1) elementOrder.delete(idx, 1);
    }
  }

  if (resourceIdToCheck && !resourceReferencedInY(doc, resourceIdToCheck)) {
    (root.get('resources') as Y.Map<unknown> | undefined)?.delete(resourceIdToCheck);
  }
}
