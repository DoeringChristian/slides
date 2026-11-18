// Decks made before media became files embed it: `resource.src` as a data
// URL (or a URL), image backgrounds as `background.src`. Importing such a
// deck moves every embedded file into the media store and leaves only the
// reference — the same as adding the file by hand. This is the import path,
// not a reader of an old format: what it returns is a current deck.

import { addMedia, dataUrlToBlob, hashBlob } from './mediaStore';
import { generateId } from '../utils/idGenerator';

type Raw = Record<string, unknown>;
const isRecord = (v: unknown): v is Raw => !!v && typeof v === 'object' && !Array.isArray(v);

async function fetchBlob(src: string): Promise<Blob> {
  if (src.startsWith('data:')) return dataUrlToBlob(src);
  const res = await fetch(src);
  if (!res.ok) throw new Error(`Could not fetch embedded media ${src.slice(0, 80)} (HTTP ${res.status})`);
  return await res.blob();
}

/** Move a raw deck's embedded media into the media store, in place. */
export async function importEmbeddedMedia(raw: unknown): Promise<unknown> {
  if (!isRecord(raw)) return raw;
  const resources = isRecord(raw.resources) ? raw.resources : (raw.resources = {}) as Raw;
  for (const value of Object.values(resources)) {
    if (!isRecord(value) || typeof value.src !== 'string') continue;
    const blob = await fetchBlob(value.src);
    const mime = blob.type || (value.type === 'video' ? 'video/mp4' : 'image/png');
    const media = await addMedia(blob, mime, { upload: false });
    value.hash = media.hash; value.mime = media.mime; value.size = media.size;
    delete value.src;
  }
  // Image backgrounds become resources, so their bytes are files too.
  const byHash = new Map(Object.values(resources).filter(isRecord).map(r => [r.hash, r.id]));
  for (const collection of [raw.slides, raw.templates]) {
    if (!isRecord(collection)) continue;
    for (const slide of Object.values(collection)) {
      const bg = isRecord(slide) && isRecord(slide.background) ? slide.background : null;
      if (!bg || bg.type !== 'image' || typeof bg.src !== 'string') continue;
      const blob = await fetchBlob(bg.src);
      const hash = await hashBlob(blob);
      let id = byHash.get(hash) as string | undefined;
      if (!id) {
        const media = await addMedia(blob, blob.type || 'image/png', { upload: false });
        const size = await imageSize(blob);
        id = generateId();
        resources[id] = { id, name: 'Background', type: 'image', ...media, originalWidth: size.width, originalHeight: size.height };
        byHash.set(hash, id);
      }
      bg.resourceId = id;
      delete bg.src;
    }
  }
  return raw;
}

function imageSize(blob: Blob): Promise<{ width: number; height: number }> {
  if (typeof Image === 'undefined') return Promise.resolve({ width: 1, height: 1 });
  const url = URL.createObjectURL(blob);
  return new Promise<{ width: number; height: number }>((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth || 1, height: img.naturalHeight || 1 });
    img.onerror = () => resolve({ width: 1, height: 1 });
    img.src = url;
  }).finally(() => URL.revokeObjectURL(url));
}
