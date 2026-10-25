import type { SlideElement, TextElement } from '../types/presentation';
import { TEXT_BOX_PADDING } from './constants';

/** Insets belong to the text policy, never to an editor-only rendering path. */
export function textInsets(element: TextElement): number {
  return element.containerId && element.boundTextLayout === 'padded' ? TEXT_BOX_PADDING : 0;
}
/** Ink allowance is not layout padding: tight boxes must not shave math/italics. */
export function textInkOverflow(element: TextElement): number {
  return Math.max(6, element.style.fontSize * 0.3);
}
export function supportsMeasuredBoundText(container: SlideElement): boolean {
  return container.type === 'shape' && (container.shapeType === 'rect' || container.shapeType === 'ellipse');
}
export function isMeasuredBoundText(container: SlideElement, label: TextElement): boolean {
  return label.boundTextLayout === 'measured' && supportsMeasuredBoundText(container);
}
export function boundTextBaseline(container: SlideElement, label: TextElement): number {
  const value = label.boundTextBaselineHeight;
  return isMeasuredBoundText(container, label) && typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value : Math.max(1, container.height);
}
export function boundTextUsableSize(container: SlideElement, dimension: number): number {
  return Math.max(1, (container.type === 'shape' && container.shapeType === 'ellipse'
    ? Math.round(dimension / Math.SQRT2) : dimension) - 10);
}
/** Reference inscribed rectangle: dimensions are rounded, origins are not.
 * Centering on the outer bbox loses this deliberate subpixel offset. */
export function boundTextUsableRect(container: SlideElement) {
  const factor = container.type === 'shape' && container.shapeType === 'ellipse'
    ? (1 - Math.SQRT2 / 2) / 2 : 0;
  return {
    x: container.x + 5 + container.width * factor,
    y: container.y + 5 + container.height * factor,
    width: boundTextUsableSize(container, container.width),
    height: boundTextUsableSize(container, container.height),
  };
}
/** Placement deliberately excluded: delayed measurements apply at the latest x/y. */
export function boundTextMeasurementKey(container: SlideElement, label: TextElement, rawLines?: Set<number>): string {
  return JSON.stringify([label.id, label.containerId, label.text, label.style, label.boundTextLayout,
    container.id, container.type === 'shape' ? container.shapeType : container.type, container.width,
    rawLines ? [...rawLines].sort((a, b) => a - b) : []]);
}
export interface BoundTextFitContext {
  baselineHeight: number;
  currentHeight: number;
}
