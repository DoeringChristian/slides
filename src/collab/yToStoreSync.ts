import { useEffect } from 'react';
import type { Doc as YDoc } from 'yjs';
import { usePresentationStore } from '../store/presentationStore';
import { yDocToJson } from './ySchema';
import type { Presentation } from '../types/presentation';

// On every Y.Doc update — local or remote — re-derive the full Presentation
// JSON and replace it in the Zustand store. Yjs's `.toJSON()` recursion is
// fast enough for moderate decks; we can move to incremental patches later
// if measurements show it matters.
//
// Order with mutations: an action that goes through Y will do
//   1) yDocAdapter.runInTxn(() => mutate Y types)
//   2) Y fires 'update' synchronously
//   3) this sync re-materialises Presentation and calls setState
//   4) React re-renders
// So the local mutation is reflected in UI in the same microtask, just via a
// slightly longer route than a direct Zustand set().
export function useYToStoreSync(doc: YDoc | null) {
  useEffect(() => {
    if (!doc) return;

    let scheduled = false;
    const apply = () => {
      if (scheduled) return;
      // Coalesce bursts of updates in the same tick into a single setState
      // so React batches the renders.
      scheduled = true;
      queueMicrotask(() => {
        scheduled = false;
        try {
          const presentation = yDocToJson(doc) as Presentation;
          usePresentationStore.setState({ presentation });
        } catch (err) {
          // The doc may not be initialised yet (no ROOT_KEY set). Ignore.
          if ((err as Error)?.message?.includes('presentation map is empty')) return;
          console.error('[yToStoreSync] derive failed:', err);
        }
      });
    };

    // Initial pull — server cold-start usually populates the doc before our
    // first sync, so this catches it.
    apply();
    doc.on('update', apply);

    return () => {
      doc.off('update', apply);
    };
  }, [doc]);
}
