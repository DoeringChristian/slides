import { usePresentationStore } from '../store/presentationStore';
import { useActiveUndo } from '../collab/activeUndo';

// Undo/redo. In collab (server) mode, routes through the active Y.UndoManager
// so each user undoes only their own edits. In local/filesystem modes, falls
// back to the zundo temporal middleware on presentationStore (existing
// behavior).
export function useHistory() {
  const undoMgr = useActiveUndo();
  const temporal = (usePresentationStore as { temporal?: { getState(): { undo(): void; redo(): void; pastStates: unknown[]; futureStates: unknown[] } } }).temporal;

  if (undoMgr) {
    return {
      undo: () => undoMgr.undo(),
      redo: () => undoMgr.redo(),
      canUndo: () => undoMgr.undoStack.length > 0,
      canRedo: () => undoMgr.redoStack.length > 0,
    };
  }

  return {
    undo: () => temporal?.getState()?.undo(),
    redo: () => temporal?.getState()?.redo(),
    canUndo: () => (temporal?.getState()?.pastStates?.length ?? 0) > 0,
    canRedo: () => (temporal?.getState()?.futureStates?.length ?? 0) > 0,
  };
}
