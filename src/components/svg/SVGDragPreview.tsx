import React, { memo } from 'react';

interface DragPreviewState {
  isDragging: boolean;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation?: number;
}

interface Props {
  preview: DragPreviewState | null;
}

export const SVGDragPreview: React.FC<Props> = memo(({ preview }) => {
  if (!preview || !preview.isDragging) return null;

  const { x, y, width, height, rotation } = preview;
  const cx = x + width / 2;
  const cy = y + height / 2;
  const transform = rotation ? `rotate(${rotation}, ${cx}, ${cy})` : undefined;

  return (
    <rect
      x={x}
      y={y}
      width={width}
      height={height}
      transform={transform}
      fill="rgba(128, 128, 128, 0.2)"
      stroke="rgba(128, 128, 128, 0.6)"
      strokeWidth={1}
      strokeDasharray="4 2"
      style={{ pointerEvents: 'none' }}
    />
  );
});
