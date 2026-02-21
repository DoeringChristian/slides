import Konva from 'konva';
import type { Presentation, Slide, TextElement, ShapeElement } from '../types/presentation';
import { SLIDE_WIDTH, SLIDE_HEIGHT } from './constants';

export async function exportImage(presentation: Presentation): Promise<void> {
  const activeSlideId = presentation.slideOrder[0];
  const slide = presentation.slides[activeSlideId];
  if (!slide) return;

  const container = document.createElement('div');
  container.style.position = 'absolute';
  container.style.left = '-9999px';
  document.body.appendChild(container);

  const stage = new Konva.Stage({ container, width: SLIDE_WIDTH, height: SLIDE_HEIGHT });
  const layer = new Konva.Layer();
  stage.add(layer);

  const bgColor = slide.background.type === 'solid' ? slide.background.color : '#ffffff';
  layer.add(new Konva.Rect({ x: 0, y: 0, width: SLIDE_WIDTH, height: SLIDE_HEIGHT, fill: bgColor }));

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
      }));
    } else if (el.type === 'shape') {
      const s = el as ShapeElement;
      layer.add(new Konva.Rect({ x: s.x, y: s.y, width: s.width, height: s.height, fill: s.fill, stroke: s.stroke, strokeWidth: s.strokeWidth, rotation: s.rotation, opacity: s.opacity }));
    }
  }

  layer.draw();
  const dataUrl = stage.toDataURL({ pixelRatio: 2 });
  stage.destroy();
  container.remove();

  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = `${presentation.title.replace(/\s+/g, '_')}_slide.png`;
  a.click();
}
