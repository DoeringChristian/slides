import type { Presentation } from '../types/presentation';
import { assertPresentation } from './currentPresentation';
export { assertPresentation } from './currentPresentation';
import { readSlidesPayload } from './standaloneBoot';

export async function importPresentationFile(file: File): Promise<Presentation> {
  const ext = file.name.split('.').pop()?.toLowerCase();
  // Third-party parsers retain their existing conversion/normalization behavior.
  if (ext === 'pptx') return (await import('./importPptx')).importPptx(file);
  if (ext === 'odp') return (await import('./importOdp')).importOdp(file);
  const text = await file.text();
  if (ext === 'html' || ext === 'htm') {
    const payload = readSlidesPayload(new DOMParser().parseFromString(text, 'text/html'));
    if (payload === null) throw new Error('This HTML has no Slides presentation payload. Import an exported Slides HTML or JSON file.');
    return assertPresentation(payload);
  }
  return assertPresentation(JSON.parse(text));
}
