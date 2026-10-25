import { useSyncExternalStore } from 'react';
import * as Y from 'yjs';
import { ROOT_KEY } from './ySchema';
import { beforeLocalMutation, inForeignTransaction, isOwnedScrubMutation } from '../utils/scrubMutation';
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
  beforeLocalMutation();
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

const documentGuards = new WeakMap<Y.Doc, () => void>();

/** Track local edits under the presentation root and guard transaction entry. */
export function createUndoManagerFor(doc: Y.Doc): Y.UndoManager {
  // Replacing a manager must not stack wrappers on the same document.
  documentGuards.get(doc)?.();
  const root = doc.getMap(ROOT_KEY);
  // Y.UndoManager accepts an array of scope items so it tracks everything
  // under the presentation map. The captureTimeout coalesces bursts of typing
  // into a single undo step.
  const mgr = new Y.UndoManager(root, {
    trackedOrigins: new Set([LOCAL_ORIGIN]),
    captureTimeout: 500,
  });
  const transact = doc.transact;
  // beforeTransaction is too late: Yjs has already installed its transaction,
  // so a rollback there would join the unrelated write. Guard the public
  // instance entry instead; never patch the prototype or Yjs internals.
  const guardedTransact = function <T>(this: Y.Doc, fn: (transaction: Y.Transaction) => T, origin?: unknown): T {
    if (origin === LOCAL_ORIGIN) beforeLocalMutation();
    const run = () => (transact as typeof guardedTransact).call(this, fn, origin) as T;
    // Also reject store actions nested inside a remote callback before their
    // action-entry guard can attempt rollback into that foreign transaction.
    return origin === LOCAL_ORIGIN || isOwnedScrubMutation() ? run() : inForeignTransaction(run);
  };
  doc.transact = guardedTransact;
  const undo = mgr.undo, redo = mgr.redo, destroy = mgr.destroy;
  mgr.undo = function () { beforeLocalMutation(); return undo.call(this); };
  mgr.redo = function () { beforeLocalMutation(); return redo.call(this); };
  const cleanup = () => {
    if (documentGuards.get(doc) !== cleanup) return;
    beforeLocalMutation();
    if (doc.transact === guardedTransact) doc.transact = transact;
    if (documentGuards.get(doc) === cleanup) documentGuards.delete(doc);
  };
  documentGuards.set(doc, cleanup);
  mgr.destroy = function () { cleanup(); doc.off('destroy', cleanup); destroy.call(this); };
  doc.on('destroy', cleanup);
  return mgr;
}

/** The session explicitly owns its writes; unrelated local actions cancel it
 * before entering the shared capture window. Keep one local scrub together
 * across pointer pauses, without changing the
 * normal typing capture window outside the gesture. Cancellation undoes the
 * captured gesture (reviving the original Y items, so earlier undo still works)
 * and discards only that gesture's redo item. Remote origins remain excluded. */
export function beginScrubCapture(mgr: Y.UndoManager | null): (cancelled: boolean) => void {
  if (!mgr) return () => {};
  const timeout = mgr.captureTimeout;
  let captured: Y.UndoManager['undoStack'][number] | undefined;
  const capture = ({ stackItem }: { stackItem: Y.UndoManager['undoStack'][number] }) => {
    if (isOwnedScrubMutation()) captured = stackItem;
  };
  mgr.on('stack-item-added', capture);
  mgr.stopCapturing();
  mgr.captureTimeout = Infinity;
  let finished = false;
  return (cancelled) => {
    if (finished) return;
    finished = true;
    mgr.off('stack-item-added', capture);
    mgr.captureTimeout = timeout;
    mgr.stopCapturing();
    if (cancelled && captured) {
      // Never assume the shared newest item is ours. Local-action/transact
      // guards make this invariant true; reject a bypass instead of undoing
      // someone else's history entry.
      if (mgr.undoStack.at(-1) !== captured) throw new Error('Scrub undo ownership lost');
      if (mgr.undo()) mgr.clear(false, true);
    }
    mgr.stopCapturing();
  };
}
