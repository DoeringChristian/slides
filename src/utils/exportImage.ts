import type { Presentation } from '../types/presentation';
import { SLIDE_WIDTH, SLIDE_HEIGHT } from './constants';
import { renderSlideToSVG, svgToDataURL } from './svgRenderer';

export async function exportImage(presentation: Presentation): Promise<void> {
  const activeSlideId = presentation.slideOrder[0];
  const slide = presentation.slides[activeSlideId];
  if (!slide) return;

  const svgString = renderSlideToSVG(slide, presentation.resources);

  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = SLIDE_WIDTH * 2;
      canvas.height = SLIDE_HEIGHT * 2;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('Failed to get canvas context'));
        return;
      }
      ctx.scale(2, 2);
      ctx.drawImage(img, 0, 0, SLIDE_WIDTH, SLIDE_HEIGHT);
      const dataUrl = canvas.toDataURL('image/png');

      const a = document.createElement('a');
      a.href = dataUrl;
      a.download = `${presentation.title.replace(/\s+/g, '_')}_slide.png`;
      a.click();
      resolve();
    };
    img.onerror = () => reject(new Error('Failed to load SVG'));
    img.src = svgToDataURL(svgString);
  });
}
