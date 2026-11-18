// Media as data URLs — only where a format cannot reference files: an SVG
// drawn into a canvas (thumbnails, PNG/PPTX rasters, the assistant's view)
// loads no external URLs, and a single-file HTML export has nowhere else to
// put them. Everything else reads the media store directly.

import type { Resource, Slide } from '../types/presentation';
import { mediaDataUrl } from './mediaStore';

/** resource id → data URL. */
export type MediaSources = Record<string, string>;

/** The image resources a slide draws (elements and background). Videos are
 *  drawn as placeholders by the string renderers, so they need no bytes. */
export function slideImageIds(slide: Pick<Slide, 'elements' | 'background'>, resources: Record<string, Resource>): Set<string> {
  const ids = new Set<string>();
  for (const el of Object.values(slide.elements)) {
    if (el.type === 'image' && el.resourceId && resources[el.resourceId]?.type === 'image') ids.add(el.resourceId);
  }
  if (slide.background.type === 'image' && resources[slide.background.resourceId]) ids.add(slide.background.resourceId);
  return ids;
}

/** Data URLs of the given resources (all when `ids` is omitted). A file that
 *  cannot be found is left out: its element draws as a placeholder. */
export async function mediaDataUrls(resources: Record<string, Resource>, ids?: Iterable<string>): Promise<MediaSources> {
  const out: MediaSources = {};
  for (const id of ids ?? Object.keys(resources)) {
    const resource = resources[id];
    if (!resource) continue;
    const url = await mediaDataUrl(resource);
    if (url) out[id] = url;
  }
  return out;
}
