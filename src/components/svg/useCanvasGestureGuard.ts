import { useCallback, useEffect, useRef } from 'react';
import { useEditorStore } from '../../store/editorStore';
import { usePresentationStore } from '../../store/presentationStore';
import { getActiveDoc, subscribeActiveDocChange } from '../../collab/yDocAdapter';
import { yDocToJsonSlideOnly } from '../../collab/ySchema';
import type { SlideElement } from '../../types/presentation';

/** Pure authoritative read: unlike mutation helpers this never cancels a scrub
 * or writes. The Yjs mirror may still be a frame behind the document. */
export function readGestureSlide() {
  const id = useEditorStore.getState().activeSlideId;
  const doc = getActiveDoc();
  return doc ? yDocToJsonSlideOnly(doc, id) ?? undefined : usePresentationStore.getState().presentation.slides[id];
}

/** Synchronous invalidation also catches away-and-back switches with identical
 * keyframe IDs. Keep these baselines separate from display-only geometry. */
export function useCanvasGestureGuard() {
  const cleanup = useRef<(() => void) | null>(null);
  const finish = useCallback(() => { cleanup.current?.(); cleanup.current = null; }, []);
  useEffect(() => finish, [finish]);
  const start = useCallback((cancel: () => void, rendered?: SlideElement[]) => {
    finish();
    const editor = useEditorStore.getState();
    const slide = readGestureSlide();
    if (!slide || rendered?.some(el => {
      const plain = { ...el } as SlideElement & { _labelMask?: unknown };
      delete plain._labelMask;
      return JSON.stringify(slide.elements[el.id]) !== JSON.stringify(plain);
    })) return false;
    const doc = getActiveDoc();
    const signature = JSON.stringify(slide);
    const selection = JSON.stringify(editor.selectedElementIds);
    const check = () => {
      const now = useEditorStore.getState();
      if (now.activeSlideId !== editor.activeSlideId || JSON.stringify(now.selectedElementIds) !== selection ||
          now.tool !== editor.tool || getActiveDoc() !== doc || JSON.stringify(readGestureSlide()) !== signature) {
        finish(); cancel();
      }
    };
    const offDoc = subscribeActiveDocChange(check);
    const offEditor = useEditorStore.subscribe(check);
    const offPresentation = usePresentationStore.subscribe(check);
    doc?.on('afterTransaction', check);
    cleanup.current = () => { offDoc(); offEditor(); offPresentation(); doc?.off('afterTransaction', check); };
    return true;
  }, [finish]);
  return { start, finish };
}
