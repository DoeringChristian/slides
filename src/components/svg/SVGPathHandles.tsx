import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import type { SlideElement, ShapeElement, ConnectorBinding } from '../../types/presentation';
import {
  pathD,
  sampledPath,
  insetEndpoints,
  pathBoundsFor,
  catmullTangents,
} from '../../utils/pathShapes';
import { isCtrlHeld, isShiftHeld } from '../../utils/keyboard';
import { constrainToAngle } from '../../utils/geometry';
import { useEditorStore } from '../../store/editorStore';
import { computePointSnap, type Guide } from '../../hooks/useAlignmentGuides';
import { getMarginLayout, getMarginBounds } from '../../utils/marginLayouts';
import { getBindingTarget2, bindingFor, resolveBinding } from '../../utils/connectorUtils';
import { useScreenToSVG } from './useScreenToSVG';

interface Props {
  element: ShapeElement;
  /** Sibling elements on the same slide; needed so endpoint vertices can
   *  snap to other shapes and bind to them. */
  elements?: SlideElement[];
  zoom: number;
  svgRef?: React.RefObject<SVGSVGElement | null>;
  onUpdate: (attrs: Partial<ShapeElement>) => void;
  onTransformStart?: () => void;
  /** Alignment guides while an endpoint vertex snaps to siblings. */
  onGuidesChange?: (guides: Guide[]) => void;
  /** Highlight a binding-target element while the user drags over it. */
  onConnectorHighlight?: (elementId: string | null) => void;
}

const HANDLE_R = 5;
const ENDPOINT_R = 6;
const STROKE_W = 2;
const COLOR = '#4285f4';
/** Hit radius for midpoint dots and vertex handles (screen px / zoom). */
const HIT_R = 12;

type Drag =
  | { kind: 'vertex'; idx: number }
  | { kind: 'tangent'; idx: number; which: 'in' | 'out' };

interface Segment {
  /** Sampled sub-polyline of this visual segment, element-relative flat coords. */
  sub: number[];
  /** Arc-length midpoint of `sub` (element-relative). */
  midX: number;
  midY: number;
}

/**
 * Unified edit handles for ANY sole-selected path shape — 2-point lines are
 * just degenerate polys. Union of the former SVGLineEndpointHandles +
 * SVGPolyVertexHandles feature sets:
 *
 *  * Drag a vertex handle → moves that vertex (bounds recomputed on commit).
 *    Endpoint vertices of OPEN paths additionally get the full line/arrow
 *    feature set: alignment guides, Ctrl angle-constrain against the
 *    adjacent vertex, and edge-mode connector binding (silhouette preview +
 *    target highlight via getBindingTarget2/bindingFor/resolveBinding).
 *    Interior vertices move freely.
 *  * Translucent midpoint dot per visual segment, at the ARC-LENGTH midpoint
 *    of that segment's SAMPLED sub-polyline (on-curve for B-splines and
 *    béziers). Pointer-down materializes a real vertex there and continues
 *    as a vertex drag in the same gesture.
 *  * Alt+click on a segment (hit strips hug the sampled curve) inserts a
 *    vertex at the click point.
 *  * Backspace / Delete while hovering a vertex removes it (≥3 vertices kept
 *    for closed paths, ≥2 overall).
 *  * Bézier paths: the active (hovered / last-dragged) vertex shows its two
 *    tangent handles; dragging one updates that tangent and mirrors the
 *    opposite one unless Alt is held (break symmetry). Tangents are
 *    vertex-relative, so they ride along when their vertex is dragged.
 *
 * Commits follow the ref pattern: pointerup reads the final geometry from
 * refs and calls onUpdate OUTSIDE any setState updater (React 19 StrictMode
 * double-invokes updaters, which would double the store write).
 */
