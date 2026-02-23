import React from 'react';
import { SLIDE_WIDTH, SLIDE_HEIGHT } from '../../utils/constants';

interface Guide {
  type: 'horizontal' | 'vertical';
  position: number;
}

interface Props {
  guides: Guide[];
}

export const SVGAlignmentGuides: React.FC<Props> = ({ guides }) => {
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
          strokeWidth={1}
          strokeDasharray="4 4"
          style={{ pointerEvents: 'none' }}
        />
      ))}
    </g>
  );
};
