import { useSyncExternalStore } from 'react';

/** Build a hook that tracks a media query via useSyncExternalStore, updating
 *  on query-state changes without a manual resize listener in every consumer.
 *  Server snapshot is always false. */
export function makeMediaQueryHook(query: string): () => boolean {
  function subscribe(callback: () => void) {
    const mql = window.matchMedia(query);
    mql.addEventListener('change', callback);
    return () => mql.removeEventListener('change', callback);
  }

  function getSnapshot() {
    return window.matchMedia(query).matches;
  }

  function getServerSnapshot() {
    return false;
  }

  return function useMediaQuery(): boolean {
    return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  };
}

// Single source of truth for "are we on a phone-sized viewport?" Backed by
// matchMedia so it updates on rotation and devtools resize without a manual
// resize listener in every consumer.
//
// Note: this is a *viewport-size* question, distinct from the "is this a touch
// device?" question (which is `(pointer: coarse)`). Use this for layout
// branching (mobile shell vs desktop shell); use the Tailwind `coarse:`
// variant for affordance branching (always-visible delete buttons, larger hit
// targets, etc.). The two answers usually agree but not always (e.g. a touch
// laptop on a wide screen is `coarse + !mobile`).
export const useIsMobile = makeMediaQueryHook('(max-width: 767px)');
