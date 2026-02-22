import { usePresentationStore } from '../store/presentationStore';

export function useHistory() {
  const temporal = (usePresentationStore as any).temporal;

  const undo = () => temporal?.getState()?.undo();
  const redo = () => temporal?.getState()?.redo();
  const canUndo = () => (temporal?.getState()?.pastStates?.length ?? 0) > 0;
  const canRedo = () => (temporal?.getState()?.futureStates?.length ?? 0) > 0;

  return { undo, redo, canUndo, canRedo };
}
