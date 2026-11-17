import { useEffect } from 'react';
import type { AbstractType, Doc as YDoc, YEvent } from 'yjs';
import { usePresentationStore } from '../store/presentationStore';
import { ROOT_KEY, yDocPatchJson, yDocToJson } from './ySchema';
import type { Presentation } from '../types/presentation';
import { getActiveDoc } from './yDocAdapter';

// On every Y.Doc update — local or remote — re-derive the Presentation JSON
// and replace it in the Zustand store, patching only what changed
// (yDocPatchJson): untouched slides, elements and resources keep their
// identity, so memoised views do not redraw and inline media is not copied
// out of the doc again.
//
// Order with mutations: an action that goes through Y will do
//   1) yDocAdapter.runInTxn(() => mutate Y types)
//   2) Y fires its events synchronously
//   3) this sync re-materialises Presentation and calls setState
//   4) React re-renders
// So the local mutation is reflected in UI in the same microtask, just via a
// slightly longer route than a direct Zustand set().
export function useYToStoreSync(doc: YDoc | null) {
  useEffect(() => {
    if (!doc) return;

    let scheduled = false;
    let disposed = false;
    // What this sync last put in the store, and the changes since: patched
    // only while the store still holds exactly that (else rebuilt in full).
    let derived: Presentation | null = null;
    let pending: Array<YEvent<AbstractType<unknown>>> = [];
    const apply = () => {
      if (scheduled) return;
      // Coalesce bursts of updates in the same tick into a single setState
      // so React batches the renders.
      scheduled = true;
      queueMicrotask(() => {
        scheduled = false;
        if (disposed || getActiveDoc() !== doc) return;
        const events = pending; pending = [];
        try {
          const current = usePresentationStore.getState().presentation;
          const presentation = derived && current === derived
            ? yDocPatchJson(doc, derived, events)
            : yDocToJson(doc) as Presentation;
          derived = presentation;
          usePresentationStore.setState({ presentation });
        } catch (err) {
          // The doc may not be initialised yet (no ROOT_KEY set). Ignore.
          if ((err as Error)?.message?.includes('presentation map is empty')) return;
          console.error('[yToStoreSync] derive failed:', err);
        }
      });
    };
    const observe = (events: Array<YEvent<AbstractType<unknown>>>) => { pending.push(...events); apply(); };
    const root = doc.getMap(ROOT_KEY);

    // Initial pull — server cold-start usually populates the doc before our
    // first sync, so this catches it.
    apply();
    root.observeDeep(observe);

    return () => {
      disposed = true;
      root.unobserveDeep(observe);
    };
  }, [doc]);
}
