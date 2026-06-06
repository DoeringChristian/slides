import { useEffect, useRef, useState } from 'react';
import type { Awareness } from 'y-protocols/awareness';
import type { WebsocketProvider } from 'y-websocket';
import type { Doc as YDoc } from 'yjs';
import type { Identity } from '../hooks/useIdentity';

// Real-time collab connection to the server. The whole module is dynamically
// imported by the consumer (App) so non-server-mode users never pay the
// ~150KB Yjs + y-websocket bundle cost. The hook here in turn dynamically
// imports yjs and y-websocket on first invocation.

export interface CollabConnection {
  /** True after WS handshake + initial Y sync. */
  ready: boolean;
  /** Number of peers (other clients) currently connected. */
  peerCount: number;
  /** The live Y.Doc. Used by phase 5's store adapter; null until ready. */
  doc: YDoc | null;
  /** y-protocols awareness instance, with our identity already published. */
  awareness: Awareness | null;
  /** The WebsocketProvider — exposed for debugging. */
  provider: WebsocketProvider | null;
  /** Last connection error, or null. */
  error: string | null;
}

interface UseCollabConnectionOpts {
  /** Project (Y.Doc room) to connect to. Null disconnects. */
  projectId: string | null;
  /** Base WebSocket server URL, e.g. `http://localhost:3001`. Null disconnects. */
  serverUrl: string | null;
  /** Local user's identity — published to awareness on connect. */
  identity: Identity;
}

const INITIAL: CollabConnection = {
  ready: false,
  peerCount: 0,
  doc: null,
  awareness: null,
  provider: null,
  error: null,
};

export function useCollabConnection({ projectId, serverUrl, identity }: UseCollabConnectionOpts): CollabConnection {
  const [state, setState] = useState<CollabConnection>(INITIAL);
  // Hold the active provider in a ref so the cleanup function can reach it
  // even after fast state changes.
  const providerRef = useRef<WebsocketProvider | null>(null);

  useEffect(() => {
    if (!projectId || !serverUrl) {
      setState(INITIAL);
      return;
    }

    let cancelled = false;

    (async () => {
      const [{ Doc }, { WebsocketProvider }] = await Promise.all([
        import('yjs'),
        import('y-websocket'),
      ]);
      if (cancelled) return;

      const doc = new Doc();
      // y-websocket appends "/<room>" to the base URL — our server matches
      // `/yjs/:projectId`. The trailing-slash-less `${serverUrl}/yjs` form
      // is intentional; WebsocketProvider does the join.
      const wsBase = serverUrl.replace(/^http/, 'ws');
      const provider = new WebsocketProvider(`${wsBase}/yjs`, projectId, doc);
      providerRef.current = provider;

      // Publish the local user before the WS connects so peers see us as soon
      // as the first awareness sync runs.
      provider.awareness.setLocalStateField('user', {
        id: identity.userId,
        name: identity.name,
        color: identity.color,
      });

      const onSync = (isSynced: boolean) => {
        if (cancelled) return;
        setState((s) => ({ ...s, ready: isSynced, doc, awareness: provider.awareness, provider }));
      };
      const onStatus = (e: { status: string }) => {
        if (cancelled) return;
        if (e.status === 'disconnected') {
          setState((s) => ({ ...s, ready: false }));
        }
      };
      const onAwareness = () => {
        if (cancelled) return;
        // -1 for ourselves
        const peerCount = Math.max(0, provider.awareness.getStates().size - 1);
        setState((s) => ({ ...s, peerCount }));
      };
      const onError = (err: unknown) => {
        if (cancelled) return;
        setState((s) => ({ ...s, error: (err as Error)?.message ?? String(err) }));
      };

      provider.on('sync', onSync);
      provider.on('status', onStatus);
      provider.awareness.on('change', onAwareness);
      provider.on('connection-error', onError);
    })().catch((err) => {
      if (cancelled) return;
      setState((s) => ({ ...s, error: (err as Error).message }));
    });

    return () => {
      cancelled = true;
      const p = providerRef.current;
      providerRef.current = null;
      if (p) {
        p.awareness.setLocalState(null);
        p.disconnect();
        p.destroy();
      }
      setState(INITIAL);
    };
  }, [projectId, serverUrl, identity.userId, identity.name, identity.color]);

  return state;
}
