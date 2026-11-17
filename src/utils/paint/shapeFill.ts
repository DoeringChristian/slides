import type { ClosurePathShape } from '../paths/pathShapes';
import type { FillStyle, ImageElement, ShapeElement } from '../../types/presentation';
import { noPaint, withPaintAlpha } from './paintColor';

export const HATCH_SPACING = 8;
export const HATCH_WIDTH = 1.5;
export function hasPatternFill(element: ShapeElement): boolean {
  return !noPaint(element.fill) && (element.fillStyle === 'hachure' || element.fillStyle === 'crosshatch')
    && (element.shapeType !== 'path' || !!element.closed || !!(element as ClosurePathShape)._pathClosure);
}
/** A gradient fill's paint, in the shape's box (local: origin at 0,0, as
 *  path shapes draw; else slide coordinates). Shared by the SVG paint server
 *  and canvas export so both lay the gradient out identically. */
export type GradientFill =
  | { kind: 'linear'; from: string; to: string; x1: number; y1: number; x2: number; y2: number }
  | { kind: 'radial'; from: string; to: string; cx: number; cy: number; r: number };
/** Gradient geometry, relative to the box: see `ShapeElement.fillLine`. */
export type GradientLine = [number, number, number, number];
const DEFAULT_LINE = { linear: [0.5, 0, 0.5, 1], radial: [0.5, 0.5, 1, 1] } as const;
/** The gradient line of a shape fill or an image tint (default if unset),
 *  or null when it has no gradient. */
export function gradientLineOf(el: ShapeElement | ImageElement): GradientLine | null {
  const style = el.type === 'image' ? el.tintStyle : el.fillStyle;
  if (style !== 'linear' && style !== 'radial') return null;
  const line = el.type === 'image' ? el.tintLine : el.fillLine;
  return line ? [...line] as GradientLine : [...DEFAULT_LINE[style]] as GradientLine;
}
/** The field that stores the gradient line, when the element has a gradient. */
export function gradientLineKey(el: ShapeElement | ImageElement): 'fillLine' | 'tintLine' | null {
  if (!gradientLineOf(el)) return null;
  return el.type === 'image' ? 'tintLine' : 'fillLine';
}
export function gradientFill(element: ShapeElement, local = false): GradientFill | null {
  const line = gradientLineOf(element);
  if (!line) return null;
  const from = noPaint(element.fill) ? 'rgba(0, 0, 0, 0)' : element.fill;
  const rawTo = element.fillTo ?? withPaintAlpha(from, 0);
  const to = noPaint(rawTo) ? withPaintAlpha(from, 0) : rawTo;
  if (noPaint(element.fill) && noPaint(rawTo)) return null;
  const x = local ? 0 : element.x, y = local ? 0 : element.y;
  const w = Math.max(1, element.width), h = Math.max(1, element.height);
  const [x1, y1, x2, y2] = [x + line[0] * w, y + line[1] * h, x + line[2] * w, y + line[3] * h];
  if (element.fillStyle === 'radial') return { kind: 'radial', from, to, cx: x1, cy: y1, r: Math.max(0.5, Math.hypot(x2 - x1, y2 - y1)) };
  return { kind: 'linear', from, to, x1, y1, x2, y2 };
}
/** Whether the shape paints a fill at all (a gradient may start transparent). */
export function hasFillPaint(element: ShapeElement): boolean {
  return !noPaint(element.fill) || !!gradientFill(element);
}

/** One stroke operation for ALL lines: crossings have the same alpha as the
 * rest of the hatch. SVG and Canvas clip this paint to the actual outline. */
export function hatchPath(width: number, height: number, style: FillStyle): string {
  const lines: string[] = [];
  for (let x = -Math.ceil(height / HATCH_SPACING) * HATCH_SPACING; x <= width + height; x += HATCH_SPACING) {
    lines.push(`M ${x} 0 l ${height} ${height}`);
    if (style === 'crosshatch') lines.push(`M ${x} 0 l ${-height} ${height}`);
  }
  return lines.join(' ');
}
export function drawShapeFill(ctx: CanvasRenderingContext2D, outline: Path2D, element: ShapeElement, local = false, rule: CanvasFillRule = 'nonzero') {
  const gradient = gradientFill(element, local);
  if (gradient) {
    const g = gradient.kind === 'linear'
      ? ctx.createLinearGradient(gradient.x1, gradient.y1, gradient.x2, gradient.y2)
      : ctx.createRadialGradient(gradient.cx, gradient.cy, 0, gradient.cx, gradient.cy, gradient.r);
    g.addColorStop(0, gradient.from);
    g.addColorStop(1, gradient.to);
    ctx.fillStyle = g;
    ctx.fill(outline, rule);
    return;
  }
  if (noPaint(element.fill)) return;
  if (!hasPatternFill(element)) {
    ctx.fillStyle = element.fill;
    ctx.fill(outline, rule);
    return;
  }
  ctx.save();
  ctx.clip(outline, rule);
  if (!local) ctx.translate(element.x, element.y);
  ctx.strokeStyle = element.fill;
  ctx.lineWidth = HATCH_WIDTH;
  ctx.lineCap = 'butt';
  ctx.setLineDash([]);
  ctx.stroke(new Path2D(hatchPath(element.width, element.height, element.fillStyle!)));
  ctx.restore();
}
