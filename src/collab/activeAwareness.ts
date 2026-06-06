import { useSyncExternalStore } from 'react';
import type { Awareness } from 'y-protocols/awareness';
import { useAwarenessStates, type PeerState } from './useAwarenessStates';

// Module-level singleton tracking the currently-connected collab awareness.
// App.tsx sets it when useCollabConnection produces one. Header,
// SlideThumbnail, and SVGSlideCanvas read it via `useActivePeers()`.

let activeAwareness: Awareness | null = null;
const listeners = new Set<() => void>();

export function setActiveAwareness(a: Awareness | null) {
  if (activeAwareness === a) return;
  activeAwareness = a;
  listeners.forEach((cb) => cb());
}

export function getActiveAwareness(): Awareness | null {
  return activeAwareness;
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function getSnapshot() {
  return activeAwareness;
}

/** React-safe view of the singleton. Re-renders when the awareness instance
 *  swaps out (e.g. user changes project). */
function useActiveAwareness(): Awareness | null {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/** Peers visible right now, excluding ourselves. */
export function useActivePeers(): PeerState[] {
  const aw = useActiveAwareness();
  return useAwarenessStates(aw);
}
