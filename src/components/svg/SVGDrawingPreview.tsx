import React from 'react';
import type { Tool } from '../../types/presentation';
import { pathD } from '../../utils/pathShapes';
import type { PolyDraftState } from './useSVGDrawing';

interface DrawState {
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
  isDrawing: boolean;
  snappedStartX: number;
  snappedStartY: number;
  snappedCurrentX: number;
  snappedCurrentY: number;
}

interface Props {
  drawState: DrawState;
  tool: Tool;
  zoom?: number;
}

export const SVGDrawingPreview: React.FC<Props> = ({ drawState, tool, zoom = 1 }) => {
  if (!drawState.isDrawing) return null;

  // Use snapped positions for the preview
  const x = Math.min(drawState.snappedStartX, drawState.snappedCurrentX);
  const y = Math.min(drawState.snappedStartY, drawState.snappedCurrentY);
  const width = Math.abs(drawState.snappedCurrentX - drawState.snappedStartX);
  const height = Math.abs(drawState.snappedCurrentY - drawState.snappedStartY);

  // Scale sizes inversely with zoom to keep them constant on screen
  const strokeW = 1 / zoom;
  const lineStrokeW = 2 / zoom;
  const dashArray = `${5 / zoom} ${5 / zoom}`;
  const headLength = 10 / zoom;
  const headWidth = 10 / zoom;

  const commonStyle: React.CSSProperties = { pointerEvents: 'none' };

  switch (tool) {
    case 'rect':
    case 'text':
    case 'triangle':
    case 'star':
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
          style={commonStyle}
        />
      );
    case 'ellipse':
      return (
        <ellipse
          cx={x + width / 2}
          cy={y + height / 2}
          rx={width / 2}
          ry={height / 2}
          fill="rgba(66, 133, 244, 0.1)"
          stroke="#4285f4"
          strokeWidth={strokeW}
          strokeDasharray={dashArray}
          style={commonStyle}
        />
      );
    case 'line':
      return (
        <line
          x1={drawState.snappedStartX}
          y1={drawState.snappedStartY}
          x2={drawState.snappedCurrentX}
          y2={drawState.snappedCurrentY}
          stroke="#4285f4"
          strokeWidth={lineStrokeW}
          strokeDasharray={dashArray}
          style={commonStyle}
        />
      );
    case 'arrow': {
      // Draw line with arrowhead
      const dx = drawState.snappedCurrentX - drawState.snappedStartX;
      const dy = drawState.snappedCurrentY - drawState.snappedStartY;
      const angle = Math.atan2(dy, dx);

      const tip = { x: drawState.snappedCurrentX, y: drawState.snappedCurrentY };
      const left = {
        x: tip.x - headLength * Math.cos(angle) + headWidth / 2 * Math.sin(angle),
        y: tip.y - headLength * Math.sin(angle) - headWidth / 2 * Math.cos(angle),
      };
      const right = {
        x: tip.x - headLength * Math.cos(angle) - headWidth / 2 * Math.sin(angle),
        y: tip.y - headLength * Math.sin(angle) + headWidth / 2 * Math.cos(angle),
      };

      return (
        <g style={commonStyle}>
          <line
            x1={drawState.snappedStartX}
            y1={drawState.snappedStartY}
            x2={drawState.snappedCurrentX}
            y2={drawState.snappedCurrentY}
            stroke="#4285f4"
            strokeWidth={lineStrokeW}
            strokeDasharray={dashArray}
          />
          <polygon
            points={`${tip.x},${tip.y} ${left.x},${left.y} ${right.x},${right.y}`}
            fill="#4285f4"
          />
        </g>
      );
    }
    default:
      return null;
  }
};


interface PolyPreviewProps {
  polyDraft: PolyDraftState | null;
  zoom?: number;
}

/** Preview for an in-progress polygon / bspline draft: the committed
 *  vertices rendered as their final shape, with a dashed rubber-band line
 *  from the last vertex to the cursor. */
export const SVGPolyDraftPreview: React.FC<PolyPreviewProps> = ({ polyDraft, zoom = 1 }) => {
  if (!polyDraft || polyDraft.vertices.length < 2) return null;
  const strokeW = 2 / zoom;
  const dashArray = `${5 / zoom} ${5 / zoom}`;
  const handleR = 4 / zoom;
  // Already-committed vertices.
  const committed = polyDraft.vertices;
  const lastX = committed[committed.length - 2];
  const lastY = committed[committed.length - 1];
  // Preview path includes a virtual vertex at the cursor so the user sees
  // exactly how the next click will land.
  const previewVertices = [...committed, polyDraft.previewX, polyDraft.previewY];
  const d = pathD(previewVertices, polyDraft.curve, false);
  return (
    <g style={{ pointerEvents: 'none' }}>
      <path d={d} stroke="#4285f4" strokeWidth={strokeW} fill="none" strokeLinecap="round" strokeLinejoin="round" />
      {/* Dashed rubber-band from last committed vertex to cursor — only
          really visible for the polygon mode; the bspline shape already
          curves toward the cursor. */}
      {polyDraft.curve === 'linear' && (
        <line
          x1={lastX}
          y1={lastY}
          x2={polyDraft.previewX}
          y2={polyDraft.previewY}
          stroke="#4285f4"
          strokeWidth={strokeW}
          strokeDasharray={dashArray}
        />
      )}
      {/* Vertex markers. The first one grows when the cursor is over it so
          the user sees that clicking will close the path. */}
      {Array.from({ length: committed.length / 2 }, (_, i) => {
        const isFirst = i === 0;
        const nearFirst = isFirst && committed.length >= 6
          && committed[0] === polyDraft.previewX
          && committed[1] === polyDraft.previewY;
        return (
          <circle
            key={i}
            cx={committed[2 * i]}
            cy={committed[2 * i + 1]}
            r={nearFirst ? handleR * 1.8 : handleR}
            fill={nearFirst ? '#4285f4' : '#fff'}
            stroke="#4285f4"
            strokeWidth={strokeW}
          />
        );
      })}
    </g>
  );
};

