import type { Presentation } from '../../types/presentation';
import { upgradeNativePresentation } from '../model/legacyPresentation';
export { assertPresentation } from '../model/currentPresentation';
import { readSlidesMedia, readSlidesPayload } from './standaloneBoot';
import { addMedia } from '../../media/mediaStore';
import { importEmbeddedMedia } from '../../media/importMedia';
import { importDeckFileMedia } from '../../media/deckFile';

export async function importPresentationFile(file: File): Promise<Presentation> {
  const ext = file.name.split('.').pop()?.toLowerCase();
  // Third-party parsers retain their existing conversion/normalization behavior.
  if (ext === 'pptx') return (await import('./importPptx')).importPptx(file);
  if (ext === 'odp') return (await import('./importOdp')).importOdp(file);
  const text = await file.text();
  if (ext === 'html' || ext === 'htm') {
    const doc = new DOMParser().parseFromString(text, 'text/html');
    const payload = readSlidesPayload(doc);
    if (payload === null) throw new Error('This HTML has no Slides presentation payload. Import an exported Slides HTML or JSON file.');
    // Its media files come along as their own elements: keep each one.
    for (const [, blob] of readSlidesMedia(doc)) await addMedia(blob, blob.type, { upload: false });
    return upgradeNativePresentation(await importEmbeddedMedia(payload));
  }
  return upgradeNativePresentation(await importEmbeddedMedia(await importDeckFileMedia(JSON.parse(text))));
}
