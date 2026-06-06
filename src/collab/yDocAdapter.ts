import type { Doc as YDoc } from 'yjs';

// Tiny module-level singleton tracking the currently-connected collab Y.Doc.
// Mutating actions in presentationStore consult getActiveDoc() to decide
// whether to route mutations through Y (collab mode) or directly into Zustand
// (local / filesystem mode).
//
// Origin: every local mutation is tagged with LOCAL_ORIGIN so phase 9's
// Y.UndoManager can scope undo to local edits only. yToStoreSync also uses
// it to distinguish local-echo from remote updates if it ever needs to.

export const LOCAL_ORIGIN = Symbol('local-edit');

let activeDoc: YDoc | null = null;

export function setActiveDoc(doc: YDoc | null) {
  activeDoc = doc;
}

export function getActiveDoc(): YDoc | null {
  return activeDoc;
}

/**
 * Wrap a function in a Y transaction with our local origin tag. Caller must
 * have already verified `getActiveDoc()` is non-null.
 */
export function runInTxn(fn: () => void) {
  if (!activeDoc) {
    throw new Error('runInTxn called with no active Y.Doc');
  }
  activeDoc.transact(fn, LOCAL_ORIGIN);
}
