import jsPDF from 'jspdf';
import type { Presentation } from '../types/presentation';
import { SLIDE_WIDTH, SLIDE_HEIGHT } from './constants';
import { renderSlideToSVG, svgToDataURL } from './svgRenderer';

async function renderSlideToDataURL(slide: Parameters<typeof renderSlideToSVG>[0], resources: Parameters<typeof renderSlideToSVG>[1]): Promise<string> {
  const svgString = renderSlideToSVG(slide, resources);

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
      resolve(canvas.toDataURL('image/png'));
    };
    img.onerror = () => reject(new Error('Failed to load SVG'));
    img.src = svgToDataURL(svgString);
  });
}

export async function exportPdf(presentation: Presentation): Promise<void> {
  const pdf = new jsPDF({ orientation: 'landscape', unit: 'px', format: [SLIDE_WIDTH, SLIDE_HEIGHT] });

  for (let i = 0; i < presentation.slideOrder.length; i++) {
    const slideId = presentation.slideOrder[i];
    const slide = presentation.slides[slideId];
    if (!slide) continue;

    if (i > 0) pdf.addPage();

    const dataUrl = await renderSlideToDataURL(slide, presentation.resources);
    pdf.addImage(dataUrl, 'PNG', 0, 0, SLIDE_WIDTH, SLIDE_HEIGHT);
  }

  pdf.save(`${presentation.title.replace(/\s+/g, '_')}.pdf`);
}
