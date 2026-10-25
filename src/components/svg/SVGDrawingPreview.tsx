import React from 'react';
import type { BindingAimGuide } from '../../utils/connectorUtils';
import { CONTROL_THEME } from './controlTheme';
import type { Tool, PathCurve } from '../../types/presentation';
import { composeUserShape, creationBox } from '../../utils/userShapeCreation';
import { useCreationPreferences } from '../../store/creationPreferences';
import { useEditorStore } from '../../store/editorStore';
import { pathBoundsFor } from '../../utils/pathShapes';
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
  preserveAspect?: boolean;
  aimGuides?: BindingAimGuide[];
}

interface Props {
  drawState: DrawState;
  tool: Tool;
  zoom?: number;
}

export const SVGDrawingPreview: React.FC<Props> = ({ drawState, tool, zoom = 1 }) => {
  useCreationPreferences(s => s.styles);
  useCreationPreferences(s => s.iconId);
  if (!drawState.isDrawing) return null;

  // Use snapped positions for the preview
  const { x, y, width, height } = creationBox(tool, drawState.snappedStartX, drawState.snappedStartY, drawState.snappedCurrentX, drawState.snappedCurrentY, drawState.preserveAspect);

  // Scale sizes inversely with zoom to keep them constant on screen
  const strokeW = 1 / zoom;
  const dashArray = `${5 / zoom} ${5 / zoom}`;

  const commonStyle: React.CSSProperties = { pointerEvents: 'none' };

  switch (tool) {
    case 'text':
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
    case 'rect':
    case 'ellipse':
    case 'triangle':
    case 'star':
    case 'icon':
      return <RenderShape element={composeUserShape(tool, { id: 'draft-preview', x, y, width, height })} />;
    case 'line':
    case 'arrow':
      return <><BindingAimIndicators guides={drawState.aimGuides} zoom={zoom} /><DraftPath
        points={[drawState.snappedStartX, drawState.snappedStartY, drawState.snappedCurrentX, drawState.snappedCurrentY]}
      /></>;
    default:
      return null;
  }
};


/** Preview uses the production path/arrow renderer, including shaft insets. */
function DraftPath({ points, curve, closed, endHead }: {
  points: number[]; curve?: PathCurve; closed?: boolean; endHead?: 'triangle';
}) {
  useCreationPreferences(s => s.styles);
  const activeTool = useEditorStore(s => s.tool);
  const tool = ['line', 'arrow', 'polygon', 'bspline'].includes(activeTool) ? activeTool : endHead ? 'arrow' : curve && curve !== 'linear' ? 'bspline' : 'line';
  const preset = composeUserShape(tool, { points });
  const mode = curve ?? preset.curve ?? 'linear';
  const isClosed = closed || !!preset.closed;
  return <RenderShape element={composeUserShape(tool, {
    id: 'draft-preview', ...pathBoundsFor(points, mode, isClosed), curve: mode, closed: isClosed,
    ...(endHead ? { endHead } : {}),
  })} />;
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
      {polyDraft.previewElement ? <RenderShape element={polyDraft.previewElement} />
        : <DraftPath points={previewVertices} curve={polyDraft.curve} closed={polyDraft.previewClosed} endHead={polyDraft.endHead} />}
      <BindingAimIndicators guides={polyDraft.aimGuides} zoom={zoom} />
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


function BindingAimIndicators({ guides, zoom }: { guides?: BindingAimGuide[]; zoom: number }) {
  return <g pointerEvents="none" data-draft-aim="true">{guides?.map(({ endpoint, focus }, i) => <g key={i}>
    <line x1={endpoint.x} y1={endpoint.y} x2={focus.x} y2={focus.y} stroke={CONTROL_THEME.color} strokeWidth={1 / zoom} strokeDasharray={`${4 / zoom} ${4 / zoom}`} />
    <circle cx={focus.x} cy={focus.y} r={4 / zoom} fill="white" stroke={CONTROL_THEME.color} strokeWidth={1 / zoom} />
  </g>)}</g>;
}
