import { useSyncExternalStore } from 'react';

// `(pointer: coarse)` — true on touchscreens / styluses, false on mouse-only
// devices. Distinct from useIsMobile (which is viewport-size based): a touch
// laptop on a wide screen is coarse + !mobile, and a desktop browser in
// devtools "mobile" mode is !coarse + mobile.
//
// Use this to suppress hover-only affordances (highlights, tooltips) on touch,
// where there's no hover state worth painting at tap-release.

const QUERY = '(pointer: coarse)';

function subscribe(cb: () => void) {
  const mql = window.matchMedia(QUERY);
  mql.addEventListener('change', cb);
  return () => mql.removeEventListener('change', cb);
}

function getSnapshot() {
  return window.matchMedia(QUERY).matches;
}

function getServerSnapshot() {
  return false;
}

export function useCoarsePointer(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
