import { useEditorStore } from '../store/editorStore';

/**
 * Multi-slide editing.
 *
 * When several slides are selected and the user edits an element on the
 * active one, the change should fan out to every other selected slide
 * that contains the same element. The store actions read
 * `mirrorTargets(slideId)` after writing the primary slide and re-invoke
 * themselves on each mirror — keeps the routing centralized so canvas
 * edits, keyboard nudges and property-panel edits all get the same
 * behaviour without per-call-site plumbing.
 *
 * `mirroringInProgress` guards against infinite recursion: the mirrored
 * call goes back through the same action, which calls `mirrorTargets`
 * again — the flag short-circuits it.
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
