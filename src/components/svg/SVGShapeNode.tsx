import React from 'react';
import type { ShapeElement } from '../../types/presentation';
import { RenderShape } from './ElementRenderer';

interface Props {
  element: ShapeElement;
  disableInteraction?: boolean;
  onMouseDown?: (e: React.MouseEvent) => void;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
  onDoubleClick?: () => void;
}

export const SVGShapeNode: React.FC<Props> = React.memo(({
  element,
  disableInteraction,
  onMouseDown,
  onMouseEnter,
  onMouseLeave,
  onDoubleClick,
}) => {
  // Rotate around the center of the element
  const cx = element.x + element.width / 2;
  const cy = element.y + element.height / 2;
  const transform = element.rotation ? `rotate(${element.rotation}, ${cx}, ${cy})` : undefined;

  const interactionStyle: React.CSSProperties = {
    cursor: disableInteraction ? 'default' : (element.locked ? 'default' : 'move'),
    pointerEvents: disableInteraction ? 'none' : 'auto',
  };

  const interactionHandlers = disableInteraction ? {} : {
    onMouseDown,
    onMouseEnter,
    onMouseLeave,
    onDoubleClick,
  };

  // Line and arrow use a different rotation center (line center, not bounding box center)
  // and need an invisible wider line for easier selection, so handle them separately
  if (element.shapeType === 'line' || element.shapeType === 'arrow') {
    const pts = element.points ?? [0, 0, element.width, 0];
    const lineCx = element.x + (pts[0] + pts[2]) / 2;
    const lineCy = element.y + (pts[1] + pts[3]) / 2;
    const lineTransform = element.rotation ? `rotate(${element.rotation}, ${lineCx}, ${lineCy})` : undefined;

    return (
      <g data-element-id={element.id}>
        {/* Visual rendering (uses bounding box center rotation - acceptable for lines) */}
        <RenderShape element={element} />
        {/* Invisible wider line for easier selection */}
        <g transform={lineTransform}>
          <line
            x1={element.x + pts[0]}
            y1={element.y + pts[1]}
            x2={element.x + pts[2]}
            y2={element.y + pts[3]}
            stroke="transparent"
            strokeWidth={20}
            style={interactionStyle}
            {...(disableInteraction ? {} : {
              onMouseDown,
              onMouseEnter,
              onMouseLeave,
            })}
          />
        </g>
      </g>
    );
  }

  // For closed shapes (rect, ellipse, triangle, star):
  // RenderShape renders the visual, transparent rect on top handles interaction
  return (
    <g data-element-id={element.id}>
      <RenderShape element={element} />
      <g transform={transform}>
        <rect
          x={element.x}
          y={element.y}
          width={element.width}
          height={element.height}
          fill="transparent"
          style={interactionStyle}
          {...interactionHandlers}
        />
      </g>
    </g>
  );
});
