import type { Presentation } from '../types/presentation';
import { renderSlideToSVG, svgToPngDataURL } from './svgRenderer';

export async function exportImage(presentation: Presentation): Promise<void> {
  const activeSlideId = presentation.slideOrder[0];
  const slide = presentation.slides[activeSlideId];
  if (!slide) return;

  const svgString = renderSlideToSVG(slide, presentation.resources);
  const dataUrl = await svgToPngDataURL(svgString, { pixelRatio: 2 });

  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = `${presentation.title.replace(/\s+/g, '_')}_slide.png`;
  a.click();
}
