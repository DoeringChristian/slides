import { useEditorStore } from '../store/editorStore';
import { usePresentationStore } from '../store/presentationStore';

/**
 * Auto-draw mode.
 *
 * When the user has auto-draw on, every element-level mutation duplicates
 * the current slide first and applies the change to the duplicate, so each
 * change becomes its own keyframe in the animation timeline. The user
 * basically "records" their edits as a sequence of slides.
 *
 * Call `beforeMutation(slideId)` at the top of any element-level store
 * action; the return value is the slide id the action should actually
 * write to. A short debounce groups bursts of micro-edits (typing into a
 * number input, dragging a slider) into ONE new slide instead of one per
 * keystroke — otherwise auto-draw would spam the timeline.
 *
 * Module-level state on purpose: the debounce window and re-entry guard
 * are global, not per-store-instance. There is only ever one active
 * presentation in this app's lifetime.
 */

const DEBOUNCE_MS = 600;

let lastAutoDrawTime = 0;
let autoDrawInProgress = false;

export function beforeMutation(slideId: string): string {
  const editor = useEditorStore.getState();
  if (!editor.autoDrawMode) return slideId;
  // Re-entry: duplicateSlide itself fires no element mutations through
  // this helper, but be defensive in case something downstream does.
  if (autoDrawInProgress) return slideId;
  // Only redirect edits to the slide the user is currently looking at.
  // Programmatic edits to other slides (sync propagation, multi-slide
  // updates) shouldn't spawn keyframes.
  if (slideId !== editor.activeSlideId) return slideId;

  const now = Date.now();
  // If we duplicated just now, the active slide is already the freshly
  // spawned keyframe — keep editing the same one rather than chaining
  // a new slide per keystroke.
  if (now - lastAutoDrawTime < DEBOUNCE_MS) {
    lastAutoDrawTime = now;
    return slideId;
  }

  autoDrawInProgress = true;
  try {
    const newSlideId = usePresentationStore.getState().duplicateSlide(slideId);
    if (!newSlideId) return slideId;
    editor.setActiveSlide(newSlideId);
    lastAutoDrawTime = now;
    return newSlideId;
  } finally {
    autoDrawInProgress = false;
  }
}
