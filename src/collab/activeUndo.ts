import { useSyncExternalStore } from 'react';
import * as Y from 'yjs';
import { ROOT_KEY } from './ySchema';
import { LOCAL_ORIGIN } from './yDocAdapter';

// Singleton Y.UndoManager attached to the active collab doc. Scoped to
// LOCAL_ORIGIN so undo only reverts our own edits — remote peers' changes
// stay untouched (the agreed-on collab undo semantics).
//
// Lifetime: App.tsx creates one when collab.doc lands and destroys it on
// doc change. Reading via useActiveUndo() lets `useHistory` decide whether
// to route Cmd+Z to Y or to zundo's temporal middleware.

let activeUndoManager: Y.UndoManager | null = null;
const listeners = new Set<() => void>();

function notify() {
  listeners.forEach((cb) => cb());
}

export function setActiveUndoManager(mgr: Y.UndoManager | null) {
  if (activeUndoManager === mgr) return;
  // Destroy the old one before swapping so its event listeners and tracking
  // state are released; the doc itself stays alive (it's owned upstream).
  if (activeUndoManager) {
    try { activeUndoManager.destroy(); } catch { /* ignore */ }
  }
  activeUndoManager = mgr;
  notify();
}

export function getActiveUndoManager(): Y.UndoManager | null {
  return activeUndoManager;
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function getSnapshot() {
  return activeUndoManager;
}

/** React-safe view of the singleton. */
export function useActiveUndo(): Y.UndoManager | null {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/** Build a UndoManager that tracks every nested Y type under the presentation
 *  root map, scoped to our local origin. Called once per Y.Doc that becomes
 *  active. */
export function createUndoManagerFor(doc: Y.Doc): Y.UndoManager {
  const root = doc.getMap(ROOT_KEY);
  // Y.UndoManager accepts an array of scope items so it tracks everything
  // under the presentation map. The captureTimeout coalesces bursts of typing
  // into a single undo step.
  return new Y.UndoManager(root, {
    trackedOrigins: new Set([LOCAL_ORIGIN]),
    captureTimeout: 500,
  });
}
