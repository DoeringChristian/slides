import { useSyncExternalStore } from 'react';
import type { Awareness } from 'y-protocols/awareness';

export interface PeerState {
  clientId: number;
  user: { id: string; name: string; color: string };
  activeSlideId?: string | null;
  selectedElementIds?: string[];
}

// Subscribes to a Y awareness instance and returns the snapshot of all peer
// states (excluding the local client). Each `awareness change` event triggers
// a fresh snapshot.
//
// useSyncExternalStore demands that getSnapshot return a referentially-stable
// value when nothing has changed, or React will tear / loop. The cache lives
// in a module-level WeakMap keyed by awareness instance so two consumers of
// the same awareness share one snapshot.

interface CacheEntry {
  signature: string;
  snapshot: PeerState[];
}
const cache = new WeakMap<Awareness, CacheEntry>();
const EMPTY_PEERS: PeerState[] = [];

function computeSnapshot(awareness: Awareness): PeerState[] {
  const states = awareness.getStates();
  const localId = awareness.clientID;
  const signature: string[] = [];
  const out: PeerState[] = [];
  for (const [clientId, state] of states) {
    if (clientId === localId) continue;
    const user = (state as { user?: PeerState['user'] }).user;
    if (!user) continue;
    const cursor = (state as { cursor?: { activeSlideId: string | null; selectedElementIds: string[] } }).cursor;
    const peer: PeerState = {
      clientId,
      user,
      activeSlideId: cursor?.activeSlideId ?? null,
      selectedElementIds: cursor?.selectedElementIds ?? [],
    };
    out.push(peer);
    signature.push(`${clientId}:${user.id}:${peer.activeSlideId ?? ''}:${(peer.selectedElementIds || []).join(',')}`);
  }
  const sigStr = signature.join('|');
  const prev = cache.get(awareness);
  if (prev && prev.signature === sigStr) return prev.snapshot;
  const entry: CacheEntry = { signature: sigStr, snapshot: out };
  cache.set(awareness, entry);
  return entry.snapshot;
}

export function useAwarenessStates(awareness: Awareness | null): PeerState[] {
  const subscribe = (cb: () => void) => {
    if (!awareness) return () => {};
    awareness.on('change', cb);
    return () => awareness.off('change', cb);
  };
  const getSnapshot = () => (awareness ? computeSnapshot(awareness) : EMPTY_PEERS);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
