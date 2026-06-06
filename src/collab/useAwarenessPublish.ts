import { useEffect } from 'react';
import type { Awareness } from 'y-protocols/awareness';
import { useEditorStore } from '../store/editorStore';

// Publishes the local user's view + selection state into awareness so peers
// can render "who's on which slide" and "who's selecting what." We use a
// subscriber rather than `useStore + setLocalState` to avoid an extra render
// path; awareness writes are cheap and need to happen at the same instant the
// editor store changes.
export function useAwarenessPublish(awareness: Awareness | null) {
  useEffect(() => {
    if (!awareness) return;
    const push = () => {
      const { activeSlideId, selectedElementIds } = useEditorStore.getState();
      awareness.setLocalStateField('cursor', {
        activeSlideId: activeSlideId || null,
        selectedElementIds: selectedElementIds.slice(),
      });
    };
    push();
    const unsub = useEditorStore.subscribe(push);
    return unsub;
  }, [awareness]);
}
