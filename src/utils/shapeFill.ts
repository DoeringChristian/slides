import type { ClosurePathShape } from './pathShapes';
import type { FillStyle, ShapeElement } from '../types/presentation';
import { noPaint } from './paintColor';

export const HATCH_SPACING = 8;
export const HATCH_WIDTH = 1.5;
export function hasPatternFill(element: ShapeElement): boolean {
  return !noPaint(element.fill) && (element.fillStyle === 'hachure' || element.fillStyle === 'crosshatch')
    && (element.shapeType !== 'path' || !!element.closed || !!(element as ClosurePathShape)._pathClosure);
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
