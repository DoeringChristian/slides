import type { SlideElement, TextElement } from '../../types/presentation';
import { anchorTextSize } from '../geometry/freeTextResize';

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

/**
 * A free text box is the size of its text, so the font size and the box are
 * one quantity: changing the font size scales the box exactly as a corner
 * resize does — width and height by the ratio, so the wrapping stays — and
 * the box stays pinned where its alignment pins it (left-aligned text keeps
 * its left edge, centred its centre, right-aligned its right edge; top /
 * middle / bottom likewise). Null when nothing changes (or for bound labels,
 * which their container sizes).
 */
export function textBoxForFontSize(element: TextElement, fontSize: number): Pick<TextElement, 'x' | 'y' | 'width' | 'height'> | null {
  if (element.containerId || !(element.style.fontSize > 0) || !(fontSize > 0) || fontSize === element.style.fontSize) return null;
  const scale = fontSize / element.style.fontSize;
  return autoFitTextGeometry(element, { width: element.width * scale, height: element.height * scale });
}

/** `changes` plus the box a font-size change in it implies (see
 *  textBoxForFontSize) — unless the change sets the box itself. */
export function withTextBox<T extends SlideElement>(element: T, changes: Partial<T>): Partial<T> {
  if (element.type !== 'text') return changes;
  const style = (changes as Partial<TextElement>).style;
  if (!style || style.fontSize === undefined || ['x', 'y', 'width', 'height'].some(k => k in changes)) return changes;
  // Anchor by the alignment the text will have (it may change too).
  const box = textBoxForFontSize({ ...element, style: { ...element.style, ...style, fontSize: element.style.fontSize } }, style.fontSize);
  return box ? { ...changes, ...box } : changes;
}
