import React from 'react';
import { Line } from 'react-konva';
import { SLIDE_WIDTH, SLIDE_HEIGHT } from '../../utils/constants';

interface Props {
  gridSize: number;
  visible: boolean;
}

export const GridOverlay: React.FC<Props> = ({ gridSize, visible }) => {
  if (!visible) return null;

  const lines = [];
  for (let i = gridSize; i < SLIDE_WIDTH; i += gridSize) {
    lines.push(
      <Line key={`v${i}`} points={[i, 0, i, SLIDE_HEIGHT]} stroke="#ddd" strokeWidth={0.5} listening={false} />
    );
  }
  for (let i = gridSize; i < SLIDE_HEIGHT; i += gridSize) {
    lines.push(
      <Line key={`h${i}`} points={[0, i, SLIDE_WIDTH, i]} stroke="#ddd" strokeWidth={0.5} listening={false} />
    );
  }

  return <>{lines}</>;
};
