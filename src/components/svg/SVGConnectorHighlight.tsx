import React from 'react';
import type { SlideElement } from '../../types/presentation';

interface Props {
  element: SlideElement;
}

export const SVGConnectorHighlight: React.FC<Props> = ({ element }) => {
  // Rotate around the center of the element
  const cx = element.x + element.width / 2;
  const cy = element.y + element.height / 2;
  const transform = element.rotation ? `rotate(${element.rotation}, ${cx}, ${cy})` : undefined;

  return (
    <g transform={transform} style={{ pointerEvents: 'none' }}>
      <rect
        x={element.x - 4}
        y={element.y - 4}
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
