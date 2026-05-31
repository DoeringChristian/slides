import type { Presentation, Resource } from '../types/presentation';

// A resource is safe to embed if its src is already a data URL.
// blob: URLs, http(s) URLs, and absolute/relative paths must be fetched and re-encoded.
function isDataUrl(src: string): boolean {
  return src.startsWith('data:');
}

async function urlToDataUrl(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch resource: ${url} (${res.status})`);
  const blob = await res.blob();
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

// Walks presentation.resources and presentation.slides[*].background and rewrites any
// non-data URLs to data URLs so the resulting JSON can be embedded in a standalone HTML
// and still render when opened from file://.
export async function embedResources(presentation: Presentation): Promise<Presentation> {
  const resources: Record<string, Resource> = {};
  for (const [id, resource] of Object.entries(presentation.resources)) {
    if (isDataUrl(resource.src)) {
      resources[id] = resource;
      continue;
    }
    try {
      resources[id] = { ...resource, src: await urlToDataUrl(resource.src) };
    } catch (err) {
      console.warn(`[embedResources] keeping original src for ${id}:`, err);
      resources[id] = resource;
    }
  }

  const slides = { ...presentation.slides };
  for (const [slideId, slide] of Object.entries(slides)) {
    if (slide.background.type !== 'image' || isDataUrl(slide.background.src)) continue;
    try {
      slides[slideId] = {
        ...slide,
        background: { ...slide.background, src: await urlToDataUrl(slide.background.src) },
      };
    } catch (err) {
      console.warn(`[embedResources] keeping original background for slide ${slideId}:`, err);
    }
  }

  return { ...presentation, resources, slides };
}
