import React, { useState, useEffect, useCallback } from 'react';
import type { ShapeElement } from '../../types/presentation';
import { CANVAS_PADDING } from '../../utils/constants';
import { pathBounds } from '../../utils/pathShapes';

interface Props {
  element: ShapeElement;
  zoom: number;
  svgRef?: React.RefObject<SVGSVGElement | null>;
  onUpdate: (attrs: Partial<ShapeElement>) => void;
  onTransformStart?: () => void;
}

const HANDLE_R = 5;
const STROKE_W = 2;
const COLOR = '#4285f4';

/**
 * Vertex-edit handles for polygon / bspline shapes.
 *
 *  * Drag a circle → moves that vertex; bounds recomputed on commit.
 *  * Alt+click on a segment between two handles → inserts a new vertex at
 *    the click point.
 *  * Backspace / Delete while hovering a handle → removes that vertex
 *    (provided ≥3 remain).
 */
export const SVGPolyVertexHandles: React.FC<Props> = ({
  element,
  zoom,
  svgRef,
  onUpdate,
  onTransformStart,
}) => {
  const points = element.points ?? [];
  const n = points.length / 2;

  const [dragging, setDragging] = useState<{ idx: number } | null>(null);
  const [livePoints, setLivePoints] = useState<number[] | null>(null);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  const renderPoints = livePoints ?? points;

  const screenToSVG = useCallback((clientX: number, clientY: number) => {
    if (!svgRef?.current) {
      return { x: clientX / zoom - CANVAS_PADDING, y: clientY / zoom - CANVAS_PADDING };
    }
    const rect = svgRef.current.getBoundingClientRect();
    return {
      x: (clientX - rect.left) / zoom - CANVAS_PADDING,
      y: (clientY - rect.top) / zoom - CANVAS_PADDING,
    };
  }, [svgRef, zoom]);

  const beginDrag = useCallback((idx: number, e: React.PointerEvent) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    try { (e.currentTarget as Element).setPointerCapture(e.pointerId); } catch { /* */ }
    onTransformStart?.();
    setDragging({ idx });
    setLivePoints(points.slice());
  }, [points, onTransformStart]);

  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: PointerEvent) => {
      e.preventDefault();
      const pos = screenToSVG(e.clientX, e.clientY);
      // Drag target in absolute slide coords, store as RELATIVE to element.x/y.
      const localX = pos.x - element.x;
      const localY = pos.y - element.y;
      setLivePoints((prev) => {
        if (!prev) return prev;
        const out = prev.slice();
        out[2 * dragging.idx] = localX;
        out[2 * dragging.idx + 1] = localY;
        return out;
      });
    };
    const onUp = (e: PointerEvent) => {
      e.preventDefault();
      setDragging(null);
      setLivePoints((prev) => {
        if (!prev) return prev;
        // Translate the dragged vertex from element-local to absolute slide
        // coords, then re-derive the element's (x, y, width, height) and a
        // normalized relative points list.
        const abs = prev.map((v, i) => v + (i % 2 === 0 ? element.x : element.y));
        const bounds = pathBounds(abs);
        onUpdate({ x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height, points: bounds.points });
        return null;
      });
    };
    window.addEventListener('pointermove', onMove, { passive: false });
    window.addEventListener('pointerup', onUp, { passive: false });
    window.addEventListener('pointercancel', onUp, { passive: false });
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  }, [dragging, element.x, element.y, onUpdate, screenToSVG]);

  // Delete the hovered vertex on Backspace / Delete. Keep ≥3 vertices so the
  // shape doesn't degenerate.
  useEffect(() => {
    if (hoverIdx === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Backspace' && e.key !== 'Delete') return;
      if (n <= 3) return;
      e.preventDefault();
      e.stopPropagation();
      const newRel = points.slice();
      newRel.splice(2 * hoverIdx, 2);
      const abs = newRel.map((v, i) => v + (i % 2 === 0 ? element.x : element.y));
      const bounds = pathBounds(abs);
      onUpdate({ x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height, points: bounds.points });
      setHoverIdx(null);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [hoverIdx, n, points, element.x, element.y, onUpdate]);

  // Alt+click on a segment inserts a new vertex at the click point.
  const insertOnSegment = useCallback((segIdx: number, e: React.PointerEvent) => {
    if (!e.altKey) return;
    e.preventDefault();
    e.stopPropagation();
    const pos = screenToSVG(e.clientX, e.clientY);
    const localX = pos.x - element.x;
    const localY = pos.y - element.y;
    const newRel = points.slice();
    newRel.splice(2 * (segIdx + 1), 0, localX, localY);
    const abs = newRel.map((v, i) => v + (i % 2 === 0 ? element.x : element.y));
    const bounds = pathBounds(abs);
    onUpdate({ x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height, points: bounds.points });
  }, [points, element.x, element.y, onUpdate, screenToSVG]);

  const r = HANDLE_R / zoom;
  const strokeW = STROKE_W / zoom;
  const closed = element.closed ?? false;

  return (
    <g className="poly-vertex-handles">
      {/* Invisible alt-click strips along each segment, on top of the path. */}
      {Array.from({ length: closed ? n : n - 1 }, (_, segIdx) => {
        const a = segIdx;
        const b = (segIdx + 1) % n;
        const x1 = element.x + renderPoints[2 * a];
        const y1 = element.y + renderPoints[2 * a + 1];
        const x2 = element.x + renderPoints[2 * b];
        const y2 = element.y + renderPoints[2 * b + 1];
        return (
          <line
            key={`seg-${segIdx}`}
            x1={x1} y1={y1} x2={x2} y2={y2}
            stroke="transparent"
            strokeWidth={Math.max(8 / zoom, 4)}
            style={{ cursor: 'copy', pointerEvents: 'stroke' }}
            onPointerDown={(e) => insertOnSegment(segIdx, e)}
          />
        );
      })}
      {/* Vertex handles. */}
      {Array.from({ length: n }, (_, i) => {
        const cx = element.x + renderPoints[2 * i];
        const cy = element.y + renderPoints[2 * i + 1];
        return (
          <circle
            key={i}
            cx={cx}
            cy={cy}
            r={r}
            fill="#fff"
            stroke={COLOR}
            strokeWidth={strokeW}
            style={{ cursor: 'move' }}
            onPointerDown={(e) => beginDrag(i, e)}
            onPointerEnter={() => setHoverIdx(i)}
            onPointerLeave={() => setHoverIdx((prev) => (prev === i ? null : prev))}
          />
        );
      })}
    </g>
  );
};
