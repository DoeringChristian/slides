import type * as Y from 'yjs';
import type { Slide, SlideElement } from '../types/presentation';
import { getActiveDoc } from '../collab/yDocAdapter';
import { yDocToJsonSlideOnly, getYRoot } from '../collab/ySchema';
import { beforeLocalMutation } from '../utils/scrubMutation';
import { usePresentationStore } from './presentationStore';

/** Sibling-bearing partials must be assembled AFTER scrub cancellation, not
 * from render props or the asynchronously updated Yjs→Zustand projection. */
export type CurrentChange<T> = Partial<T> | ((current: T) => Partial<T>);

export function readSlideForMutation(slideId: string): Slide | undefined {
  beforeLocalMutation();
  const doc = getActiveDoc();
  return (doc ? yDocToJsonSlideOnly(doc, slideId)
    : usePresentationStore.getState().presentation.slides[slideId]) ?? undefined;
}

export function readElementForMutation(slideId: string, elementId: string): SlideElement | undefined {
  return readSlideForMutation(slideId)?.elements[elementId];
}

export function updateElementFromCurrent<T extends SlideElement>(slideId: string, rendered: T, changes: CurrentChange<T>): void {
  const current = readElementForMutation(slideId, rendered.id);
  // A delayed control callback must not recreate a deleted/retyped element.
  if (!current || current.type !== rendered.type) return;
  usePresentationStore.getState().updateElement(slideId, current.id,
    typeof changes === 'function' ? changes(current as T) : changes);
}

/** Resolve the reset source after cancellation too: selected keyframes may
 * have mirrored the preview, so a render-time neighbour is not authoritative. */
export function readKeyframeForMutation(slideId: string, elementId: string, direction: 'previous' | 'next'): SlideElement | undefined {
  beforeLocalMutation();
  const doc = getActiveDoc();
  const presentation = usePresentationStore.getState().presentation;
  const order = doc ? (getYRoot(doc).get('slideOrder') as Y.Array<string>).toArray() : presentation.slideOrder;
  const index = order.indexOf(slideId);
  if (index < 0) return;
  const step = direction === 'previous' ? -1 : 1;
  for (let i = index + step; i >= 0 && i < order.length; i += step) {
    const slide = doc ? yDocToJsonSlideOnly(doc, order[i]) : presentation.slides[order[i]];
    const element = slide?.elements[elementId];
    if (element?.visible) return element;
  }
}
