import { createContext, useContext, useSyncExternalStore } from 'react';
import type { Resource } from '../types/presentation';
import { mediaSource, mediaVersion, subscribeMedia, uploadProgress, type MediaStatus } from './mediaStore';

export interface MediaSourceState {
  url: string | undefined;
  status: MediaStatus;
  /** 0..1 while this window uploads the file. */
  upload: number | null;
}

/** Media to draw from given data URLs (resource id → URL) instead of the
 *  store: still renders turned into PNGs, where blob and http URLs do not
 *  load (an SVG drawn into a canvas loads nothing external). */
export const MediaSourcesContext = createContext<Record<string, string> | null>(null);

/**
 * Where a renderer shows a resource from: the local copy once it is here,
 * the server's stream until then. (Only the editor ever streams: presenting
 * first copies every file here, so a playing video never switches source.)
 */
export function useMediaSource(resource: Pick<Resource, 'id' | 'hash'> | undefined | null): MediaSourceState {
  useSyncExternalStore(subscribeMedia, mediaVersion, mediaVersion);
  const given = useContext(MediaSourcesContext);
  if (!resource?.hash) return { url: undefined, status: 'missing', upload: null };
  if (given) {
    const url = given[resource.id];
    return { url, status: url ? 'ready' : 'missing', upload: null };
  }
  const now = mediaSource(resource.hash);
  const progress = uploadProgress(resource.hash);
  return {
    url: now.url ?? undefined,
    status: now.status,
    upload: progress ? progress.loaded / Math.max(1, progress.total) : null,
  };
}
