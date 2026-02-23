import React from 'react';
import type { SlideElement, ShapeElement } from '../../types/presentation';

interface Props {
  element: SlideElement;
}

// Get the rotation origin for an element (must match Konva's behavior)
function getRotationOrigin(el: SlideElement): { x: number; y: number } {
  if (el.type === 'shape') {
    const shape = el as ShapeElement;
    if (['ellipse', 'triangle', 'star'].includes(shape.shapeType)) {
      // Center-based shapes: rotation origin is at the center
      return { x: el.x + el.width / 2, y: el.y + el.height / 2 };
    }
  }
  // For rect, text, image, line, arrow: rotation origin is at (x, y) which is top-left
  return { x: el.x, y: el.y };
}

export const SVGConnectorHighlight: React.FC<Props> = ({ element }) => {
  const rotation = element.rotation || 0;
  const origin = getRotationOrigin(element);

  // Calculate offset from rotation origin to the highlight rect's top-left corner
  const offsetX = element.x - 4 - origin.x;
  const offsetY = element.y - 4 - origin.y;

  const transform = `translate(${origin.x}, ${origin.y}) rotate(${rotation})`;

  return (
    <g transform={transform} style={{ pointerEvents: 'none' }}>
      <rect
        x={offsetX}
        y={offsetY}
        width={element.width + 8}
        height={element.height + 8}
        fill="none"
        stroke="#4285f4"
        strokeWidth={2}
        rx={4}
        ry={4}
        strokeDasharray="6 3"
      />
    </g>
  );
};
