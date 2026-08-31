import { useEffect } from 'react';
import { getJoinedProject } from '../store/joinedStore';
import { useVaultStore } from '../store/vaultStore';
import { useIdentity } from './useIdentity';
import { useCollabConnection, type CollabConnection } from '../collab/useCollabConnection';
import { useYToStoreSync } from '../collab/yToStoreSync';
import { useAwarenessPublish } from '../collab/useAwarenessPublish';
import { setActiveAwareness } from '../collab/activeAwareness';
import { setActiveDoc } from '../collab/yDocAdapter';
import { createUndoManagerFor, setActiveUndoManager } from '../collab/activeUndo';

interface UseProjectCollabOptions {
  disabled?: boolean;
}

/**
 * Owns the app-level collaboration lifecycle: connect to the active server
 * project, expose the active Y.Doc to store mutations, mirror Y updates back
 * into Zustand, publish awareness, and install collaborative undo.
 */
export function useProjectCollab(options: UseProjectCollabOptions = {}): CollabConnection {
  const identity = useIdentity();
  const activeProjectId = useVaultStore((s) => s.activeProjectId);
  const storageMode = useVaultStore((s) => s.storageMode);
  const serverUrl = useVaultStore((s) => s.serverUrl);

  const activeJoined = activeProjectId ? getJoinedProject(activeProjectId) : undefined;
  const projectId = !options.disabled && storageMode === 'server' ? activeProjectId : null;

  const collab = useCollabConnection({
    projectId,
    serverUrl: storageMode === 'server' ? serverUrl : null,
    identity,
    shareToken: activeJoined?.token,
  });

  useEffect(() => {
    if (collab.error) console.error(`[collab] ${collab.error}`);
  }, [collab.error]);

  useEffect(() => {
    setActiveDoc(collab.doc);
    setActiveUndoManager(collab.doc ? createUndoManagerFor(collab.doc) : null);
    return () => {
      setActiveDoc(null);
      setActiveUndoManager(null);
    };
  }, [collab.doc]);

  useEffect(() => {
    setActiveAwareness(collab.awareness);
    return () => setActiveAwareness(null);
  }, [collab.awareness]);

  useYToStoreSync(collab.doc);
  useAwarenessPublish(collab.awareness);

  return collab;
}
