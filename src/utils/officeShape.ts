import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { RenderShape } from '../components/svg/ElementRenderer';
import type { ShapeElement } from '../types/presentation';
import { hasPatternFill } from './shapeFill';
import { noPaint, parsePaintColor, paintHex } from './paintColor';
import { SLIDE_WIDTH, SLIDE_HEIGHT } from './constants';

export function officePaint(color: string, opacity = 1) {
  const c = parsePaintColor(color);
  return { color: c ? paintHex(c) : color, alpha: (c?.a ?? 1) * opacity };
}
/** Native independent fill/line alpha is exact for simple solid shapes.
 * Composition opacity over overlapping paints, hatches and translucent
 * headed paths need the shared renderer rather than target approximations. */
export function officeShapeNeedsSvg(el: ShapeElement): boolean {
  return el.shapeType === 'vector' || hasPatternFill(el)
    || (el.opacity < 1 && !noPaint(el.fill) && !noPaint(el.stroke) && el.strokeWidth > 0)
    || (el.shapeType === 'path' && (el.opacity < 1
      || (parsePaintColor(el.stroke)?.a ?? 1) < 1
      || (!!el.closed && !noPaint(el.fill) && (parsePaintColor(el.fill)?.a ?? 1) < 1)));
}
/** Slide-sized viewport intentionally bakes position, rotation and stroke/head
 * overflow exactly once. No fonts or external resources; editable as image. */
export function officeShapeSvg(el: ShapeElement): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${SLIDE_WIDTH}" height="${SLIDE_HEIGHT}" viewBox="0 0 ${SLIDE_WIDTH} ${SLIDE_HEIGHT}">${renderToStaticMarkup(createElement(RenderShape, { element: el }))}</svg>`;
}
