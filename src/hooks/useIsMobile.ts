import { useSyncExternalStore } from 'react';

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

const MOBILE_QUERY = '(max-width: 767px)';

function subscribe(callback: () => void) {
  const mql = window.matchMedia(MOBILE_QUERY);
  mql.addEventListener('change', callback);
  return () => mql.removeEventListener('change', callback);
}

function getSnapshot() {
  return window.matchMedia(MOBILE_QUERY).matches;
}

function getServerSnapshot() {
  return false;
}

export function useIsMobile(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