export const SVGPathHandles: React.FC<Props> = ({
  element,
  elements,
  zoom,
  svgRef,
  onUpdate,
  onTransformStart,
  onGuidesChange,
  onConnectorHighlight,
}) => {
  const points = useMemo(() => element.points ?? [], [element.points]);
  const n = points.length / 2;
  const closed = element.closed ?? false;
  const curve = element.curve ?? 'linear';
  const isBezier = curve === 'bezier';

  // Tangents the path currently renders with (stored, or Catmull-Rom
  // defaults for a bare bezier conversion) — editing starts from these.
  const baseTangents = useMemo(() => {
    if (!isBezier) return undefined;
    return element.tangents && element.tangents.length === points.length * 2
      ? element.tangents
      : catmullTangents(points, closed);
  }, [isBezier, element.tangents, points, closed]);

  const [dragging, setDragging] = useState<Drag | null>(null);
  const [livePoints, setLivePoints] = useState<number[] | null>(null);
  const [liveTangents, setLiveTangents] = useState<number[] | null>(null);
  // Ref mirrors: the commit on pointerup must read the final geometry and
  // call onUpdate OUTSIDE any setState updater (see component docs).
  const livePointsRef = useRef<number[] | null>(null);
  const liveTangentsRef = useRef<number[] | null>(null);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  // Vertex whose bezier tangent handles are shown. Sticky (survives hover
  // leaving the vertex) so the pointer can travel to the handle itself.
  const [activeIdx, setActiveIdx] = useState<number | null>(null);

  const renderPoints = livePoints ?? points;
  const renderTangents = liveTangents ?? baseTangents;

  const screenToSVG = useScreenToSVG(svgRef, zoom);

  // ---------------------------------------------------------------------------
  // Visual segments: sampled sub-polylines + arc-length midpoints. Segment
  // boundaries are the samples nearest each vertex (exact for linear and
  // bezier where vertices ARE samples; closest-approach for B-splines whose
  // curve doesn't pass through its control points).
  // ---------------------------------------------------------------------------
  const segments = useMemo<Segment[]>(() => {
    if (n < 2) return [];
    const samples = sampledPath(renderPoints, curve, closed, renderTangents ?? undefined);
    if (samples.length < 4) return [];
    const walk = closed ? [...samples, samples[0], samples[1]] : samples;
    const M = walk.length / 2;
    const bounds: number[] = [0];
    let cursor = 0;
    for (let v = 1; v < n; v++) {
      const vx = renderPoints[2 * v];
      const vy = renderPoints[2 * v + 1];
      let best = Math.min(cursor + 1, M - 1);
      let bestD = Infinity;
      for (let s = cursor; s < M; s++) {
        const dx = walk[2 * s] - vx;
        const dy = walk[2 * s + 1] - vy;
        const d = dx * dx + dy * dy;
        if (d < bestD) {
          bestD = d;
          best = s;
        }
      }
      bounds.push(best);
      cursor = best;
    }
    if (closed) bounds.push(M - 1);
    const out: Segment[] = [];
    for (let s = 0; s < bounds.length - 1; s++) {
      const a = bounds[s];
      const b = Math.max(bounds[s + 1], Math.min(a + 1, M - 1));
      const sub = walk.slice(2 * a, 2 * b + 2);
      // Arc-length midpoint of the sub-polyline.
      let total = 0;
      for (let i = 0; i + 3 < sub.length; i += 2) {
        total += Math.hypot(sub[i + 2] - sub[i], sub[i + 3] - sub[i + 1]);
      }
      let midX = sub[0];
      let midY = sub[1];
      let acc = 0;
      const half = total / 2;
      for (let i = 0; i + 3 < sub.length; i += 2) {
        const segLen = Math.hypot(sub[i + 2] - sub[i], sub[i + 3] - sub[i + 1]);
        if (acc + segLen >= half) {
          const f = segLen > 0 ? (half - acc) / segLen : 0;
          midX = sub[i] + (sub[i + 2] - sub[i]) * f;
          midY = sub[i + 1] + (sub[i + 3] - sub[i + 1]) * f;
          break;
        }
        acc += segLen;
      }
      out.push({ sub, midX, midY });
    }
    return out;
  }, [renderPoints, renderTangents, curve, closed, n]);

  // ---------------------------------------------------------------------------
  // Commit helper: element-relative live geometry → absolute → bounds
  // recompute (sampled bounds for bezier so tangent bulges count) →
  // normalized {x, y, width, height, points, tangents} update.
  // ---------------------------------------------------------------------------
  const geometryUpdate = useCallback((rel: number[], tangents: number[] | null): Partial<ShapeElement> => {
    const abs = rel.map((v, i) => v + (i % 2 === 0 ? element.x : element.y));
    const b = pathBoundsFor(abs, curve, closed, tangents ?? undefined);
    const update: Partial<ShapeElement> = {
      x: b.x,
      y: b.y,
      width: b.width,
      height: b.height,
      points: b.points,
    };
    if (tangents) update.tangents = tangents;
    return update;
  }, [element.x, element.y, curve, closed]);

  // ---------------------------------------------------------------------------
  // Vertex drag (incl. midpoint materialize-and-drag).
  // ---------------------------------------------------------------------------
  const startGesture = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    try {
      (e.currentTarget as Element).setPointerCapture(e.pointerId);
    } catch { /* ignore */ }
    onTransformStart?.();
  }, [onTransformStart]);

  const beginVertexDrag = useCallback((idx: number, e: React.PointerEvent) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    startGesture(e);
    livePointsRef.current = points.slice();
    liveTangentsRef.current = baseTangents ? baseTangents.slice() : null;
    setLivePoints(points.slice());
    setLiveTangents(baseTangents ? baseTangents.slice() : null);
    setDragging({ kind: 'vertex', idx });
    setActiveIdx(idx);
  }, [points, baseTangents, startGesture]);

  /** Pointer-down on a midpoint dot: materialize a real vertex at the
   *  segment's arc-length midpoint and continue as a vertex drag in the
   *  same gesture. */
  const beginMidpointDrag = useCallback((segIdx: number, e: React.PointerEvent) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const seg = segments[segIdx];
    if (!seg) return;
    startGesture(e);
    const insertAt = segIdx + 1;
    const newRel = points.slice();
    newRel.splice(2 * insertAt, 0, seg.midX, seg.midY);
    let newTan: number[] | null = null;
    if (baseTangents) {
      // Give the new vertex a Catmull-Rom-estimated tangent so a curved
      // segment keeps (approximately) its shape until the user shapes it.
      newTan = baseTangents.slice();
      const est = catmullTangents(newRel, closed);
      newTan.splice(4 * insertAt, 0, est[4 * insertAt], est[4 * insertAt + 1], est[4 * insertAt + 2], est[4 * insertAt + 3]);
    }
    livePointsRef.current = newRel;
    liveTangentsRef.current = newTan;
    setLivePoints(newRel);
    setLiveTangents(newTan);
    setDragging({ kind: 'vertex', idx: insertAt });
    setActiveIdx(insertAt);
  }, [segments, points, baseTangents, closed, startGesture]);

  const beginTangentDrag = useCallback((idx: number, which: 'in' | 'out', e: React.PointerEvent) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (!baseTangents) return;
    startGesture(e);
    livePointsRef.current = points.slice();
    liveTangentsRef.current = baseTangents.slice();
    setLivePoints(points.slice());
    setLiveTangents(baseTangents.slice());
    setDragging({ kind: 'tangent', idx, which });
    setActiveIdx(idx);
  }, [points, baseTangents, startGesture]);

  useEffect(() => {
    if (!dragging) return;

    const onMove = (e: PointerEvent) => {
      e.preventDefault();
      const pos = screenToSVG(e.clientX, e.clientY);
      const prevPts = livePointsRef.current;
      if (!prevPts) return;
      const liveN = prevPts.length / 2;

      if (dragging.kind === 'tangent') {
        const prevTan = liveTangentsRef.current;
        if (!prevTan) return;
        const vX = element.x + prevPts[2 * dragging.idx];
        const vY = element.y + prevPts[2 * dragging.idx + 1];
        const dx = pos.x - vX;
        const dy = pos.y - vY;
        const tan = prevTan.slice();
        const own = dragging.which === 'in' ? 0 : 2;
        const opp = dragging.which === 'in' ? 2 : 0;
        tan[4 * dragging.idx + own] = dx;
        tan[4 * dragging.idx + own + 1] = dy;
        if (!e.altKey) {
          // Smooth vertex: mirror the opposite handle.
          tan[4 * dragging.idx + opp] = -dx;
          tan[4 * dragging.idx + opp + 1] = -dy;
        }
        liveTangentsRef.current = tan;
        setLiveTangents(tan);
        return;
      }

      // Vertex drag.
      let absX = pos.x;
      let absY = pos.y;
      const isEndpoint = !closed && (dragging.idx === 0 || dragging.idx === liveN - 1);
      if (isEndpoint) {
        // Full line/arrow endpoint feature set: Ctrl angle-constrain
        // against the adjacent vertex, connector binding with silhouette
        // preview, sibling snapping with alignment guides.
        const adjIdx = dragging.idx === 0 ? 1 : liveN - 2;
        const adj = {
          x: element.x + prevPts[2 * adjIdx],
          y: element.y + prevPts[2 * adjIdx + 1],
        };
        if (isCtrlHeld()) {
          const constrained = constrainToAngle({ x: absX, y: absY }, adj);
          absX = constrained.x;
          absY = constrained.y;
        }
        const target = elements
          ? getBindingTarget2({ x: absX, y: absY }, elements, element.id, zoom)
          : null;
        if (target) {
          // Silhouette + gap preview: outside the outline the vertex stays
          // under the cursor; inside, it hugs the silhouette.
          const preview = resolveBinding(
            bindingFor({ x: absX, y: absY }, target, adj, 'edge'),
            target,
            adj,
          );
          absX = preview.x;
          absY = preview.y;
          onConnectorHighlight?.(target.id);
          onGuidesChange?.([]);
        } else {
          onConnectorHighlight?.(null);
          // Snap to sibling elements (Shift disables, like every drag).
          const { snapToGrid: snappingEnabled, marginLayoutId } = useEditorStore.getState();
          if (snappingEnabled && !isShiftHeld() && elements) {
            const marginLayout = getMarginLayout(marginLayoutId);
            const marginBounds = marginLayout ? getMarginBounds(marginLayout) : null;
            const others = elements
              .filter((el) => el.id !== element.id && el.visible)
              .map((el) => ({ x: el.x, y: el.y, width: el.width, height: el.height }));
            const snapResult = computePointSnap({ x: absX, y: absY }, others, 5, marginBounds);
            onGuidesChange?.(snapResult.guides);
            if (snapResult.snapX !== null) absX = snapResult.snapX;
            if (snapResult.snapY !== null) absY = snapResult.snapY;
          } else {
            onGuidesChange?.([]);
          }
        }
      }
      const out = prevPts.slice();
      out[2 * dragging.idx] = absX - element.x;
      out[2 * dragging.idx + 1] = absY - element.y;
      livePointsRef.current = out;
      setLivePoints(out);
    };

    const onUp = (e: PointerEvent) => {
      e.preventDefault();
      setDragging(null);
      onGuidesChange?.([]);
      onConnectorHighlight?.(null);
      // Commit from the refs, NOT inside a setState updater.
      const finalPoints = livePointsRef.current;
      const finalTangents = liveTangentsRef.current;
      livePointsRef.current = null;
      liveTangentsRef.current = null;
      setLivePoints(null);
      setLiveTangents(null);
      if (!finalPoints) return;
      const update = geometryUpdate(finalPoints, finalTangents);
      if (dragging.kind === 'vertex') {
        const liveN = finalPoints.length / 2;
        const isEndpoint = !closed && (dragging.idx === 0 || dragging.idx === liveN - 1);
        // (Re)derive the dragged endpoint's binding from the drop point;
        // no target clears a stale binding. The other endpoint's binding
        // is preserved unchanged.
        if (isEndpoint && elements) {
          const pts = update.points!;
          const lastVx = pts.length - 2;
          const tipX = (dragging.idx === 0 ? pts[0] : pts[lastVx]) + update.x!;
          const tipY = (dragging.idx === 0 ? pts[1] : pts[lastVx + 1]) + update.y!;
          const target = getBindingTarget2({ x: tipX, y: tipY }, elements, element.id, zoom);
          let binding: ConnectorBinding | null = null;
          if (target) {
            const adjVx = dragging.idx === 0 ? 2 : lastVx - 2;
            const adj = { x: pts[adjVx] + update.x!, y: pts[adjVx + 1] + update.y! };
            binding = bindingFor({ x: tipX, y: tipY }, target, adj, 'edge');
          }
          if (dragging.idx === 0) update.startBinding = binding;
          else update.endBinding = binding;
        }
      }
      onUpdate(update);
    };

    window.addEventListener('pointermove', onMove, { passive: false });
    window.addEventListener('pointerup', onUp, { passive: false });
    window.addEventListener('pointercancel', onUp, { passive: false });
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  }, [dragging, closed, element.id, element.x, element.y, elements, zoom, screenToSVG, geometryUpdate, onUpdate, onGuidesChange, onConnectorHighlight]);

  // ---------------------------------------------------------------------------
  // Delete the hovered vertex on Backspace / Delete. Closed paths keep ≥3
  // vertices; open paths keep ≥2 (a poly can degrade back to a line).
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (hoverIdx === null) return;
    const minVertices = closed ? 3 : 2;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Backspace' && e.key !== 'Delete') return;
      if (n <= minVertices) return;
      e.preventDefault();
      e.stopPropagation();
      const newRel = points.slice();
      newRel.splice(2 * hoverIdx, 2);
      let newTan: number[] | null = null;
      if (baseTangents) {
        newTan = baseTangents.slice();
        newTan.splice(4 * hoverIdx, 4);
      }
      onUpdate(geometryUpdate(newRel, newTan));
      setHoverIdx(null);
      setActiveIdx(null);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [hoverIdx, n, points, baseTangents, closed, geometryUpdate, onUpdate]);

  // ---------------------------------------------------------------------------
  // Alt+click on a segment strip inserts a vertex at the click point.
  // ---------------------------------------------------------------------------
  const insertOnSegment = useCallback((segIdx: number, e: React.PointerEvent) => {
    if (!e.altKey) return;
    e.preventDefault();
    e.stopPropagation();
    const pos = screenToSVG(e.clientX, e.clientY);
    const insertAt = segIdx + 1;
    const newRel = points.slice();
    newRel.splice(2 * insertAt, 0, pos.x - element.x, pos.y - element.y);
    let newTan: number[] | null = null;
    if (baseTangents) {
      newTan = baseTangents.slice();
      const est = catmullTangents(newRel, closed);
      newTan.splice(4 * insertAt, 0, est[4 * insertAt], est[4 * insertAt + 1], est[4 * insertAt + 2], est[4 * insertAt + 3]);
    }
    onUpdate(geometryUpdate(newRel, newTan));
  }, [points, baseTangents, closed, element.x, element.y, screenToSVG, geometryUpdate, onUpdate]);

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  const strokeW = STROKE_W / zoom;
  const thinW = 1 / zoom;
  const dash = `${4 / zoom} ${3 / zoom}`;

  // Dashed overlay of the path through the PRODUCTION pathD — curves /
  // closed / corner radius / bezier tangents render exactly like the real
  // shape. Doubles as the selection outline (the transformer is suppressed
  // for sole-selected paths) and as the live drag preview.
  const previewD = pathD(
    insetEndpoints(renderPoints, !!element.startArrow, !!element.endArrow),
    curve,
    closed,
    curve === 'linear' ? (element.cornerRadius ?? 0) : 0,
    isBezier ? renderTangents ?? undefined : undefined,
  );

  const showTangents = isBezier && renderTangents && activeIdx !== null
    && activeIdx < renderPoints.length / 2;
  let tangentHandles: Array<{ which: 'in' | 'out'; vx: number; vy: number; hx: number; hy: number }> = [];
  if (showTangents) {
    const i = activeIdx;
    const vx = element.x + renderPoints[2 * i];
    const vy = element.y + renderPoints[2 * i + 1];
    tangentHandles = [
      { which: 'in', vx, vy, hx: vx + renderTangents[4 * i], hy: vy + renderTangents[4 * i + 1] },
      { which: 'out', vx, vy, hx: vx + renderTangents[4 * i + 2], hy: vy + renderTangents[4 * i + 3] },
    ];
  }

  return (
    <g className="path-handles">
      {previewD && (
        <path
          d={previewD}
          transform={`translate(${element.x} ${element.y})`}
          fill="none"
          stroke={COLOR}
          strokeWidth={Math.max(strokeW, 1)}
          strokeDasharray={dash}
          opacity={livePoints ? 0.8 : 0.5}
          style={{ pointerEvents: 'none' }}
        />
      )}

      {/* Invisible alt-click strips hugging each segment's sampled curve. */}
      {segments.map((seg, segIdx) => {
        const d = seg.sub.length >= 4
          ? `M ${seg.sub[0]} ${seg.sub[1]} ` + Array.from(
              { length: seg.sub.length / 2 - 1 },
              (_, i) => `L ${seg.sub[2 * (i + 1)]} ${seg.sub[2 * (i + 1) + 1]}`,
            ).join(' ')
          : null;
        if (!d) return null;
        return (
          <path
            key={`seg-${segIdx}`}
            d={d}
            transform={`translate(${element.x} ${element.y})`}
            fill="none"
            stroke="transparent"
            strokeWidth={Math.max(8 / zoom, 4)}
            style={{ cursor: 'copy', pointerEvents: 'stroke' }}
            onPointerDown={(e) => insertOnSegment(segIdx, e)}
          />
        );
      })}

      {/* Midpoint dots: pointer-down materializes a vertex and drags it. */}
      {!dragging && segments.map((seg, segIdx) => {
        const cx = element.x + seg.midX;
        const cy = element.y + seg.midY;
        return (
          <g key={`mid-${segIdx}`}>
            <circle
              cx={cx}
              cy={cy}
              r={4.5 / zoom}
              fill={COLOR}
              opacity={0.45}
              style={{ pointerEvents: 'none' }}
            />
            <circle
              cx={cx}
              cy={cy}
              r={HIT_R / zoom}
              fill="transparent"
              style={{ cursor: 'copy', touchAction: 'none', pointerEvents: 'all' }}
              onPointerDown={(e) => beginMidpointDrag(segIdx, e)}
            />
          </g>
        );
      })}

      {/* Vertex handles (endpoints of open paths get the bigger radius). */}
      {Array.from({ length: renderPoints.length / 2 }, (_, i) => {
        const cx = element.x + renderPoints[2 * i];
        const cy = element.y + renderPoints[2 * i + 1];
        const isEndpoint = !closed && (i === 0 || i === renderPoints.length / 2 - 1);
        return (
          <g key={`v-${i}`}>
            <circle
              cx={cx}
              cy={cy}
              r={HIT_R / zoom}
              fill="transparent"
              style={{ cursor: 'move', touchAction: 'none', pointerEvents: 'all' }}
              onPointerDown={(e) => beginVertexDrag(i, e)}
              onPointerEnter={() => {
                setHoverIdx(i);
                setActiveIdx(i);
              }}
              onPointerLeave={() => setHoverIdx((prev) => (prev === i ? null : prev))}
            />
            <circle
              cx={cx}
              cy={cy}
              r={(isEndpoint ? ENDPOINT_R : HANDLE_R) / zoom}
              fill="#fff"
              stroke={COLOR}
              strokeWidth={strokeW}
              style={{ cursor: 'move', touchAction: 'none' }}
              onPointerDown={(e) => beginVertexDrag(i, e)}
              onPointerEnter={() => {
                setHoverIdx(i);
                setActiveIdx(i);
              }}
              onPointerLeave={() => setHoverIdx((prev) => (prev === i ? null : prev))}
            />
          </g>
        );
      })}

      {/* Bézier tangent handles for the active vertex. */}
      {tangentHandles.length > 0 && (
        <g className="tangent-handles">
          {tangentHandles.map(({ which, vx, vy, hx, hy }) => (
            <g key={which}>
              <line
                x1={vx}
                y1={vy}
                x2={hx}
                y2={hy}
                stroke={COLOR}
                strokeWidth={thinW}
                style={{ pointerEvents: 'none' }}
              />
              <circle
                cx={hx}
                cy={hy}
                r={HIT_R / zoom}
                fill="transparent"
                style={{ cursor: 'move', touchAction: 'none', pointerEvents: 'all' }}
                onPointerDown={(e) => beginTangentDrag(activeIdx!, which, e)}
              />
              <circle
                cx={hx}
                cy={hy}
                r={3.5 / zoom}
                fill={COLOR}
                stroke="#fff"
                strokeWidth={thinW}
                style={{ cursor: 'move', touchAction: 'none' }}
                onPointerDown={(e) => beginTangentDrag(activeIdx!, which, e)}
              />
            </g>
          ))}
        </g>
      )}
    </g>
  );
};
