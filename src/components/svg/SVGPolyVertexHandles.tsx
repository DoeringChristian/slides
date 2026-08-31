import React, { useState, useEffect, useCallback, useMemo } from 'react';
import type { SlideElement, ShapeElement, ConnectorBinding } from '../../types/presentation';
import { pathBounds, pathD, insetEndpoints } from '../../utils/pathShapes';
import { useScreenToSVG } from './useScreenToSVG';
import { getBindingTarget, getAnchorPoint } from '../../utils/connectorUtils';

interface Props {
  element: ShapeElement;
  /** Sibling elements on the same slide; needed so the first/last vertex
   *  can snap to other shapes' anchors and bind to them. */
  elements?: SlideElement[];
  zoom: number;
  svgRef?: React.RefObject<SVGSVGElement | null>;
  onUpdate: (attrs: Partial<ShapeElement>) => void;
  onTransformStart?: () => void;
  /** Highlight a binding-target element while the user drags over it. */
  onConnectorHighlight?: (elementId: string | null) => void;
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
  elements,
  zoom,
  svgRef,
  onUpdate,
  onTransformStart,
  onConnectorHighlight,
}) => {
  const points = useMemo(() => element.points ?? [], [element.points]);
  const n = points.length / 2;

  const [dragging, setDragging] = useState<{ idx: number } | null>(null);
  const [livePoints, setLivePoints] = useState<number[] | null>(null);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  const renderPoints = livePoints ?? points;

  const screenToSVG = useScreenToSVG(svgRef, zoom);

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
    // First / last vertices can bind to another element's anchor (matches
    // the line/arrow endpoint UX). Interior vertices just move freely.
    const lastIdx = n - 1;
    const isEndpoint = dragging.idx === 0 || dragging.idx === lastIdx;
    const onMove = (e: PointerEvent) => {
      e.preventDefault();
      const pos = screenToSVG(e.clientX, e.clientY);
      let absX = pos.x;
      let absY = pos.y;
      if (isEndpoint && elements) {
        const target = getBindingTarget({ x: absX, y: absY }, elements, element.id);
        if (target) {
          const anchor = elements.find((el) => el.id === target.elementId);
          const ap = anchor ? getAnchorPoint(anchor, target.anchor) : null;
          if (ap) { absX = ap.x; absY = ap.y; }
          onConnectorHighlight?.(target.elementId);
        } else {
          onConnectorHighlight?.(null);
        }
      }
      const localX = absX - element.x;
      const localY = absY - element.y;
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
      onConnectorHighlight?.(null);
      setLivePoints((prev) => {
        if (!prev) return prev;
        // Translate the dragged vertex from element-local to absolute slide
        // coords, then re-derive the element's (x, y, width, height) and a
        // normalized relative points list.
        const abs = prev.map((v, i) => v + (i % 2 === 0 ? element.x : element.y));
        const bounds = pathBounds(abs);
        const update: Partial<ShapeElement> = {
          x: bounds.x, y: bounds.y,
          width: bounds.width, height: bounds.height,
          points: bounds.points,
        };
        // Snap-bind the dragged endpoint if it landed on another shape's
        // anchor. The other endpoint's binding is preserved unchanged.
        if (isEndpoint && elements) {
          const lastVxIdx = bounds.points.length - 2;
          const tipX = (dragging.idx === 0 ? bounds.points[0] : bounds.points[lastVxIdx]) + bounds.x;
          const tipY = (dragging.idx === 0 ? bounds.points[1] : bounds.points[lastVxIdx + 1]) + bounds.y;
          const target = getBindingTarget({ x: tipX, y: tipY }, elements, element.id);
          const binding: ConnectorBinding | null = target ?? null;
          if (dragging.idx === 0) update.startBinding = binding;
          else update.endBinding = binding;
        }
        onUpdate(update);
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
  }, [dragging, n, element.id, element.x, element.y, elements, onUpdate, onConnectorHighlight, screenToSVG]);

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

  // Dashed preview of the path with the dragged vertex applied. Uses the
  // production pathD so curves / closed / corner-radius render exactly
  // like they will on release. The stored path (already drawn by
  // ElementRenderer with the pre-drag vertex list) stays visible
  // underneath as the "before" reference.
  const previewD = livePoints
    ? pathD(
        insetEndpoints(livePoints, !!element.startArrow, !!element.endArrow),
        element.curve ?? 'linear',
        element.closed ?? false,
        (element.curve ?? 'linear') === 'linear' ? (element.cornerRadius ?? 0) : 0,
      )
    : null;

  return (
    <g className="poly-vertex-handles">
      {previewD && (
        <path
          d={previewD}
          transform={`translate(${element.x} ${element.y})`}
          fill="none"
          stroke={COLOR}
          strokeWidth={Math.max(STROKE_W / zoom, 1)}
          strokeDasharray={`${4 / zoom} ${3 / zoom}`}
          opacity={0.8}
          style={{ pointerEvents: 'none' }}
        />
      )}
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
