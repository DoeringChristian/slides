import type { SlideElement, TextElement } from '../types/presentation';
import { anchorTextSize } from './freeTextResize';

export function canAutoFitText(element: SlideElement | null | undefined): element is TextElement {
  return element?.type === 'text' && element.visible && !element.locked && !element.containerId && element.textSizing !== 'auto-content';
}

/** Pinned Excalidraw desktop geometry, in local slide coordinates. */
export function textAutoFitHandle(element: TextElement, zoom: number) {
  if (!(zoom > 0) || 16 > (element.height * zoom + 8) * 0.8) return null;
  return { x: element.x + element.width + 16 / zoom, y: element.y + element.height / 2,
    width: 10 / zoom, height: 18 / zoom, length: 16 / zoom };
}

/** The opposite resize anchor pins the authored alignment in WORLD space. */
export function autoFitTextGeometry(element: TextElement, size: { width: number; height: number }) {
  const horizontal = { left: 'right', center: 'center', right: 'left' }[element.style.align];
  const vertical = { top: 'bottom', middle: 'middle', bottom: 'top' }[element.style.verticalAlign];
  return anchorTextSize(element, size, `${vertical}-${horizontal}`, false);
}
