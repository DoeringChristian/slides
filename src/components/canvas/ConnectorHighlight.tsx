import React from 'react';
import { Rect } from 'react-konva';
import type { SlideElement } from '../../types/presentation';

interface Props {
  element: SlideElement;
}

export const ConnectorHighlight: React.FC<Props> = ({ element }) => {
  return (
    <Rect
      x={element.x - 4}
      y={element.y - 4}
      width={element.width + 8}
      height={element.height + 8}
      stroke="#4285f4"
      strokeWidth={2}
      cornerRadius={4}
      dash={[6, 3]}
      listening={false}
    />
  );
};
