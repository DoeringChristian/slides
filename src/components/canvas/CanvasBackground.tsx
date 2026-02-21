import React from 'react';
import { Rect } from 'react-konva';
import type { SlideBackground } from '../../types/presentation';

interface Props {
  background: SlideBackground;
  width: number;
  height: number;
}

export const CanvasBackground: React.FC<Props> = ({ background, width, height }) => {
  if (background.type === 'solid') {
    return <Rect x={0} y={0} width={width} height={height} fill={background.color} listening={false} />;
  }
  if (background.type === 'gradient') {
    return (
      <Rect
        x={0}
        y={0}
        width={width}
        height={height}
        fillLinearGradientStartPoint={{ x: 0, y: 0 }}
        fillLinearGradientEndPoint={{ x: width, y: height }}
        fillLinearGradientColorStops={[0, background.from, 1, background.to]}
        listening={false}
      />
    );
  }
  return <Rect x={0} y={0} width={width} height={height} fill="#ffffff" listening={false} />;
};
