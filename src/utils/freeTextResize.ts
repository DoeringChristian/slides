import type { TextElement } from '../types/presentation';
import type { BoundingBox } from './geometry';
import { rotateDelta, type ResizeUpdate } from './resizeGeometry';
import { measureUserText } from './userTextSizing';

export const MIN_RESIZE_FONT_SIZE = 1;

export function scalesFreeText(anchor: string, shift: boolean): boolean {
  return shift || !anchor.startsWith('middle-');
}

/** Place the measured box around the ORIGINAL rotated opposite anchor, not
 * around the provisional box's center. Side reflow keeps opposite midpoint. */
export function anchorTextSize(original: BoundingBox & { rotation: number }, size: Pick<BoundingBox, 'width' | 'height'>, anchor: string, centered: boolean): BoundingBox {
  const hx = anchor.includes('left') ? -1 : anchor.includes('right') ? 1 : 0;
  const hy = anchor.includes('top') ? -1 : anchor.includes('bottom') ? 1 : 0;
  const shift = centered ? { x: 0, y: 0 } : rotateDelta({
    x: hx * (size.width - original.width) / 2,
    y: hy * (size.height - original.height) / 2,
  }, original.rotation);
  return { ...size, x: original.x + (original.width - size.width) / 2 + shift.x,
    y: original.y + (original.height - size.height) / 2 + shift.y };
}

/** Gesture-local only: the authoritative stored snapshot remains untouched for
 * guards, the original world anchor, and undo. */
export function measureFreeTextResizeBaseline(original: TextElement) {
  return measureUserText(original);
}

/** One shared-layout request; preview and commit share this atomic patch. */
export async function resizeFreeText(original: TextElement, baseline: Pick<BoundingBox, 'width' | 'height'>, next: BoundingBox, anchor: string, shift: boolean, centered: boolean): Promise<ResizeUpdate> {
  const scaleFont = scalesFreeText(anchor, shift);
  const scale = scaleFont ? Math.max(MIN_RESIZE_FONT_SIZE / original.style.fontSize, next.width / baseline.width) : 1;
  const candidate: TextElement = { ...original,
    textSizing: scaleFont ? original.textSizing : 'user-width',
    width: scaleFont ? baseline.width * scale : next.width,
    style: { ...original.style, fontSize: original.style.fontSize * scale },
  };
  const size = await measureUserText(candidate);
  return { elementId: original.id, changes: {
    ...anchorTextSize(original, size, anchor, centered),
    textSizing: candidate.textSizing, style: candidate.style,
  } };
}
