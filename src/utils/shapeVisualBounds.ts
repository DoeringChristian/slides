import type { ShapeElement, SlideElement } from '../types/presentation';
import { useLayoutEffect, useState } from 'react';
import type { BoundingBox } from './geometry';
import { shapeToPathD } from './shapeToPath';
import { resolveShapeGeometry } from './vectorGeometry';

/** Editor-only measurement of the SAME geometry drawn by shared renderers.
 * In particular triangle/star use an inscribed circle, not the stored box;
 * vector design boxes include Lucide's intentional whitespace. No new shape
 * definitions or sampled/approximate outline bounds are introduced here. */
export function shapeVisualBounds(shape: ShapeElement): BoundingBox {
  const fallback = { x: shape.x, y: shape.y, width: shape.width, height: shape.height };
  if (typeof document === 'undefined') return fallback;
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  const path = document.createElementNS(svg.namespaceURI, 'path') as SVGPathElement;
  const geometry = shape.shapeType === 'vector' ? resolveShapeGeometry(shape) : null;
  path.setAttribute('d', geometry ? [...geometry.strokes, ...geometry.fills.map(f => f.d)].join(' ') : shapeToPathD(shape));
  svg.style.cssText = 'position:fixed;visibility:hidden;pointer-events:none;width:0;height:0';
  svg.append(path); document.body.append(svg);
  try {
    const b = path.getBBox();
    return { x: b.x, y: b.y, width: b.width, height: b.height };
  } finally { svg.remove(); }
}

/** Unrotated renderer coordinates; all editor consumers rotate about the stored
 * renderer pivot, never about the measured (possibly off-box) geometry center. */
export function elementVisualBounds(element: SlideElement): BoundingBox {
  return element.type === 'shape' ? shapeVisualBounds(element)
    : { x: element.x, y: element.y, width: element.width, height: element.height };
}

export function useElementVisualBounds(element: SlideElement | null): BoundingBox | null {
  const [measurement, setMeasurement] = useState<{ element: SlideElement; bounds: BoundingBox } | null>(null);
  useLayoutEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- measure shared renderer geometry after DOM layout
    setMeasurement(element ? { element, bounds: elementVisualBounds(element) } : null);
  }, [element]);
  return measurement?.element === element ? measurement?.bounds ?? null : element;
}

/** Screen-space widget envelope, separate from actual geometry. Reserve the
 * largest native pointer acquisition radius (touch), including path corners. */
export function selectionControlMetrics(element: SlideElement | null, zoom: number) {
  return {
    padding: (element?.type === 'image' ? 0 : 4) / zoom,
    pathCornerOffset: (element?.type === 'shape' && element.shapeType === 'path' ? 8 : 0) / zoom,
    cornerTouchRadius: 14 / zoom,
    actionClearance: 4 / zoom,
  };
}
