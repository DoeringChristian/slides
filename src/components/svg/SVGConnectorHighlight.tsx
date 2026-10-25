import React from 'react';
import type { SlideElement, ShapeElement } from '../../types/presentation';
import { bindingAimPoint, type ConnectorDockCue } from '../../utils/connectorUtils';
import { shapeToPathD } from '../../utils/shapeToPath';

interface Props {
  element: SlideElement;
  zoom: number;
  dock?: ConnectorDockCue | null;
}

/**
 * Highlight for the element a connector endpoint would bind to. Binding v2
 * resolves endpoints against the target's SILHOUETTE, so the highlight
 * traces that exact outline (via the shared `shapeToPathD` helper — same
 * geometry the renderer and the binding math use) instead of a padded
 * bounding box. Text / image targets bind to their bounding box, so they
 * keep a rect outline.
 */
export const SVGConnectorHighlight: React.FC<Props> = ({ element, zoom, dock }) => {
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
    stroke: '#6abdfc',
    strokeWidth: Math.max(element.type === 'shape' ? Math.min(element.strokeWidth, 4) : 0, 1.75) / Math.max(.25, zoom),
  } as const;

  const dockPoint = dock ? bindingAimPoint(dock.binding, element) : null;
  return (
    <g data-connector-highlight={element.id} style={{ pointerEvents: 'none' }}>
    <g transform={transform}>
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
    {dockPoint && <circle data-connector-dock={dock!.active ? 'active' : 'near'} cx={dockPoint.x} cy={dockPoint.y} r={4 / zoom} fill={dock!.active ? '#6abdfc' : 'rgba(65,65,65,.5)'} />}
    </g>
  );
};
