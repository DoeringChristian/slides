import type { ClosurePathShape } from './pathShapes';
import type { ShapeElement } from '../types/presentation';

/** The steady renderer's paint semantics, shared with input and export paths.
 * Open paths historically render at 3 units when stored width is zero. */
export function resolveShapePaint(shape: ShapeElement, fillPaint = shape.fill || 'transparent') {
  const stroke = shape.stroke || 'none';
  const width = shape.strokeWidth || 0;
  if (shape.shapeType !== 'path') return { fill: fillPaint, stroke, strokeWidth: width };
  const closure = (shape as ClosurePathShape)._pathClosure;
  return {
    fill: shape.closed || closure ? fillPaint : 'none',
    ...(closure ? { fillOpacity: closure.fillOpacity } : {}),
    stroke: stroke === 'none' ? (fillPaint === 'transparent' ? '#000' : fillPaint) : stroke,
    strokeWidth: width || (closure ? 3 * (1 - closure.progress) : shape.closed ? 0 : 3),
  };
}

/** SVG clamps explicit rx/ry independently, so nonsquare rounded rectangles
 * use elliptical corners once either radius reaches its axis limit. */
export function rectangleRadii(shape: Pick<ShapeElement, 'width' | 'height' | 'cornerRadius'>) {
  const radius = Math.max(0, shape.cornerRadius || 0);
  return { rx: Math.min(radius, shape.width / 2), ry: Math.min(radius, shape.height / 2) };
}
