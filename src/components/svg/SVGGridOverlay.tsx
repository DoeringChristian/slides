import React from 'react';
import { SLIDE_WIDTH, SLIDE_HEIGHT } from '../../utils/constants';

interface Props {
  gridSize: number;
  visible: boolean;
  zoom?: number;
}

export const SVGGridOverlay: React.FC<Props> = ({ gridSize, visible, zoom = 1 }) => {
  if (!visible) return null;

  // Scale stroke width inversely with zoom to keep it constant on screen
  const strokeW = 0.5 / zoom;

  const lines: React.ReactNode[] = [];

  // Vertical lines
  for (let i = gridSize; i < SLIDE_WIDTH; i += gridSize) {
    lines.push(
      <line
        key={`v${i}`}
        x1={i}
        y1={0}
        x2={i}
        y2={SLIDE_HEIGHT}
        stroke="#ddd"
        strokeWidth={strokeW}
        style={{ pointerEvents: 'none' }}
      />
    );
  }

  // Horizontal lines
  for (let i = gridSize; i < SLIDE_HEIGHT; i += gridSize) {
    lines.push(
      <line
        key={`h${i}`}
        x1={0}
        y1={i}
        x2={SLIDE_WIDTH}
        y2={i}
        stroke="#ddd"
        strokeWidth={strokeW}
        style={{ pointerEvents: 'none' }}
      />
    );
  }

  return <g className="grid-overlay">{lines}</g>;
};
