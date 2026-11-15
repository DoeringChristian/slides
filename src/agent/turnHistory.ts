import * as Y from 'yjs';
import { usePresentationStore } from '../store/presentationStore';
import { getActiveUndoManager } from '../collab/activeUndo';

/**
 * One agent turn = one undo step.
 *
 * A turn makes many store writes; Cmd+Z must revert the turn, not its last
 * write. Both history paths are bracketed:
 *
 * - JSON (zundo): history is paused for the turn, and on finish the pre-turn
 *   state is pushed as a single past state.
 * - Yjs (Y.UndoManager): every stack item added during the turn is merged
 *   into the first, with the same `mergeDeleteSets` Yjs uses for its own
 *   capture window. Store actions that call `stopCapturing()` would otherwise
 *   split the turn.
 *
 * Local edits the user makes while a turn runs land in the same step. Remote
 * peers' edits never do: the manager tracks the local origin only.
 */

/** A finished turn's undo step, offered as "Undo turn" while it is still the
 *  newest step in history. */
export interface TurnUndo {
  canUndo: () => boolean;
  undo: () => void;
}

export function beginTurnHistory(): () => TurnUndo | null {
  const undo = getActiveUndoManager();
  if (undo) {
    undo.stopCapturing();
    const start = undo.undoStack.length;
    return () => {
      undo.stopCapturing();
      const stack = undo.undoStack;
      // Nothing written, or the user undid past the turn's start.
      if (stack.length <= start) return null;
      const items = stack.slice(start);
      const first = items[0];
      if (items.length > 1) {
        first.insertions = Y.mergeDeleteSets(items.map(item => item.insertions));
        first.deletions = Y.mergeDeleteSets(items.map(item => item.deletions));
        for (const item of items.slice(1)) {
          for (const [key, value] of item.meta) if (!first.meta.has(key)) first.meta.set(key, value);
        }
        stack.splice(start + 1);
      }
      return {
        canUndo: () => getActiveUndoManager() === undo && undo.undoStack.at(-1) === first,
        undo: () => { undo.undo(); },
      };
    };
  }

  const temporal = usePresentationStore.temporal;
  const before = usePresentationStore.getState();
  const wasTracking = temporal.getState().isTracking;
  temporal.getState().pause();
  return () => {
    if (wasTracking) temporal.getState().resume();
    const after = usePresentationStore.getState().presentation;
    if (after === before.presentation || !wasTracking) return null;
    const { pastStates } = temporal.getState();
    const nextPast = [...pastStates, before].slice(-50);
    temporal.setState({ pastStates: nextPast, futureStates: [] });
    return {
      canUndo: () => getActiveUndoManager() === null
        && usePresentationStore.getState().presentation === after
        && temporal.getState().pastStates.at(-1) === before,
      undo: () => temporal.getState().undo(),
    };
  };
}
