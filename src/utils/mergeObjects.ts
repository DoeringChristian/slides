/**
 * WS-3 Phase 3 — object merge.
 *
 * Merging object SOURCE into TARGET re-identifies every keyframe of the
 * source element under the target's id, so slides act as keyframes of ONE
 * object and playback morphs between what used to be two different objects.
 *
 * Conflict policy (user decision): TARGET WINS — on slides where both objects
 * are visible, the target is kept and the source is dropped (reported).
 * A visible source replaces a hidden target; hidden/hidden keeps the target.
 *
 * These helpers are pure slide-map rewrites; the object registry
 * (`presentation.objects`) is owned by the caller (the store action drops the
 * source's entry — the target keeps its id, name and ObjectMeta.type).
 */
import type {
  ConnectorBinding,
  ShapeElement,
  Slide,
  SlideElement,
  TextElement,
} from '../types/presentation';

export interface MergeObjectsResult {
  slides: Record<string, Slide>;
  /** Slide ids where both objects existed and the source element was dropped
   *  (target-wins conflict resolution), in iteration order. */
  droppedOnSlides: string[];
}

/** Iteration order for the slide passes: prefer the caller's slideOrder (so
 *  both store paths report `droppedOnSlides` identically), fall back to the
 *  record's key order. Slides missing from the record are skipped. */
function slideIds(slides: Record<string, Slide>, slideOrder?: readonly string[]): string[] {
  const ids = slideOrder ? slideOrder.filter((id) => slides[id]) : Object.keys(slides);
  return ids;
}

/** True when the merge is well-formed: distinct ids, the source element
 *  occurs on at least one slide, and neither id names a group element
 *  anywhere (GroupElement is vestigial — no interpolation support). */
export function canMergeObjects(
  slides: Record<string, Slide>,
  targetId: string,
  sourceId: string,
): boolean {
  if (targetId === sourceId) return false;
  let sourceExists = false;
  for (const slide of Object.values(slides)) {
    const src = slide.elements[sourceId];
    const tgt = slide.elements[targetId];
    if (src?.type === 'group' || tgt?.type === 'group') return false;
    if (src) sourceExists = true;
  }
  return sourceExists;
}

/** Hidden keyframes carry animation geometry but are not visible conflicts.
 * A visible counterpart wins; otherwise the existing target wins. */
export function mergeKeyframeDecision(source: SlideElement, target?: SlideElement): 'source' | 'target' | 'conflict' {
  if (!target || (source.visible !== false && target.visible === false)) return 'source';
  return source.visible !== false && target.visible !== false ? 'conflict' : 'target';
}

/** Visible conflicts only: the target wins and the user is notified. */
export function mergeObjectConflictSlideIds(
  slides: Record<string, Slide>,
  targetId: string,
  sourceId: string,
  slideOrder?: readonly string[],
): string[] {
  return slideIds(slides, slideOrder).filter(
    (sid) => !!slides[sid].elements[sourceId]
      && mergeKeyframeDecision(slides[sid].elements[sourceId], slides[sid].elements[targetId]) === 'conflict',
  );
}

/** Remap one element's references from `sourceId` to `targetId`: connector
 *  bindings (`startBinding`/`endBinding.elementId`) and bound-text container
 *  refs (`containerId`). Returns the element unchanged (same reference) when
 *  nothing points at the source. */
function remapElementRefs(el: SlideElement, targetId: string, sourceId: string): SlideElement {
  if (el.type === 'shape') {
    const shape = el as ShapeElement;
    let changed = false;
    let startBinding = shape.startBinding;
    let endBinding = shape.endBinding;
    if (startBinding && startBinding.elementId === sourceId) {
      startBinding = { ...startBinding, elementId: targetId } as ConnectorBinding;
      changed = true;
    }
    if (endBinding && endBinding.elementId === sourceId) {
      endBinding = { ...endBinding, elementId: targetId } as ConnectorBinding;
      changed = true;
    }
    return changed ? ({ ...shape, startBinding, endBinding } as SlideElement) : el;
  }
  if (el.type === 'text' && (el as TextElement).containerId === sourceId) {
    return { ...(el as TextElement), containerId: targetId } as SlideElement;
  }
  return el;
}

