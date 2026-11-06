import { useEditorStore } from '../../store/editorStore';

/**
 * Multi-slide editing.
 *
 * When several slides are selected and the user edits an element on the
 * active one, the change should fan out to every other selected slide
 * that contains the same element. updateElement/updateElements replay the
 * operation with mirrorOperation against each destination's own geometry,
 * then commit all slides atomically. Never copy active-slide geometry or
 * unrelated snapshot fields as a substitute for replaying an operation.
 * Canvas edits, keyboard nudges and property panels share this routing.
 *
 * Lifecycle and layer actions still re-invoke themselves on each mirror;
 * `mirroringInProgress` prevents recursive fan-out for those actions.
 */

let mirroringInProgress = false;

export function mirrorTargets(slideId: string): string[] {
  if (mirroringInProgress) return [];
  const editor = useEditorStore.getState();
  const selected = editor.selectedSlideIds;
  // Only mirror when the active slide is one of the selected slides.
  // When auto-draw spawns a fresh keyframe (active no longer in
  // selectedSlideIds), the multi-select is dormant and we let edits stay
  // on the new keyframe instead of polluting the originals.
  if (selected.length <= 1) return [];
  if (slideId !== editor.activeSlideId) return [];
  if (!selected.includes(slideId)) return [];
  return selected.filter((id) => id !== slideId);
}

export function withMirroring<T>(fn: () => T): T {
  const prev = mirroringInProgress;
  mirroringInProgress = true;
  try {
    return fn();
  } finally {
    mirroringInProgress = prev;
  }
}
