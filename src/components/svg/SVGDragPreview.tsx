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
  // Cursor position in SVG coords (for rotation label)
  cursorX?: number;
  cursorY?: number;
  // For line/arrow elements
  points?: number[]; // [x1, y1, x2, y2] relative to x, y
}

interface Props {
  preview: DragPreviewState | DragPreviewState[] | null;
  zoom?: number;
}

const STROKE_COLOR = 'rgba(100, 100, 100, 0.8)';
const FILL_COLOR = 'rgba(128, 128, 128, 0.15)';

const SinglePreview: React.FC<{ preview: DragPreviewState; zoom: number }> = memo(({ preview, zoom }) => {
  const { elementType, x, y, width, height, rotation, points } = preview;

  // Scale sizes inversely with zoom to keep them constant on screen
  const strokeW = 1.5 / zoom;
  const lineStrokeW = 2 / zoom;
  const dashArray = `${6 / zoom} ${3 / zoom}`;

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
          strokeWidth={lineStrokeW}
          strokeDasharray={dashArray}
        />
      </g>
    );
  }

  // Rectangle preview for shapes, text, images
  const cx = x + width / 2;
  const cy = y + height / 2;
  const transform = rotation ? `rotate(${rotation}, ${cx}, ${cy})` : undefined;
  const fontSize = 12 / zoom;

  return (
    <g style={{ pointerEvents: 'none' }}>
      <rect
        x={x}
        y={y}
        width={width}
        height={height}
        transform={transform}
        fill={FILL_COLOR}
        stroke={STROKE_COLOR}
        strokeWidth={strokeW}
        strokeDasharray={dashArray}
      />
      {rotation !== undefined && rotation !== 0 && preview.cursorX !== undefined && preview.cursorY !== undefined && (
        <text
          x={preview.cursorX + 16 / zoom}
          y={preview.cursorY - 16 / zoom}
          textAnchor="start"
          dominantBaseline="auto"
          fill={STROKE_COLOR}
          fontSize={fontSize}
          fontFamily="system-ui, sans-serif"
          style={{ userSelect: 'none' }}
        >
          {`${Math.round(rotation)}°`}
        </text>
      )}
    </g>
  );
});

export const SVGDragPreview: React.FC<Props> = memo(({ preview, zoom = 1 }) => {
  if (!preview) return null;

  // Handle array of previews
  if (Array.isArray(preview)) {
    const activePreviews = preview.filter(p => p.isDragging);
    if (activePreviews.length === 0) return null;
    return (
      <g>
        {activePreviews.map((p, i) => (
          <SinglePreview key={i} preview={p} zoom={zoom} />
        ))}
      </g>
    );
  }

  // Single preview (backwards compatible)
  if (!preview.isDragging) return null;
  return <SinglePreview preview={preview} zoom={zoom} />;
});
