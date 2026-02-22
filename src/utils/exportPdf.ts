import jsPDF from 'jspdf';
import Konva from 'konva';
import type { Presentation, Slide, TextElement, ShapeElement } from '../types/presentation';
import { SLIDE_WIDTH, SLIDE_HEIGHT } from './constants';

function renderSlideToDataURL(slide: Slide, width: number, height: number): Promise<string> {
  return new Promise((resolve) => {
    const container = document.createElement('div');
    container.style.position = 'absolute';
    container.style.left = '-9999px';
    document.body.appendChild(container);

    const stage = new Konva.Stage({ container, width, height });
    const layer = new Konva.Layer();
    stage.add(layer);

    // Background
    const bgColor = slide.background.type === 'solid' ? slide.background.color : '#ffffff';
    layer.add(new Konva.Rect({ x: 0, y: 0, width, height, fill: bgColor }));

    // Elements
    const elements = slide.elementOrder.map((id) => slide.elements[id]).filter(Boolean);
    for (const el of elements) {
      if (!el.visible) continue;
      if (el.type === 'text') {
        const t = el as TextElement;
        layer.add(new Konva.Text({
          x: t.x, y: t.y, width: t.width, height: t.height,
          text: t.text, fontSize: t.style.fontSize, fontFamily: t.style.fontFamily,
          fill: t.style.color, align: t.style.align, rotation: t.rotation, opacity: t.opacity,
          fontStyle: `${t.style.fontWeight === 'bold' ? 'bold' : ''} ${t.style.fontStyle === 'italic' ? 'italic' : ''}`.trim() || 'normal',
          lineHeight: t.style.lineHeight,
        }));
      } else if (el.type === 'shape') {
        const s = el as ShapeElement;
        const common = { rotation: s.rotation, opacity: s.opacity };
        switch (s.shapeType) {
          case 'rect':
            layer.add(new Konva.Rect({ x: s.x, y: s.y, width: s.width, height: s.height, fill: s.fill, stroke: s.stroke, strokeWidth: s.strokeWidth, cornerRadius: s.cornerRadius, ...common }));
            break;
          case 'ellipse':
            layer.add(new Konva.Ellipse({ x: s.x + s.width/2, y: s.y + s.height/2, radiusX: s.width/2, radiusY: s.height/2, fill: s.fill, stroke: s.stroke, strokeWidth: s.strokeWidth, ...common }));
            break;
          case 'line':
            layer.add(new Konva.Line({ x: s.x, y: s.y, points: s.points ?? [0, 0, s.width, 0], stroke: s.stroke || s.fill, strokeWidth: s.strokeWidth || 3, ...common }));
            break;
          case 'arrow':
            layer.add(new Konva.Arrow({ x: s.x, y: s.y, points: s.points ?? [0, 0, s.width, 0], stroke: s.stroke || s.fill, strokeWidth: s.strokeWidth || 3, fill: s.stroke || s.fill, pointerLength: 10, pointerWidth: 10, ...common }));
            break;
          default:
            layer.add(new Konva.Rect({ x: s.x, y: s.y, width: s.width, height: s.height, fill: s.fill, stroke: s.stroke, strokeWidth: s.strokeWidth, ...common }));
        }
      }
    }

    layer.draw();
    const dataUrl = stage.toDataURL({ pixelRatio: 2 });
    stage.destroy();
    container.remove();
    resolve(dataUrl);
  });
}

export async function exportPdf(presentation: Presentation): Promise<void> {
  const pdf = new jsPDF({ orientation: 'landscape', unit: 'px', format: [SLIDE_WIDTH, SLIDE_HEIGHT] });

  for (let i = 0; i < presentation.slideOrder.length; i++) {
    const slideId = presentation.slideOrder[i];
    const slide = presentation.slides[slideId];
    if (!slide) continue;

    if (i > 0) pdf.addPage();

    const dataUrl = await renderSlideToDataURL(slide, SLIDE_WIDTH, SLIDE_HEIGHT);
    pdf.addImage(dataUrl, 'PNG', 0, 0, SLIDE_WIDTH, SLIDE_HEIGHT);
  }

  pdf.save(`${presentation.title.replace(/\s+/g, '_')}.pdf`);
}
