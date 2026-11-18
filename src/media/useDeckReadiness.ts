import { useSyncExternalStore } from 'react';
import { getDeckReadiness, subscribeMedia, type DeckReadiness } from './mediaStore';

/** The open deck's media readiness (see trackDeckMedia). */
export function useDeckReadiness(): DeckReadiness {
  return useSyncExternalStore(subscribeMedia, getDeckReadiness, getDeckReadiness);
}

/** "Media ready 12/71" — or null when everything is here. */
export function readinessLabel(r: DeckReadiness): string | null {
  if (!r.total || (r.ready === r.total && !r.missing.length)) return null;
  if (!r.checking && r.missing.length) return `${r.missing.length} media file${r.missing.length === 1 ? '' : 's'} missing`;
  return `Media ${r.ready}/${r.total}`;
}
