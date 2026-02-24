import React from 'react';
import { SLIDE_WIDTH, SLIDE_HEIGHT } from '../../utils/constants';

interface Guide {
  type: 'horizontal' | 'vertical';
  position: number;
}

interface Props {
  guides: Guide[];
  zoom?: number;
}

export const SVGAlignmentGuides: React.FC<Props> = ({ guides, zoom = 1 }) => {
  // Scale sizes inversely with zoom to keep them constant on screen
  const strokeW = 1 / zoom;
  const dashArray = `${4 / zoom} ${4 / zoom}`;

  return (
    <g className="alignment-guides">
      {guides.map((guide, i) => (
        <line
          key={i}
          x1={guide.type === 'vertical' ? guide.position : 0}
          y1={guide.type === 'vertical' ? 0 : guide.position}
          x2={guide.type === 'vertical' ? guide.position : SLIDE_WIDTH}
          y2={guide.type === 'vertical' ? SLIDE_HEIGHT : guide.position}
          stroke="#ff4081"
          strokeWidth={strokeW}
          strokeDasharray={dashArray}
          style={{ pointerEvents: 'none' }}
        />
      ))}
    </g>
  );
};
