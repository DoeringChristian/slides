import type { Slide, Resource } from '../types/presentation';
import { SLIDE_WIDTH, SLIDE_HEIGHT } from './constants';
import { renderSlideToSVG, svgToDataURL } from './svgRenderer';

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

  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = width * pixelRatio;
      canvas.height = height * pixelRatio;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('Failed to get canvas context'));
        return;
      }
      ctx.scale(pixelRatio, pixelRatio);
      ctx.drawImage(img, 0, 0, width, height);
      resolve(canvas.toDataURL('image/png'));
    };
    img.onerror = () => reject(new Error('Failed to load SVG'));
    img.src = svgToDataURL(svgString);
  });
}
