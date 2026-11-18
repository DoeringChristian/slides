import { createContext, useContext, useEffect, useState, useSyncExternalStore } from 'react';
import { mediaObjectUrl, mediaVersion, subscribeMedia } from '../../media/mediaStore';

// Media sources shared by every renderer. A media file's bytes come from
// the media store (src/media): one blob URL per file that every element
// showing it reads, or the server's streaming URL until the file is here.
// Still renders (thumbnails) draw a cached poster frame, not a live video.

const posters = new Map<string, Promise<string>>();
/** A video's frame at `time` as a small still (cached per source and time). */
export function videoPoster(hash: string, time = 0): Promise<string> {
  const key = `${time}|${hash}`;
  let job = posters.get(key);
  if (!job) {
    job = (async () => {
      const video = document.createElement('video');
      const url = await mediaObjectUrl(hash);
      if (!url) throw new Error('missing media');
      video.muted = true; video.preload = 'auto'; video.src = url;
      await new Promise<void>((resolve, reject) => { video.onloadeddata = () => resolve(); video.onerror = () => reject(new Error('video')); });
      video.currentTime = Math.max(0.001, time);
      await new Promise(r => { video.onseeked = r; setTimeout(r, 2000); });
      const canvas = document.createElement('canvas');
      const scale = Math.min(1, 640 / (video.videoWidth || 640));
      canvas.width = Math.max(1, Math.round((video.videoWidth || 16) * scale));
      canvas.height = Math.max(1, Math.round((video.videoHeight || 9) * scale));
      canvas.getContext('2d')!.drawImage(video, 0, 0, canvas.width, canvas.height);
      video.removeAttribute('src'); video.load();
      return canvas.toDataURL('image/jpeg', 0.75);
    })().catch(() => { posters.delete(key); return ''; });
    posters.set(key, job);
  }
  return job;
}

export function useVideoPoster(hash: string | undefined, time = 0): string | undefined {
  const [poster, setPoster] = useState<{ key: string; url: string } | null>(null);
  const key = hash ? `${time}|${hash}` : '';
  // Retry when media arrives (a poster of a file not yet here is empty).
  const version = useSyncExternalStore(subscribeMedia, mediaVersion, mediaVersion);
  const retry = poster && poster.key === key && poster.url ? 0 : version;
  useEffect(() => {
    if (!hash) return;
    let live = true;
    void videoPoster(hash, time).then(url => { if (live) setPoster({ key: `${time}|${hash}`, url }); });
    return () => { live = false; };
  }, [hash, time, retry]);
  return poster && poster.key === key ? poster.url || undefined : undefined;
}

/** Inside a still render (slide thumbnails, template previews): videos draw
 *  their poster frame, not a live player. */
export const MediaStillContext = createContext(false);
export const useMediaStill = () => useContext(MediaStillContext);
