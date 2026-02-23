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
}

export const SVGSelectionDrag: React.FC<Props> = ({ selectionDrag }) => {
  if (!selectionDrag?.isSelecting) return null;

  const x = Math.min(selectionDrag.startX, selectionDrag.currentX);
  const y = Math.min(selectionDrag.startY, selectionDrag.currentY);
  const width = Math.abs(selectionDrag.currentX - selectionDrag.startX);
  const height = Math.abs(selectionDrag.currentY - selectionDrag.startY);

  return (
    <rect
      x={x}
      y={y}
      width={width}
      height={height}
      fill="rgba(66, 133, 244, 0.1)"
      stroke="#4285f4"
      strokeWidth={1}
      strokeDasharray="5 5"
      style={{ pointerEvents: 'none' }}
    />
  );
};
