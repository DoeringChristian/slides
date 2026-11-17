import * as Y from 'yjs';
import { usePresentationStore } from '../store/presentationStore';
import { getActiveUndoManager } from '../collab/activeUndo';
import { AGENT_ORIGIN, getActiveDoc } from '../collab/yDocAdapter';
import { ROOT_KEY } from '../collab/ySchema';

/**
 * One agent turn = one undo step, apart from the user's own history.
 *
 * The assistant is a collaborator. In a shared document its writes carry
 * AGENT_ORIGIN, which the user's Y.UndoManager does not track: the user's
 * Cmd+Z never reverts the assistant's work, and what the user does while a
 * turn runs stays in the user's own history. Each turn gets its own manager
 * tracking that origin with an unlimited capture window, so the turn is
 * exactly one step — "Undo turn" reverts it, even after the user has edited
 * on since (Yjs undo is selective, as for any peer).
 *
 * Without a shared document (JSON / zundo) there is one history: it is
 * paused for the turn and the pre-turn state pushed as a single past state,
 * so local edits made during a turn land in the same step.
 */

/** A finished turn's undo step, offered as "Undo turn". */
export interface TurnUndo {
  canUndo: () => boolean;
  undo: () => void;
}

let previousTurn: Y.UndoManager | null = null;

export function beginTurnHistory(): () => TurnUndo | null {
  const doc = getActiveDoc();
  // Only the newest turn is offered for undo; release the one before.
  previousTurn?.destroy(); previousTurn = null;
  if (doc) {
    const turn = new Y.UndoManager(doc.getMap(ROOT_KEY), { trackedOrigins: new Set([AGENT_ORIGIN]), captureTimeout: Infinity });
    return () => {
      // Later turns are their own: stop tracking.
      turn.trackedOrigins.delete(AGENT_ORIGIN);
      if (!turn.undoStack.length) { turn.destroy(); return null; }
      previousTurn = turn;
      let undone = false;
      return {
        canUndo: () => !undone && getActiveDoc() === doc,
        undo: () => { if (undone || getActiveDoc() !== doc) return; undone = true; turn.undo(); turn.destroy(); },
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
