import React from 'react';
import { Line } from 'react-konva';
import { SLIDE_WIDTH, SLIDE_HEIGHT } from '../../utils/constants';

interface Guide {
  type: 'horizontal' | 'vertical';
  position: number;
}

interface Props {
  guides: Guide[];
}

export const AlignmentGuides: React.FC<Props> = ({ guides }) => {
  return (
    <>
      {guides.map((guide, i) => (
        <Line
          key={i}
          points={
            guide.type === 'vertical'
              ? [guide.position, 0, guide.position, SLIDE_HEIGHT]
              : [0, guide.position, SLIDE_WIDTH, guide.position]
          }
          stroke="#ff4081"
          strokeWidth={1}
          dash={[4, 4]}
          listening={false}
        />
      ))}
    </>
  );
};
