import React, { memo } from 'react';

export interface DragPreviewState {
  isDragging: boolean;
  elementType: 'rect' | 'line';
  // For rect-like elements (text, image, shape)
  x: number;
  y: number;
  width: number;
  height: number;
  rotation?: number;
  // For line/arrow elements
  points?: number[]; // [x1, y1, x2, y2] relative to x, y
}

interface Props {
  preview: DragPreviewState | null;
}

const STROKE_COLOR = 'rgba(100, 100, 100, 0.8)';
const FILL_COLOR = 'rgba(128, 128, 128, 0.15)';

export const SVGDragPreview: React.FC<Props> = memo(({ preview }) => {
  if (!preview || !preview.isDragging) return null;

  const { elementType, x, y, width, height, rotation, points } = preview;

  // Line/arrow preview
  if (elementType === 'line' && points) {
    const cx = x + width / 2;
    const cy = y + height / 2;
    const transform = rotation ? `rotate(${rotation}, ${cx}, ${cy})` : undefined;

    return (
      <g transform={transform} style={{ pointerEvents: 'none' }}>
        <line
          x1={x + points[0]}
          y1={y + points[1]}
          x2={x + points[2]}
          y2={y + points[3]}
          stroke={STROKE_COLOR}
          strokeWidth={2}
          strokeDasharray="6 3"
        />
      </g>
    );
  }

  // Rectangle preview for shapes, text, images
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
      fill={FILL_COLOR}
      stroke={STROKE_COLOR}
      strokeWidth={1.5}
      strokeDasharray="6 3"
      style={{ pointerEvents: 'none' }}
    />
  );
});