/**
 * Merge object `sourceId` into `targetId` across a slide map.
 *
 * Per slide containing the source element:
 *  - target also present → the source element (and its elementOrder entry)
 *    is DELETED (target wins; the slide id is recorded), or
 *  - target absent → the source element is moved under the target id with
 *    the embedded `id` rewritten and its elementOrder entry replaced in
 *    place (z-position preserved).
 *
 * Then a deck-wide remap pass repoints every `ConnectorBinding.elementId`
 * and every bound-text `containerId` that referenced the source at the
 * target — including on conflict slides, so labels/connectors formerly
 * attached to the dropped source follow the surviving target.
 *
 * Guards (any failing → no-op, same `slides` reference back, no drops):
 * source ≠ target, source exists somewhere, neither id is a group element.
 * The object registry is NOT touched — the caller drops `objects[sourceId]`.
 */
export function mergeObjectInSlides(
  slides: Record<string, Slide>,
  targetId: string,
  sourceId: string,
  slideOrder?: readonly string[],
): MergeObjectsResult {
  if (!canMergeObjects(slides, targetId, sourceId)) {
    return { slides, droppedOnSlides: [] };
  }

  const droppedOnSlides: string[] = [];
  const merged: Record<string, Slide> = { ...slides };

  // Pass 1 — move or drop the source element per slide.
  for (const sid of slideIds(slides, slideOrder)) {
    const slide = merged[sid];
    const src = slide.elements[sourceId];
    if (!src) continue;
    const { [sourceId]: _removed, ...remainingElements } = slide.elements;
    const decision = mergeKeyframeDecision(src, slide.elements[targetId]);
    // A losing container's separate label must not cover the winning label.
    // Preserve that hidden keyframe/identity for history and other slides.
    const winnerId = decision === 'source' ? sourceId : targetId;
    const loserId = decision === 'source' ? targetId : sourceId;
    const winnerHasLabel = Object.values(slide.elements).some(el => el.type === 'text' && el.containerId === winnerId);
    if (winnerHasLabel && slide.elements[loserId]) {
      for (const [id, el] of Object.entries(remainingElements)) {
        if (el.type === 'text' && el.containerId === loserId) {
          const { containerId: _displacedContainer, ...detached } = el;
          remainingElements[id] = { ...detached, visible: false };
        }
      }
    }
    if (decision !== 'source') {
      if (decision === 'conflict') droppedOnSlides.push(sid);
      merged[sid] = {
        ...slide,
        elements: remainingElements,
        elementOrder: slide.elementOrder.filter((id) => id !== sourceId),
      };
    } else {
      // Move: re-identify the source keyframe under the target id, keeping
      // its z-position (elementOrder entry replaced in place).
      merged[sid] = {
        ...slide,
        elements: {
          ...remainingElements,
          [targetId]: { ...src, id: targetId } as SlideElement,
        },
        elementOrder: slide.elementOrder.filter(id => id !== targetId).map((id) => (id === sourceId ? targetId : id)),
      };
    }
  }

  // Pass 2 — deck-wide reference remap (bindings + bound-text containers).
  for (const sid of slideIds(merged, slideOrder)) {
    const slide = merged[sid];
    let elements: Record<string, SlideElement> | null = null;
    for (const [elId, el] of Object.entries(slide.elements)) {
      const remapped = remapElementRefs(el, targetId, sourceId);
      if (remapped === el) continue;
      if (!elements) elements = { ...slide.elements };
      elements[elId] = remapped;
    }
    if (elements) merged[sid] = { ...slide, elements };
  }

  return { slides: merged, droppedOnSlides };
}
