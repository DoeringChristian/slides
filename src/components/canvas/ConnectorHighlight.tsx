import React from 'react';
import { Group, Rect } from 'react-konva';
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

export const ConnectorHighlight: React.FC<Props> = ({ element }) => {
  const rotation = element.rotation || 0;
  const origin = getRotationOrigin(element);

  // Calculate offset from rotation origin to the highlight rect's top-left corner
  const offsetX = element.x - 4 - origin.x;
  const offsetY = element.y - 4 - origin.y;

  return (
    <Group
      x={origin.x}
      y={origin.y}
      rotation={rotation}
      listening={false}
    >
      <Rect
        x={offsetX}
        y={offsetY}
        width={element.width + 8}
        height={element.height + 8}
        stroke="#4285f4"
        strokeWidth={2}
        cornerRadius={4}
        dash={[6, 3]}
        listening={false}
      />
    </Group>
  );
};
