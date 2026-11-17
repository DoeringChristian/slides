import { createContext, useContext, useEffect, useState } from 'react';

// Media sources shared by every renderer. A deck stores media inline as
// data: URLs (tens of MB each). Handing that string to every <video> makes
// each one parse and buffer its own copy — with thumbnails, previews and
// the canvas that is dozens of full-resolution copies. Instead each source
// is turned into ONE blob URL that every element reads, and still renders
// (thumbnails) draw a cached poster frame rather than a live video.

const blobUrls = new Map<string, Promise<string>>();

/** One shared URL for a media source (data: URLs become a blob URL once). */
export function mediaUrl(src: string): Promise<string> {
  if (!src.startsWith('data:')) return Promise.resolve(src);
  let url = blobUrls.get(src);
  if (!url) {
    url = fetch(src).then(r => r.blob()).then(blob => URL.createObjectURL(blob)).catch(() => src);
    blobUrls.set(src, url);
  }
  return url;
}

const resolved = new Map<string, string>();
/** The shared URL of a media source, once ready (undefined until then). */
export function useMediaUrl(src: string | undefined): string | undefined {
  const immediate = src && !src.startsWith('data:') ? src : src ? resolved.get(src) : undefined;
  const [url, setUrl] = useState<{ src: string; url: string } | null>(null);
  useEffect(() => {
    if (!src || immediate) return;
    let live = true;
    void mediaUrl(src).then(u => { resolved.set(src, u); if (live) setUrl({ src, url: u }); });
    return () => { live = false; };
  }, [src, immediate]);
  return immediate ?? (url && url.src === src ? url.url : undefined);
}

const posters = new Map<string, Promise<string>>();
/** A video's frame at `time` as a small still (cached per source and time). */
export function videoPoster(src: string, time = 0): Promise<string> {
  const key = `${time}|${src}`;
  let job = posters.get(key);
  if (!job) {
    job = (async () => {
      const video = document.createElement('video');
      video.muted = true; video.preload = 'auto'; video.src = await mediaUrl(src);
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
    })().catch(() => '');
    posters.set(key, job);
  }
  return job;
}

export function useVideoPoster(src: string | undefined, time = 0): string | undefined {
  const [poster, setPoster] = useState<{ key: string; url: string } | null>(null);
  const key = src ? `${time}|${src}` : '';
  useEffect(() => {
    if (!src) return;
    let live = true;
    void videoPoster(src, time).then(url => { if (live) setPoster({ key: `${time}|${src}`, url }); });
    return () => { live = false; };
  }, [src, time]);
  return poster && poster.key === key ? poster.url || undefined : undefined;
}

/** Inside a still render (slide thumbnails, template previews): videos draw
 *  their poster frame, not a live player. */
export const MediaStillContext = createContext(false);
export const useMediaStill = () => useContext(MediaStillContext);
