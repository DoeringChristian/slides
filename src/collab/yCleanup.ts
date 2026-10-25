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

/** Y twin of the cleanup module's bound-text collector: text elements bound
 *  to `containerId` anywhere in the doc, collected per-slide in elementOrder
 *  order (deterministic, matches the JSON path). */
export function collectBoundTextIdsInY(doc: Y.Doc, containerId: string): string[] {
  const order = (getYRoot(doc).get('slideOrder') as Y.Array<string>).toArray();
  const out: string[] = [];
  const seen = new Set<string>();
  for (const slideId of order) {
    const slide = getYSlide(doc, slideId);
    const elements = slide?.get('elements') as Y.Map<Y.Map<unknown>> | undefined;
    const elementOrder = slide?.get('elementOrder') as Y.Array<string> | undefined;
    if (!elements || !elementOrder) continue;
    for (const elId of elementOrder.toArray()) {
      const el = elements.get(elId);
      if (!el || el.get('type') !== 'text' || seen.has(elId)) continue;
      if (el.get('containerId') === containerId) {
        seen.add(elId);
        out.push(elId);
      }
    }
  }
  return out;
}

function removeElementFromYSlides(doc: Y.Doc, elementId: string): string | null {
  const order = (getYRoot(doc).get('slideOrder') as Y.Array<string>).toArray();
  let resourceIdToCheck: string | null = null;
  for (const sid of order) {
    const slide = getYSlide(doc, sid);
    const elements = slide?.get('elements') as Y.Map<Y.Map<unknown>> | undefined;
    const el = elements?.get(elementId);
    if (!el) continue;

    if (el.get('type') === 'image') {
      const rid = el.get('resourceId');
      if (typeof rid === 'string') resourceIdToCheck = rid;
    }

    elements!.delete(elementId);
    // Keep reference repair in the caller's deletion transaction; do not
    // resolve bindings again or change the surviving connector geometry.
    for (const remaining of elements!.values()) {
      if (remaining.get('type') === 'shape') {
        for (const key of ['startBinding', 'endBinding']) {
          const binding = remaining.get(key) as Y.Map<unknown> | null | undefined;
          if (binding?.get('elementId') === elementId) remaining.set(key, null);
        }
      } else if (remaining.get('type') === 'group') {
        const children = remaining.get('childIds') as Y.Array<string>;
        for (let i = children.length - 1; i >= 0; i--) {
          if (children.get(i) === elementId) children.delete(i, 1);
        }
      }
    }
    const elementOrder = slide?.get('elementOrder') as Y.Array<string> | undefined;
    if (elementOrder) {
      const idx = elementOrder.toArray().indexOf(elementId);
      if (idx !== -1) elementOrder.delete(idx, 1);
    }
  }
  return resourceIdToCheck;
}

/**
 * Remove an object's element from all Y slides and drop its image resource when
 * no remaining slide references it. Cascades to bound-text labels (text
 * elements whose `containerId` is the purged object) and returns their ids so
 * callers can drop the matching object-registry entries — mirror of
 * `purgeObjectFromSlides` in utils/presentationCleanup.ts.
 */
export function purgeObjectInY(doc: Y.Doc, objectId: string): { purgedBoundTextIds: string[] } {
  const root = getYRoot(doc);

  const resourceIdToCheck = removeElementFromYSlides(doc, objectId);

  const purgedBoundTextIds = collectBoundTextIdsInY(doc, objectId);
  for (const labelId of purgedBoundTextIds) {
    removeElementFromYSlides(doc, labelId);
  }

  if (resourceIdToCheck && !resourceReferencedInY(doc, resourceIdToCheck)) {
    (root.get('resources') as Y.Map<unknown> | undefined)?.delete(resourceIdToCheck);
  }
  return { purgedBoundTextIds };
}
