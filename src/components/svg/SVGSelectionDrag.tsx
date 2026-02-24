import React from 'react';

interface SelectionDragState {
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
  isSelecting: boolean;
}

interface Props {
  selectionDrag: SelectionDragState | null;
  zoom?: number;
}

export const SVGSelectionDrag: React.FC<Props> = ({ selectionDrag, zoom = 1 }) => {
  if (!selectionDrag?.isSelecting) return null;

  const x = Math.min(selectionDrag.startX, selectionDrag.currentX);
  const y = Math.min(selectionDrag.startY, selectionDrag.currentY);
  const width = Math.abs(selectionDrag.currentX - selectionDrag.startX);
  const height = Math.abs(selectionDrag.currentY - selectionDrag.startY);

  // Scale sizes inversely with zoom to keep them constant on screen
  const strokeW = 1 / zoom;
  const dashArray = `${5 / zoom} ${5 / zoom}`;

  return (
    <rect
      x={x}
      y={y}
      width={width}
      height={height}
      fill="rgba(66, 133, 244, 0.1)"
      stroke="#4285f4"
      strokeWidth={strokeW}
      strokeDasharray={dashArray}
      style={{ pointerEvents: 'none' }}
    />
  );
};
