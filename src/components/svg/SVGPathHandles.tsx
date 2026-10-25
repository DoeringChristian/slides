import { useCanvasGestureGuard } from './useCanvasGestureGuard';
import { CONTROL_THEME } from './controlTheme';
import { screenPixelsToSlide } from '../../utils/screenSpace';
import React, { useState, useEffect, useCallback, useMemo, useRef, useId } from 'react';
import type { SlideElement, ShapeElement, ConnectorBinding } from '../../types/presentation';
import {
  pathArrowGeometry,
  pathEndpointDirection,
  sampledPath,
  catmullTangents,
} from '../../utils/pathShapes';
import { getActiveUndoManager } from '../../collab/activeUndo';
import { useEditorStore } from '../../store/editorStore';
import { computePointSnap, type Guide } from '../../hooks/useAlignmentGuides';
import { getMarginLayout, getMarginBounds } from '../../utils/marginLayouts';
import { centeredPathResize } from '../../utils/centeredPathResize';
import { bindingDrop, resolveBinding, bindingAimPoint, silhouetteDistance, type ConnectorHighlightCallback } from '../../utils/connectorUtils';
import { useCoarsePointer } from '../../hooks/useCoarsePointer';
import { snapPathPoint, resolvedPointGuides, vertexAlignmentSources, withVertexMagnets } from '../../utils/pathSnapping';
import { pathPointToSlide, slidePointToPath, pathPointsInSlide, pathGeometryUpdate } from '../../utils/pathEditing';
import { useScreenToSVG } from './useScreenToSVG';

interface Props {
  element: ShapeElement;
  displayElement?: ShapeElement;
  onPreview?: (attrs: Partial<ShapeElement> | null) => void;
  /** Sibling elements on the same slide; needed so endpoint vertices can
   *  snap to other shapes and bind to them. */
  elements?: SlideElement[];
  zoom: number;
  svgRef?: React.RefObject<SVGSVGElement | null>;
  onUpdate: (attrs: Partial<ShapeElement>) => void;
  onTransformStart?: () => void;
  onEditingChange?: (editing: boolean) => void;
  /** Alignment guides while an endpoint vertex snaps to siblings. */
  onGuidesChange?: (guides: Guide[]) => void;
  /** Highlight a binding-target element while the user drags over it. */
  onConnectorHighlight?: ConnectorHighlightCallback;
}

const HANDLE_R = 5;
const ENDPOINT_R = 5;
const STROKE_W = 2;
const COLOR = CONTROL_THEME.color;
/** Hit radius for midpoint dots and vertex handles (screen px / zoom). */
const HIT_R = 7;

type Drag =
  | { kind: 'vertex'; idx: number }
  | { kind: 'focus'; idx: number; offset: { x: number; y: number } }
  | { kind: 'tangent'; idx: number; which: 'in' | 'out' };

interface Segment {
  /** Sampled sub-polyline of this visual segment, element-relative flat coords. */
  sub: number[];
  /** Arc-length midpoint of `sub` (element-relative). */
  midX: number;
  midY: number;
  length: number;
}

