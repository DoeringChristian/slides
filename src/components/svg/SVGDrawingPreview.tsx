import React from 'react';
import type { Tool, PathCurve } from '../../types/presentation';
import { RenderShape } from './ElementRenderer';
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
  const dashArray = `${5 / zoom} ${5 / zoom}`;

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
    case 'arrow':
      return <DraftPath
        points={[drawState.snappedStartX, drawState.snappedStartY, drawState.snappedCurrentX, drawState.snappedCurrentY]}
        curve="linear"
        endHead={tool === 'arrow' ? 'triangle' : undefined}
        zoom={zoom}
      />;
    default:
      return null;
  }
};


/** Preview uses the production path/arrow renderer, including shaft insets. */
function DraftPath({ points, curve, closed = false, endHead, zoom }: {
  points: number[]; curve: PathCurve; closed?: boolean; endHead?: 'triangle'; zoom: number;
}) {
  return <RenderShape element={{
    id: 'draft-preview', type: 'shape', shapeType: 'path',
    x: 0, y: 0, width: 1, height: 1, rotation: 0,
    opacity: 1, visible: true, locked: false,
    fill: '', stroke: '#4285f4', strokeWidth: 2 / zoom, cornerRadius: 0,
    points, curve, closed, endHead,
  }} />;
}

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
  const previewVertices = polyDraft.previewPoints ?? [...committed, polyDraft.previewX, polyDraft.previewY];
  return (
    <g style={{ pointerEvents: 'none' }}>
      <DraftPath points={previewVertices} curve={polyDraft.curve} closed={polyDraft.previewClosed} endHead={polyDraft.endHead} zoom={zoom} />
      {/* Dashed rubber-band from last committed vertex to cursor — only
          really visible for the polygon mode; the bspline shape already
          curves toward the cursor. */}
      {polyDraft.curve === 'linear' && !polyDraft.previewPoints && (
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
        const nearFirst = polyDraft.canClose !== false && isFirst && committed.length >= 6
          && committed[0] === polyDraft.previewX
          && committed[1] === polyDraft.previewY;
        return (
          <circle
            key={i}
            cx={previewVertices[2 * i]}
            cy={previewVertices[2 * i + 1]}
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

