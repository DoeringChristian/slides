import React from 'react';
import type { SlideElement, ShapeElement } from '../../types/presentation';
import { shapeToPathD } from '../../utils/shapeToPath';

interface Props {
  element: SlideElement;
}

/**
 * Highlight for the element a connector endpoint would bind to. Binding v2
 * resolves endpoints against the target's SILHOUETTE, so the highlight
 * traces that exact outline (via the shared `shapeToPathD` helper — same
 * geometry the renderer and the binding math use) instead of a padded
 * bounding box. Text / image targets bind to their bounding box, so they
 * keep a rect outline.
 */
export const SVGConnectorHighlight: React.FC<Props> = ({ element }) => {
  // Rotate around the center of the element (same convention as the renderer).
  const cx = element.x + element.width / 2;
  const cy = element.y + element.height / 2;
  const transform = element.rotation ? `rotate(${element.rotation}, ${cx}, ${cy})` : undefined;

  const outlineD =
    element.type === 'shape' && (element as ShapeElement).shapeType !== 'path'
      ? shapeToPathD(element as ShapeElement)
      : null;

  const strokeProps = {
    fill: 'none',
    stroke: '#4285f4',
    strokeWidth: 2,
    strokeDasharray: '6 3',
  } as const;

  return (
    <g transform={transform} style={{ pointerEvents: 'none' }}>
      {outlineD ? (
        <path d={outlineD} {...strokeProps} />
      ) : (
        <rect
          x={element.x}
          y={element.y}
          width={element.width}
          height={element.height}
          {...strokeProps}
        />
      )}
    </g>
  );
};