/**
 * Unified edit handles for ANY sole-selected path shape — 2-point lines are
 * just degenerate polys. Union of the former SVGLineEndpointHandles +
 * SVGPolyVertexHandles feature sets:
 *
 *  * Drag a vertex handle → moves that vertex (bounds recomputed on commit).
 *    Endpoint vertices of OPEN paths additionally get the full line/arrow
 *    feature set: alignment guides, Shift angle-constrain against the
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
  displayElement, onPreview,
  elements,
  zoom,
  svgRef,
  onUpdate,
  onTransformStart, onEditingChange,
  onGuidesChange,
  onConnectorHighlight,
}) => {
  const { start: startGuard, finish: finishGuard } = useCanvasGestureGuard();
  const coarse = useCoarsePointer();
  const [altHeld, setAltHeld] = useState(false);
  const [metaHeld, setMetaHeld] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { setAltHeld(e.altKey); setMetaHeld(e.metaKey); };
    const onBlur = () => { setAltHeld(false); setMetaHeld(false); };
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKey);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKey);
      window.removeEventListener('blur', onBlur);
    };
  }, []);
  const points = useMemo(() => element.points ?? [], [element.points]);
  const n = points.length / 2;
  const closed = element.closed ?? false;
  const curve = element.curve ?? 'linear';
  const isBezier = curve === 'bezier';

  // Tangents the path currently renders with (stored, or Catmull-Rom
  // defaults for a bare bezier conversion) — editing starts from these.
  const baseTangents = useMemo(() => {
    if (element.tangents?.length === points.length * 2) return element.tangents;
    return isBezier ? catmullTangents(points, closed) : undefined;
  }, [isBezier, element.tangents, points, closed]);

  const [dragging, setDragging] = useState<Drag | null>(null);
  const [livePoints, setLivePoints] = useState<number[] | null>(null);
  const [liveTangents, setLiveTangents] = useState<number[] | null>(null);
  // Ref mirrors: the commit on pointerup must read the final geometry and
  // call onUpdate OUTSIDE any setState updater (see component docs).
  const livePointsRef = useRef<number[] | null>(null);
  const liveTangentsRef = useRef<number[] | null>(null);
  // Undefined means no endpoint move yet; null means explicitly unbound.
  const dropBindingRef = useRef<ConnectorBinding | null | undefined>(undefined);
  const lastPointerRef = useRef<Pick<PointerEvent, 'clientX' | 'clientY' | 'pointerId' | 'shiftKey' | 'ctrlKey' | 'metaKey' | 'altKey'> & { moved?: boolean } | null>(null);
  const pointerIdRef = useRef<number | null>(null);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  // Vertex whose bezier tangent handles are shown. Sticky (survives hover
  // leaving the vertex) so the pointer can travel to the handle itself.
  const [activeIdx, setActiveIdx] = useState<number | null>(null);

  const visualElement = displayElement ?? element;
  const renderPoints = displayElement?.points ?? livePoints ?? points;
  const renderTangents = displayElement?.tangents ?? liveTangents ?? baseTangents;

  const screenToSVG = useScreenToSVG(svgRef, zoom);

  // ---------------------------------------------------------------------------
  // Visual segments: sampled sub-polylines + arc-length midpoints. Segment
  // boundaries are the samples nearest each vertex (exact for linear and
  // bezier where vertices ARE samples; closest-approach for B-splines whose
  // curve doesn't pass through its control points).
  // ---------------------------------------------------------------------------
  const segments = useMemo<Segment[]>(() => {
    const liveN = renderPoints.length / 2;
    if (liveN < 2) return [];
    const samples = sampledPath(renderPoints, curve, closed, renderTangents ?? undefined);
    if (samples.length < 4) return [];
    const walk = closed ? [...samples, samples[0], samples[1]] : samples;
    const M = walk.length / 2;
    const bounds: number[] = [0];
    let cursor = 0;
    for (let v = 1; v < liveN; v++) {
      // Through-point curves have EXACT segment boundaries every 32
      // samples. Nearest-vertex searches misassign loops/repeated vertices.
      if (curve === 'smooth' || curve === 'bezier' || curve === 'linear') {
        bounds.push(curve === 'linear' ? v : v * 32);
        continue;
      }
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
      out.push({ sub, midX, midY, length: total });
    }
    return out;
  }, [renderPoints, renderTangents, curve, closed]);

  // ---------------------------------------------------------------------------
  // Commit helper: element-relative live geometry → absolute → bounds
  // recompute (sampled bounds for bezier so tangent bulges count) →
  // normalized {x, y, width, height, points, tangents} update.
  // ---------------------------------------------------------------------------
  const geometryUpdate = useCallback((rel: number[], tangents: number[] | null): Partial<ShapeElement> => {
    return pathGeometryUpdate(element, rel, tangents ?? undefined);
  }, [element]);

  // ---------------------------------------------------------------------------
  // Vertex drag (incl. midpoint materialize-and-drag).
  // ---------------------------------------------------------------------------
  const cancel = useCallback(() => {
    finishGuard();
    pointerIdRef.current = null;
    dropBindingRef.current = undefined;
    livePointsRef.current = null; liveTangentsRef.current = null;
    setLivePoints(null); setLiveTangents(null); setDragging(null);
    onPreview?.(null); onGuidesChange?.([]); onConnectorHighlight?.(null);
  }, [finishGuard, onPreview, onGuidesChange, onConnectorHighlight]);

  const startGesture = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    try {
      (e.currentTarget as Element).setPointerCapture(e.pointerId);
    } catch { /* ignore */ }
    if (!startGuard(cancel, [element])) return false;
    pointerIdRef.current = e.pointerId;
    lastPointerRef.current = { clientX: e.clientX, clientY: e.clientY, pointerId: e.pointerId, shiftKey: e.shiftKey, ctrlKey: e.ctrlKey, metaKey: e.metaKey, altKey: e.altKey };
    dropBindingRef.current = undefined;
    onTransformStart?.();
    return true;
  }, [onTransformStart, startGuard, cancel, element]);

  const beginVertexDrag = useCallback((idx: number, e: React.PointerEvent) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (!startGesture(e)) return;
    livePointsRef.current = points.slice();
    liveTangentsRef.current = baseTangents ? baseTangents.slice() : null;
    setLivePoints(points.slice());
    setLiveTangents(baseTangents ? baseTangents.slice() : null);
    setDragging({ kind: 'vertex', idx });
    setActiveIdx(idx);
  }, [points, baseTangents, startGesture]);

  const beginFocusDrag = useCallback((idx: number, focus: { x: number; y: number }, e: React.PointerEvent) => {
    if (e.button !== 0 || e.metaKey || !startGesture(e)) return;
    // The focus marker can disappear while Cmd suppresses attachment or the
    // pointer leaves its target. Keep capture on the stable viewport owner.
    try { (e.currentTarget as SVGElement).ownerSVGElement?.setPointerCapture(e.pointerId); } catch { /* detached viewport */ }
    const pointer = screenToSVG(e.clientX, e.clientY);
    livePointsRef.current = points.slice();
    liveTangentsRef.current = baseTangents?.slice() ?? null;
    setDragging({ kind: 'focus', idx, offset: { x: pointer.x - focus.x, y: pointer.y - focus.y } });
  }, [startGesture, screenToSVG, points, baseTangents]);

  /** Pointer-down on a midpoint dot: materialize a real vertex at the
   *  segment's arc-length midpoint and continue as a vertex drag in the
   *  same gesture. */
  const beginMidpointDrag = useCallback((segIdx: number, e: React.PointerEvent) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const seg = segments[segIdx];
    if (!seg) return;
    if (!startGesture(e)) return;
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
    if (!startGesture(e)) return;
    livePointsRef.current = points.slice();
    liveTangentsRef.current = baseTangents.slice();
    setLivePoints(points.slice());
    setLiveTangents(baseTangents.slice());
    setDragging({ kind: 'tangent', idx, which });
    setActiveIdx(idx);
  }, [points, baseTangents, startGesture]);

  useEffect(() => {
    onEditingChange?.(!!dragging);
    return () => onEditingChange?.(false);
  }, [dragging, onEditingChange]);

  useEffect(() => {
    if (!dragging) return;

    const draftUpdate = (draftPoints: number[], draftTangents: number[] | null) => {
      const update = geometryUpdate(draftPoints, draftTangents);
      if (dragging.kind === 'vertex' || dragging.kind === 'focus') {
        const liveN = draftPoints.length / 2;
        const isEndpoint = !closed && (dragging.idx === 0 || dragging.idx === liveN - 1);
        if (isEndpoint && liveN === 2 && points.length === 4) {
          const opposite = dragging.idx === 0 ? 1 : 0;
          if (Math.hypot(draftPoints[2 * opposite] - points[2 * opposite], draftPoints[2 * opposite + 1] - points[2 * opposite + 1]) > 1e-9) {
            if (opposite === 0) update.startBinding = null; else update.endBinding = null;
          }
        }
        // The preview retained raw-drop intent; snapped coordinates cannot
        // tell an edge drop from a pin. Preserve the other endpoint binding.
        if (isEndpoint && dropBindingRef.current !== undefined) {
          if (dragging.idx === 0) update.startBinding = dropBindingRef.current;
          else update.endBinding = dropBindingRef.current;
        }
      }
      return update;
    };
    const publish = () => {
      if (livePointsRef.current) onPreview?.(draftUpdate(livePointsRef.current, liveTangentsRef.current));
    };
    publish();
    const onMove = (e: NonNullable<typeof lastPointerRef.current> & { preventDefault: () => void }) => {
      if (e.pointerId !== pointerIdRef.current) return;
      e.preventDefault();
      lastPointerRef.current = { moved: true, clientX: e.clientX, clientY: e.clientY, pointerId: e.pointerId, shiftKey: e.shiftKey, ctrlKey: e.ctrlKey, metaKey: e.metaKey, altKey: e.altKey };
      const pointer = screenToSVG(e.clientX, e.clientY);
      const pos = dragging.kind === 'focus' ? { x: pointer.x - dragging.offset.x, y: pointer.y - dragging.offset.y } : pointer;
      // For a two-point gesture, releasing Ctrl must restore the original
      // opposite endpoint rather than retaining the preceding centered preview.
      const prevPts = dragging.kind !== 'tangent' && points.length === 4 && livePointsRef.current?.length === 4
        ? points.slice() : livePointsRef.current;
      if (!prevPts) return;
      const liveN = prevPts.length / 2;

      if (dragging.kind === 'tangent') {
        const prevTan = liveTangentsRef.current;
        if (!prevTan) return;
        const vX = element.x + prevPts[2 * dragging.idx];
        const vY = element.y + prevPts[2 * dragging.idx + 1];
        const local = slidePointToPath(element, pos.x, pos.y);
        const dx = local.x - (vX - element.x);
        const dy = local.y - (vY - element.y);
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
        publish();
        return;
      }

      // Clear the previous visual even when this move bypasses all magnets.
      onGuidesChange?.([]);
      // Vertex drag.
      let absX = pos.x;
      let absY = pos.y;
      const isEndpoint = !closed && (dragging.idx === 0 || dragging.idx === liveN - 1);
      // Same-path magnets: every OTHER vertex of this path aligns the dragged
      // one horizontally / vertically; it can never snap to itself. Local
      // vertices still sit in the pre-commit design box, so map them with the
      // shared helper instead of re-deriving the rotation.
      const ownVertices = pathPointsInSlide({ ...element, points: prevPts });
      if (dragging.kind === 'vertex' && isEndpoint && liveN === 2 && points.length === 4 && e.ctrlKey) {
        const midpoint = pathPointToSlide(element, (points[0] + points[2]) / 2, (points[1] + points[3]) / 2);
        const { snapToGrid, marginLayoutId } = useEditorStore.getState();
        const layout = getMarginLayout(marginLayoutId);
        const snapped = snapPathPoint(pos, [midpoint], zoom, e.shiftKey,
          snapToGrid && !e.metaKey && elements ? { others: elements.filter(el => el.id !== element.id && el.visible), marginBounds: layout ? getMarginBounds(layout) : null } : undefined);
        const endpoint = snapped.point;
        const raw = centeredPathResize(element, dragging.idx, endpoint);
        let drop = !e.metaKey && elements ? bindingDrop(endpoint, raw.opposite, elements, element.id, zoom, e.shiftKey) : null;
        let next = raw;
        if (drop) {
          const candidate = centeredPathResize(element, dragging.idx, drop.point);
          const solved = resolveBinding(drop.binding, drop.target, candidate.opposite);
          // Only retain bindings stable under the FINAL mirrored adjacency;
          // otherwise mutation-time sync would move an end off the fixed center.
          if (Math.hypot(solved.x - drop.point.x, solved.y - drop.point.y) < 1e-7) next = candidate;
          else drop = null;
        }
        onGuidesChange?.(resolvedPointGuides(snapped.guides, drop?.point ?? endpoint, midpoint));
        dropBindingRef.current = drop?.binding ?? null;
        onConnectorHighlight?.(drop?.target.id ?? null, drop?.dock);
        livePointsRef.current = next.points;
        liveTangentsRef.current = next.tangents ?? null;
        setLivePoints(next.points); setLiveTangents(next.tangents ?? null);
        publish();
        return;
      }
      if (points.length === 4 && liveN === 2) {
        liveTangentsRef.current = baseTangents?.slice() ?? null;
        setLiveTangents(baseTangents?.slice() ?? null);
      }
      if (isEndpoint) {
        // Full line/arrow endpoint feature set: Shift angle-constrain
        // against the adjacent vertex, connector binding with silhouette
        // preview, sibling snapping with alignment guides.
        const adjIdx = dragging.idx === 0 ? 1 : liveN - 2;
        const oppositeBinding = dragging.idx === 0 ? element.endBinding : element.startBinding;
        const oppositeTarget = elements?.find(el => el.id === oppositeBinding?.elementId);
        const adj = liveN === 2 && curve === 'linear' && oppositeBinding?.mode === 'aim' && oppositeTarget
          ? bindingAimPoint(oppositeBinding, oppositeTarget)
          : pathPointToSlide(element, prevPts[2 * adjIdx], prevPts[2 * adjIdx + 1]);
        if (e.shiftKey) {
          const constrained = snapPathPoint(pos, [adj], zoom, true).point;
          absX = constrained.x;
          absY = constrained.y;
        }
        const drop = !e.metaKey && elements
          ? bindingDrop({ x: absX, y: absY }, adj, elements, element.id, zoom, e.shiftKey, dragging.kind !== 'focus')
          : null;
        if (drop) {
          dropBindingRef.current = drop.binding;
          absX = drop.point.x;
          absY = drop.point.y;
          onConnectorHighlight?.(drop.target.id, drop.dock);
          onGuidesChange?.(e.shiftKey ? [{ type: 'direction', destination: drop.point, x1: adj.x, y1: adj.y, x2: absX, y2: absY }] : []);
        } else {
          dropBindingRef.current = null;
          onConnectorHighlight?.(null);
          // Snap to sibling elements (Cmd disables, like every drag).
          const { snapToGrid: snappingEnabled, marginLayoutId } = useEditorStore.getState();
          if (snappingEnabled && !e.metaKey && elements) {
            const marginLayout = getMarginLayout(marginLayoutId);
            const marginBounds = marginLayout ? getMarginBounds(marginLayout) : null;
            // Own vertices first: an exact tie resolves to this path's own
            // geometry, and the first vertex outranks later ones.
            const others = [
              ...vertexAlignmentSources(ownVertices, [dragging.idx]),
              ...elements
                .filter((el) => el.id !== element.id && el.visible)
                .map((el) => ({ x: el.x, y: el.y, width: el.width, height: el.height })),
            ];
            const snapResult = computePointSnap({ x: absX, y: absY }, others, screenPixelsToSlide(5, zoom), marginBounds, e.shiftKey ? adj : undefined);
            const candidate = { x: snapResult.snapX ?? absX, y: snapResult.snapY ?? absY };
            const alignedDrop = bindingDrop(candidate, adj, elements, element.id, zoom, e.shiftKey, dragging.kind !== 'focus');
            const visible = alignedDrop?.point ?? candidate;
            dropBindingRef.current = alignedDrop?.binding ?? null;
            onConnectorHighlight?.(alignedDrop?.target.id ?? null, alignedDrop?.dock);
            absX = visible.x; absY = visible.y;
            onGuidesChange?.(resolvedPointGuides([...(e.shiftKey ? [{ type: 'direction' as const, destination: candidate, x1: adj.x, y1: adj.y, x2: candidate.x, y2: candidate.y }] : []), ...snapResult.guides], visible, adj));
          } else {
            onGuidesChange?.(e.shiftKey ? [{ type: 'direction', destination: { x: absX, y: absY }, x1: adj.x, y1: adj.y, x2: absX, y2: absY }] : []);
          }
        }

      }
      // Interior controls constrain to the adjacent vertex only with Shift, and
      // sibling object alignment stays Shift-only here (the endpoint branch owns
      // it otherwise) — but this path's own vertices magnetize either way.
      if (!isEndpoint) {
        const i = dragging.idx > 0 ? dragging.idx - 1 : 1;
        const { snapToGrid, marginLayoutId } = useEditorStore.getState();
        const layout = getMarginLayout(marginLayoutId);
        const objects = e.shiftKey && elements
          ? { others: elements.filter(el => el.id !== element.id && el.visible), marginBounds: layout ? getMarginBounds(layout) : null }
          : { others: [] };
        const alignment = snapToGrid && !e.metaKey ? withVertexMagnets(objects, ownVertices, [dragging.idx]) : undefined;
        if (e.shiftKey || alignment) {
          const constrained = snapPathPoint(pos, [pathPointToSlide(element, prevPts[2*i], prevPts[2*i+1])], zoom, e.shiftKey, alignment);
          absX = constrained.point.x; absY = constrained.point.y;
          onGuidesChange?.(e.shiftKey ? constrained.guides : resolvedPointGuides(constrained.guides, constrained.point));
        }
      }
      const out = prevPts.slice();
      const local = slidePointToPath(element, absX, absY);
      out[2 * dragging.idx] = local.x;
      out[2 * dragging.idx + 1] = local.y;
      livePointsRef.current = out;
      setLivePoints(out);
      publish();
    };

    const onUp = (e: PointerEvent) => {
      if (e.pointerId !== pointerIdRef.current) return;
      if (dragging.kind === 'focus' && !lastPointerRef.current?.moved) { cancel(); return; }
      // Release modifiers can differ from the last move; resolve raw drop now.
      if (lastPointerRef.current?.moved) onMove(e);
      e.preventDefault();
      pointerIdRef.current = null;
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
      finishGuard();
      onPreview?.(null);
      const update = draftUpdate(finalPoints, finalTangents);
      const undo = getActiveUndoManager();
      undo?.stopCapturing();
      onUpdate(update);
      undo?.stopCapturing();
    };

    const onCancel = (e: PointerEvent) => { if (e.pointerId === pointerIdRef.current) cancel(); };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cancel(); }
      else if (['Shift', 'Control', 'Meta', 'Alt'].includes(e.key) && lastPointerRef.current) {
        onMove({ ...lastPointerRef.current, shiftKey: e.shiftKey, ctrlKey: e.ctrlKey, metaKey: e.metaKey, altKey: e.altKey, preventDefault: () => {} });
      }
    };
    const onContext = (e: MouseEvent) => { if (points.length === 4 && dragging.kind === 'vertex' && e.ctrlKey) { e.preventDefault(); e.stopPropagation(); } };
    window.addEventListener('contextmenu', onContext, true);
    window.addEventListener('pointermove', onMove, { passive: false });
    window.addEventListener('pointerup', onUp, { passive: false });
    window.addEventListener('pointercancel', onCancel);
    window.addEventListener('lostpointercapture', onCancel);
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('keyup', onKey, true);
    window.addEventListener('blur', cancel);
    return () => {
      window.removeEventListener('contextmenu', onContext, true);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
      window.removeEventListener('lostpointercapture', onCancel);
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('keyup', onKey, true);
      window.removeEventListener('blur', cancel);
    };
  }, [dragging, closed, curve, element, elements, points, baseTangents, zoom, screenToSVG, geometryUpdate, onUpdate, onGuidesChange, onConnectorHighlight, onPreview, finishGuard, cancel]);

  // ---------------------------------------------------------------------------
  // Delete the hovered vertex on Backspace / Delete. Closed paths keep ≥3
  // vertices; open paths keep ≥2 (a poly can degrade back to a line).
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (hoverIdx === null || dragging) return;
    const minVertices = closed ? 3 : 2;
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || (e.key !== 'Backspace' && e.key !== 'Delete')) return;
      const target = e.target as HTMLElement;
      if (target.isContentEditable || target.closest('input,textarea,[role=dialog]')) return;
      e.preventDefault();
      e.stopPropagation();
      if (n <= minVertices) return;
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
  }, [hoverIdx, dragging, n, points, baseTangents, closed, geometryUpdate, onUpdate]);

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
    const local = slidePointToPath(element, pos.x, pos.y);
    newRel.splice(2 * insertAt, 0, local.x, local.y);
    let newTan: number[] | null = null;
    if (baseTangents) {
      newTan = baseTangents.slice();
      const est = catmullTangents(newRel, closed);
      newTan.splice(4 * insertAt, 0, est[4 * insertAt], est[4 * insertAt + 1], est[4 * insertAt + 2], est[4 * insertAt + 3]);
    }
    onUpdate(geometryUpdate(newRel, newTan));
  }, [points, baseTangents, closed, element, screenToSVG, geometryUpdate, onUpdate]);

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  const strokeW = STROKE_W / zoom;
  const thinW = 1 / zoom;
  const dash = `${4 / zoom} ${3 / zoom}`;

  // Idle selection outline only. Gesture appearance lives in the scene layer.
  const previewD = pathArrowGeometry({ ...visualElement, points: renderPoints, tangents: renderTangents ?? undefined }).d;

  const showTangents = isBezier && renderTangents && activeIdx !== null
    && activeIdx < renderPoints.length / 2;
  let tangentHandles: Array<{ which: 'in' | 'out'; vx: number; vy: number; hx: number; hy: number }> = [];
  if (showTangents) {
    const i = activeIdx;
    const vx = visualElement.x + renderPoints[2 * i];
    const vy = visualElement.y + renderPoints[2 * i + 1];
    tangentHandles = [
      { which: 'in', vx, vy, hx: vx + renderTangents[4 * i], hy: vy + renderTangents[4 * i + 1] },
      { which: 'out', vx, vy, hx: vx + renderTangents[4 * i + 2], hy: vy + renderTangents[4 * i + 3] },
    ];
  }

  const endpointClipId = useId();
  // A short two-point path needs a body lane BETWEEN its endpoint targets.
  // Clip only the inward side; the full outward/perpendicular mouse/touch
  // target stays usable rather than shrinking to a subpixel circle.
  const endpointDistance = Math.hypot(renderPoints[2] - renderPoints[0], renderPoints[3] - renderPoints[1]);
  const splitEndpoints = !closed && renderPoints.length === 4 && endpointDistance > 0
    && endpointDistance * zoom < (coarse ? 48 : 28);
  const endpointClip = (i: number) => {
    const x = visualElement.x + renderPoints[2 * i], y = visualElement.y + renderPoints[2 * i + 1];
    const other = i === 0 ? 1 : 0;
    const dx = (renderPoints[2 * other] - renderPoints[2 * i]) / endpointDistance;
    const dy = (renderPoints[2 * other + 1] - renderPoints[2 * i + 1]) / endpointDistance;
    const r = (coarse ? 14 : 9) / zoom;
    return [[-r,-r],[endpointDistance / 3,-r],[endpointDistance / 3,r],[-r,r]]
      .map(([along, across]) => `${x + dx * along - dy * across},${y + dy * along + dx * across}`).join(' ');
  };

  return (
    <g className="path-handles" transform={visualElement.rotation ? `rotate(${visualElement.rotation}, ${visualElement.x + visualElement.width / 2}, ${visualElement.y + visualElement.height / 2})` : undefined}>
      {previewD && !dragging && (
        <path
          d={previewD}
          transform={`translate(${visualElement.x} ${visualElement.y})`}
          fill="none"
          stroke={COLOR}
          strokeWidth={strokeW}
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
            transform={`translate(${visualElement.x} ${visualElement.y})`}
            fill="none"
            stroke="transparent"
            strokeWidth={Math.max(8 / zoom, 4)}
            style={{ cursor: 'pointer', pointerEvents: altHeld ? 'stroke' : 'none' }}
            onPointerDown={(e) => insertOnSegment(segIdx, e)}
          />
        );
      })}

      {/* Midpoint dots: pointer-down materializes a vertex and drags it. */}
      {!dragging && segments.map((seg, segIdx) => {
        // Keep a draggable body region on short lines; Alt+click insertion
        // remains available when there is no room for a midpoint target.
        if (seg.length * zoom < (coarse ? 64 : 36)) return null;
        const cx = visualElement.x + seg.midX;
        const cy = visualElement.y + seg.midY;
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
              r={(coarse ? 10 : 5) / zoom}
              fill="transparent"
              style={{ cursor: 'pointer', touchAction: 'none', pointerEvents: 'all' }}
              onPointerDown={(e) => beginMidpointDrag(segIdx, e)}
            />
          </g>
        );
      })}

      {/* Vertex handles (endpoints of open paths get the bigger radius). */}
      {Array.from({ length: renderPoints.length / 2 }, (_, i) => {
        const cx = visualElement.x + renderPoints[2 * i];
        const cy = visualElement.y + renderPoints[2 * i + 1];
        const isEndpoint = !closed && (i === 0 || i === renderPoints.length / 2 - 1);
        return (
          <g key={`v-${i}`} clipPath={splitEndpoints ? `url(#${endpointClipId}-${i})` : undefined}>
            {splitEndpoints && <defs><clipPath id={`${endpointClipId}-${i}`}>
              <polygon points={endpointClip(i)} />
            </clipPath></defs>}
            <circle
              cx={cx}
              cy={cy}
              r={(coarse ? 12 : HIT_R) / zoom}
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

      {/* Extension controls sit OUTSIDE the endpoints, leaving the body free. */}
      {!closed && !dragging && n >= 2 && (['start', 'end'] as const).map((end) => {
        const i = end === 'start' ? 0 : n - 1;
        const { dx, dy } = pathEndpointDirection(points, curve, closed, baseTangents, end);
        const len = Math.hypot(dx, dy) || 1;
        let offset = (coarse ? 30 : 22) / zoom;
        // Do not stack the extension affordance on a manual tangent handle.
        // Keep the offset deterministic even before that handle is hovered.
        if (isBezier && baseTangents) {
          for (const k of [0, 2]) {
            const tx = baseTangents[4 * i + k], ty = baseTangents[4 * i + k + 1];
            const along = (tx * dx + ty * dy) / len;
            const across = Math.abs(tx * dy - ty * dx) / len;
            if (across < 16 / zoom && Math.abs(along - offset) < 18 / zoom) offset = along + 20 / zoom;
          }
        }
        const x = visualElement.x + points[2 * i] + (dx === 0 && dy === 0 ? (end === 'start' ? -1 : 1) : dx / len) * offset;
        const y = visualElement.y + points[2 * i + 1] + dy / len * offset;
        const begin = () => useEditorStore.getState().beginPathExtension(visualElement.id, end);
        return <g key={`extend-${end}`} role="button" tabIndex={0} aria-label={`Extend ${end}`} style={{ cursor: 'pointer' }}
          onPointerDown={(e) => { if (e.button !== 0) return; e.preventDefault(); e.stopPropagation(); begin(); }}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); begin(); } }}>
          <title>Extend {end} — click to place more points</title>
          <circle cx={x} cy={y} r={(coarse ? 12 : 7) / zoom} fill="white" stroke={COLOR} strokeWidth={1 / zoom} />
          <path d={`M ${x - 3 / zoom} ${y} h ${6 / zoom} M ${x} ${y - 3 / zoom} v ${6 / zoom}`}
            stroke={COLOR} strokeWidth={1.5 / zoom} style={{ pointerEvents: 'none' }} />
        </g>;
      })}

      {/* Source: pinned Excalidraw focus.ts / renderFocusPointIndicator.
          Direct selection control, separate screen-space hit target, no modal UI.
          Unlike upstream, adjacent-vertex paths also expose their stored aims. */}
      {!closed && !metaHeld && (['startBinding', 'endBinding'] as const).map((key) => {
        const binding = visualElement[key];
        const target = elements?.find(el => el.id === binding?.elementId);
        if (binding?.mode !== 'aim' || !target) return null;
        const focus = bindingAimPoint(binding, target);
        const idx = key === 'startBinding' ? 0 : renderPoints.length / 2 - 1;
        const endpoint = pathPointToSlide(visualElement, renderPoints[2 * idx], renderPoints[2 * idx + 1]);
        if (silhouetteDistance(target, focus) > 1e-7 || Math.hypot(focus.x - endpoint.x, focus.y - endpoint.y) * zoom < 12) return null;
        const local = slidePointToPath(visualElement, focus.x, focus.y);
        const cx = visualElement.x + local.x, cy = visualElement.y + local.y;
        return <g key={key} data-binding-focus={key}>
          <line x1={visualElement.x + renderPoints[2 * idx]} y1={visualElement.y + renderPoints[2 * idx + 1]} x2={cx} y2={cy}
            stroke={COLOR} strokeWidth={1 / zoom} strokeDasharray={`${4 / zoom} ${4 / zoom}`} pointerEvents="none" />
          <circle cx={cx} cy={cy} r={4 / zoom} fill="white" stroke={COLOR} strokeWidth={1 / zoom} pointerEvents="none" />
          <circle data-focus-hit="true" cx={cx} cy={cy} r={(coarse ? 10 : 7) / zoom} fill="transparent"
            style={{ pointerEvents: 'all', touchAction: 'none', cursor: 'move' }}
            // eslint-disable-next-line react-hooks/refs -- event-only callback; no ref is read while rendering
            onPointerDown={e => beginFocusDrag(idx, focus, e)} />
        </g>;
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
                r={(coarse ? 12 : HIT_R) / zoom}
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
