import type { Slide, Resource } from '../types/presentation';
import { SLIDE_WIDTH, SLIDE_HEIGHT } from './constants';
import { renderSlideToSVG, svgToPngDataURL } from './svgRenderer';

const THUMBNAIL_WIDTH = 320;
const THUMBNAIL_HEIGHT = (SLIDE_HEIGHT / SLIDE_WIDTH) * THUMBNAIL_WIDTH;

interface ThumbnailOptions {
  width?: number;
  height?: number;
  pixelRatio?: number;
}

export async function generateThumbnail(
  slide: Slide,
  resources: Record<string, Resource>,
  options: ThumbnailOptions = {}
): Promise<string> {
  const width = options.width || THUMBNAIL_WIDTH;
  const height = options.height || THUMBNAIL_HEIGHT;
  const pixelRatio = options.pixelRatio || 1;

  // Render slide to SVG
  const svgString = renderSlideToSVG(slide, resources);

  return svgToPngDataURL(svgString, { width, height, pixelRatio });
}
