import { useState, useCallback, useEffect, useRef } from 'react';
import { useEditorStore } from '../../store/editorStore';
import { usePresentationStore } from '../../store/presentationStore';
import { createTextElement, createShapeElement } from '../../utils/slideFactory';
import { computePointSnap, guideKey, type Guide } from '../../hooks/useAlignmentGuides';
import { getMarginLayout, getMarginBounds } from '../../utils/marginLayouts';
import { isShiftHeld, isMetaHeld, isCtrlHeld } from '../../utils/keyboard';
import { constrainToAngle } from '../../utils/geometry';
import { pathBoundsFor } from '../../utils/pathShapes';
import { getBindingTarget2, bindDraftEndpoints } from '../../utils/connectorUtils';
import type { PathCurve, ConnectorBinding, SlideElement } from '../../types/presentation';

/** Click within this many slide units of the first vertex while drafting a
 *  polygon / bspline closes the path. Matches typical SVG editors. */
const POLY_CLOSE_RADIUS = 10;
/** Initial line/arrow press becomes a drag only past this SCREEN distance. */
const DRAW_DRAG_SLOP_PX = 4;

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

/** Click-to-add path drafting (polygon, polyline, through-point curve). Vertices are
 *  absolute slide coords; the previewX/Y is the rubber-band endpoint at
 *  the cursor. `curve` carries the drawing tool's smoothing default. */
export interface PolyDraftState {
  curve: PathCurve;
  endHead?: 'triangle';
  canClose?: boolean;
  vertices: number[];
  previewX: number;
  previewY: number;
  /** Resolved display geometry; vertices above retain raw binding intent. */
  previewPoints?: number[];
  previewClosed?: boolean;
}

// Drawing hook — pointer-event based so it works for mouse, touch, and stylus.
// `onConnectorHighlight` outlines the element a drawn line/arrow endpoint
// would bind to (SVGSlideCanvas renders SVGConnectorHighlight from it).
export function useSVGDrawing(onConnectorHighlight?: (elementId: string | null) => void) {
  const [drawState, setDrawState] = useState<DrawState>({
    startX: 0, startY: 0, currentX: 0, currentY: 0, isDrawing: false,
    snappedStartX: 0, snappedStartY: 0, snappedCurrentX: 0, snappedCurrentY: 0,
  });
  const [guides, setGuides] = useState<Guide[]>([]);
  const [polyDraft, setPolyDraft] = useState<PolyDraftState | null>(null);
  const polyDraftRef = useRef<PolyDraftState | null>(null);
  // eslint-disable-next-line react-hooks/refs -- latest-value ref pattern: mirrors state for pointer handlers; read only outside render
  polyDraftRef.current = polyDraft;
  const justFinishedDrawing = useRef(false);
  const rawLineRef = useRef<number[] | null>(null);
  const initialPressRef = useRef<{ x: number; y: number; dragged: boolean } | null>(null);

  const tool = useEditorStore((s) => s.tool);
  const activeSlideId = useEditorStore((s) => s.activeSlideId);
  const setTool = useEditorStore((s) => s.setTool);
  const setSelectedElements = useEditorStore((s) => s.setSelectedElements);
  const setEditingTextId = useEditorStore((s) => s.setEditingTextId);
  const addElement = usePresentationStore((s) => s.addElement);

  const getSnapContext = useCallback(() => {
    const { snapToGrid, marginLayoutId } = useEditorStore.getState();
    const slide = usePresentationStore.getState().presentation.slides[activeSlideId];
    if (!snapToGrid || isShiftHeld() || !slide) return { others: [], marginBounds: null, snappingEnabled: false };

    const others = Object.values(slide.elements)
      .filter((el) => el.visible)
      .map((el) => ({ x: el.x, y: el.y, width: el.width, height: el.height }));

    const marginLayout = getMarginLayout(marginLayoutId);
    const marginBounds = marginLayout ? getMarginBounds(marginLayout) : null;

    return { others, marginBounds, snappingEnabled: true };
  }, [activeSlideId]);

  /** Slide elements in z-order — binding-target candidates for connector
   *  endpoints (getBindingTarget2 filters invisible/locked/path itself
   *  and picks the topmost match). */
  const getSlideElements = useCallback((): SlideElement[] => {
    const slide = usePresentationStore.getState().presentation.slides[activeSlideId];
    if (!slide) return [];
    return slide.elementOrder.map((id) => slide.elements[id]).filter(Boolean);
  }, [activeSlideId]);

  const commitPolyDraft = useCallback((closed = false) => {
    const draft = polyDraftRef.current;
    if (!draft || draft.vertices.length < 4) {
      polyDraftRef.current = null;
      setPolyDraft(null);
      setGuides([]);
      onConnectorHighlight?.(null);
      setTool('select');
      return;
    }
    // Bind the first/last vertex to a nearby shape anchor (open paths only —
    // a closed loop has no endpoints). Meta/Cmd suppresses binding.
    let vertices = draft.vertices;
    let startBinding: ConnectorBinding | null = null;
    let endBinding: ConnectorBinding | null = null;
    if (!closed && !isMetaHeld()) {
      const bound = bindDraftEndpoints(vertices, getSlideElements(), useEditorStore.getState().zoom);
      vertices = bound.absPoints;
      startBinding = bound.startBinding;
      endBinding = bound.endBinding;
    }
    const bounds = pathBoundsFor(vertices, draft.curve, closed);
    const el = createShapeElement('path', {
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
      points: bounds.points,
      curve: draft.curve,
      endHead: draft.endHead,
      closed,
      startBinding,
      endBinding,
    });
    addElement(activeSlideId, el);
    setSelectedElements([el.id]);
    polyDraftRef.current = null;
    setPolyDraft(null);
    setGuides([]);
    onConnectorHighlight?.(null);
    setTool('select');
    justFinishedDrawing.current = true;
  }, [activeSlideId, addElement, setSelectedElements, setTool, getSlideElements, onConnectorHighlight]);

  const cancelPolyDraft = useCallback(() => {
    polyDraftRef.current = null;
    setPolyDraft(null);
    setGuides([]);
    onConnectorHighlight?.(null);
    setTool('select');
  }, [setTool, onConnectorHighlight]);

  // Enter / Escape during a poly draft.
  useEffect(() => {
    if (!polyDraft) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        commitPolyDraft();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        cancelPolyDraft();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [polyDraft, commitPolyDraft, cancelPolyDraft]);

  const handlePointerDown = useCallback((
    e: React.PointerEvent,
    screenToSVG: (clientX: number, clientY: number) => { x: number; y: number }
  ) => {
    if (tool === 'select') return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;

    const pos = screenToSVG(e.clientX, e.clientY);

    const { others, marginBounds, snappingEnabled } = getSnapContext();
    const startSnap = snappingEnabled ? computePointSnap(pos, others, 5, marginBounds) : { snapX: null, snapY: null, guides: [] };
    const snappedStartX = startSnap.snapX ?? pos.x;
    const snappedStartY = startSnap.snapY ?? pos.y;

    // Polygon / bspline: click-to-add a vertex; double-click commits open;
    // clicking back on the first vertex commits CLOSED.
    if (tool === 'polygon' || tool === 'bspline' || polyDraftRef.current) {
      // Double-click on the in-progress draft → commit (open).
      if (e.detail >= 2 && polyDraftRef.current) {
        commitPolyDraft(false);
        return;
      }
      const draft = polyDraftRef.current;
      if (draft && draft.canClose !== false && draft.vertices.length >= 6) {
        // Close detection uses the RAW cursor position, not the grid/element
        // snap — `computePointSnap` may have pulled the cursor to a different
        // element's edge, making it look further from the first vertex than
        // it really is on screen.
        const dx = pos.x - draft.vertices[0];
        const dy = pos.y - draft.vertices[1];
        if (Math.hypot(dx, dy) <= POLY_CLOSE_RADIUS) {
          commitPolyDraft(true);
          return;
        }
      }
      const curve: PathCurve = tool === 'bspline' ? 'smooth' : 'linear';
      const previous = draft?.vertices;
      const vertex = isCtrlHeld() && previous && previous.length >= 2
        ? constrainToAngle(pos, { x: previous[previous.length - 2], y: previous[previous.length - 1] }) : pos;
      const target = !e.metaKey && getBindingTarget2(vertex, getSlideElements(), '', useEditorStore.getState().zoom);
      const snap = snappingEnabled && !target && !isCtrlHeld()
        ? computePointSnap(vertex, others, 5, marginBounds) : { snapX: null, snapY: null, guides: [] };
      const vx = snap.snapX ?? vertex.x, vy = snap.snapY ?? vertex.y;
      // The first click of a double-click already materialized the endpoint.
      // Ignore a repeated terminal vertex (including a stationary finish).
      const repeated = previous && previous.length >= 2
        && Math.hypot(vx - previous[previous.length - 2], vy - previous[previous.length - 1]) < 1e-6;
      const vertices = repeated ? previous : [...(previous ?? []), vx, vy];
      const previewPoints = e.metaKey ? vertices : bindDraftEndpoints(vertices, getSlideElements(), useEditorStore.getState().zoom).absPoints;
      const next: PolyDraftState = { ...draft, curve, vertices, previewX: vx, previewY: vy, previewPoints, previewClosed: false };
      polyDraftRef.current = next;
      setGuides(snap.guides);
      setPolyDraft(next);
      return;
    }

    let startX = snappedStartX;
    let startY = snappedStartY;
    let startGuides = startSnap.guides;

    // Binding intent must use the raw start point, before alignment snap.
    // Meta/Cmd suppresses the target search entirely.
    if ((tool === 'line' || tool === 'arrow') && !e.metaKey) {
      const target = getBindingTarget2(pos, getSlideElements(), '', useEditorStore.getState().zoom);
      if (target) {
        startX = pos.x;
        startY = pos.y;
        startGuides = [];
        onConnectorHighlight?.(target.id);
      }
    }

    initialPressRef.current = { x: e.clientX, y: e.clientY, dragged: false };
    rawLineRef.current = [startX, startY, startX, startY];
    setGuides(startGuides);
    setDrawState({
      startX: pos.x,
      startY: pos.y,
      currentX: pos.x,
      currentY: pos.y,
      isDrawing: true,
      snappedStartX: startX,
      snappedStartY: startY,
      snappedCurrentX: startX,
      snappedCurrentY: startY,
    });
  }, [tool, getSnapContext, commitPolyDraft, getSlideElements, onConnectorHighlight]);

  const handlePointerMove = useCallback((
    e: React.PointerEvent,
    screenToSVG: (clientX: number, clientY: number) => { x: number; y: number }
  ) => {
    // Update the rubber-band end of an in-progress polygon / bspline draft.
    if (polyDraftRef.current) {
      const draft = polyDraftRef.current;
      const pos = screenToSVG(e.clientX, e.clientY);
      const { others, marginBounds, snappingEnabled } = getSnapContext();
      const snap = snappingEnabled ? computePointSnap(pos, others, 5, marginBounds) : { snapX: null, snapY: null, guides: [] };
      const vertex = isCtrlHeld() ? constrainToAngle(pos, {
        x: draft.vertices[draft.vertices.length - 2], y: draft.vertices[draft.vertices.length - 1],
      }) : pos;
      const target = !e.metaKey && getBindingTarget2(vertex, getSlideElements(), '', useEditorStore.getState().zoom);
      let previewX = target || isCtrlHeld() ? vertex.x : (snap.snapX ?? vertex.x);
      let previewY = target || isCtrlHeld() ? vertex.y : (snap.snapY ?? vertex.y);
      const previewClosed = draft.canClose !== false && draft.vertices.length >= 6
        && Math.hypot(pos.x - draft.vertices[0], pos.y - draft.vertices[1]) <= POLY_CLOSE_RADIUS;
      if (previewClosed) { previewX = draft.vertices[0]; previewY = draft.vertices[1]; }
      const atLast = Math.hypot(previewX - draft.vertices[draft.vertices.length - 2], previewY - draft.vertices[draft.vertices.length - 1]) < 1e-6;
      const raw = previewClosed || atLast ? draft.vertices : [...draft.vertices, previewX, previewY];
      const previewPoints = previewClosed || e.metaKey ? raw
        : bindDraftEndpoints(raw, getSlideElements(), useEditorStore.getState().zoom).absPoints;
      onConnectorHighlight?.(target && !previewClosed ? target.id : null);
      setGuides(target || isCtrlHeld() ? [] : snap.guides);
      const next = { ...draft, previewX, previewY, previewPoints, previewClosed };
      polyDraftRef.current = next;
      setPolyDraft(next);
      return;
    }

    if (!drawState.isDrawing) return;
    const press = initialPressRef.current;
    if (press && Math.hypot(e.clientX - press.x, e.clientY - press.y) >= DRAW_DRAG_SLOP_PX) press.dragged = true;

    const pos = screenToSVG(e.clientX, e.clientY);

    const { others, marginBounds, snappingEnabled } = getSnapContext();

    // Resolve both ends from the SAME raw snapshot for preview and commit.
    // Never infer pin intent from a previously snapped silhouette point.
    if (tool === 'line' || tool === 'arrow') {
      const elements = getSlideElements();
      const zoom = useEditorStore.getState().zoom;
      const start = { x: drawState.startX, y: drawState.startY };
      const startTarget = !e.metaKey && getBindingTarget2(start, elements, '', zoom);
      const startSnap = snappingEnabled && !startTarget ? computePointSnap(start, others, 5, marginBounds) : null;
      const sx = startSnap?.snapX ?? start.x, sy = startSnap?.snapY ?? start.y;
      const end = isCtrlHeld() ? constrainToAngle(pos, { x: sx, y: sy }) : pos;
      const endTarget = !e.metaKey && getBindingTarget2(end, elements, '', zoom);
      const endSnap = snappingEnabled && !endTarget && !isCtrlHeld() ? computePointSnap(end, others, 5, marginBounds) : null;
      const raw = [sx, sy, endSnap?.snapX ?? end.x, endSnap?.snapY ?? end.y];
      rawLineRef.current = raw;
      const resolved = e.metaKey ? raw : bindDraftEndpoints(raw, elements, zoom).absPoints;
      onConnectorHighlight?.(endTarget ? endTarget.id : null);
      setGuides([...(startSnap?.guides ?? []), ...(endSnap?.guides ?? [])]);
      setDrawState((s) => ({ ...s, currentX: pos.x, currentY: pos.y,
        snappedStartX: resolved[0], snappedStartY: resolved[1],
        snappedCurrentX: resolved[2], snappedCurrentY: resolved[3],
      }));
      return;
    }

    if (snappingEnabled) {
      const currentSnap = computePointSnap(pos, others, 5, marginBounds);
      const snappedCurrentX = (currentSnap.snapX ?? pos.x);
      const snappedCurrentY = (currentSnap.snapY ?? pos.y);

      const startSnap = computePointSnap({ x: drawState.startX, y: drawState.startY }, others, 5, marginBounds);
      const allGuides = [...(startSnap?.guides ?? []), ...(currentSnap?.guides ?? [])];
      const seen = new Set<string>();
      const uniqueGuides = allGuides.filter((g) => {
        const key = guideKey(g);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });

      setGuides(uniqueGuides);
      setDrawState((s) => ({
        ...s,
        currentX: pos.x,
        currentY: pos.y,
        snappedCurrentX,
        snappedCurrentY,
        snappedStartX: (startSnap?.snapX ?? s.startX),
        snappedStartY: (startSnap?.snapY ?? s.startY),
      }));
    } else {
      setGuides([]);
      setDrawState((s) => ({
        ...s,
        currentX: pos.x,
        currentY: pos.y,
        snappedCurrentX: pos.x,
        snappedCurrentY: pos.y,
        snappedStartX: s.startX,
        snappedStartY: s.startY,
      }));
    }
  }, [drawState.isDrawing, drawState.startX, drawState.startY, getSnapContext, tool, getSlideElements, onConnectorHighlight]);

  const handlePointerUp = useCallback(() => {
    if (!drawState.isDrawing || polyDraftRef.current) return;
    const isLineTool = tool === 'line' || tool === 'arrow';
    if (isLineTool && !initialPressRef.current?.dragged) {
      const raw = rawLineRef.current ?? [drawState.startX, drawState.startY];
      const draft: PolyDraftState = {
        curve: 'linear', canClose: false,
        ...(tool === 'arrow' ? { endHead: 'triangle' as const } : {}),
        vertices: raw.slice(0, 2), previewX: raw[0], previewY: raw[1],
      };
      polyDraftRef.current = draft;
      setPolyDraft(draft);
      setDrawState((s) => ({ ...s, isDrawing: false }));
      setGuides([]);
      return;
    }

    const x = Math.min(drawState.snappedStartX, drawState.snappedCurrentX);
    const y = Math.min(drawState.snappedStartY, drawState.snappedCurrentY);
    const width = Math.abs(drawState.snappedCurrentX - drawState.snappedStartX);
    const height = Math.abs(drawState.snappedCurrentY - drawState.snappedStartY);

    setGuides([]);
    onConnectorHighlight?.(null);

    if (!isLineTool && width < 5 && height < 5) {
      // Click without a drag — too small to materialize anything. Stay
      // in the drawing tool so the user can try again; we only reset to
      // select when a shape was actually committed.
        setDrawState({
        startX: 0, startY: 0, currentX: 0, currentY: 0, isDrawing: false,
        snappedStartX: 0, snappedStartY: 0, snappedCurrentX: 0, snappedCurrentY: 0,
      });
      return;
    }

    justFinishedDrawing.current = true;

    if (tool === 'text') {
      const el = createTextElement({ x, y, width: Math.max(width, 100), height: Math.max(height, 40) });
      addElement(activeSlideId, el);
      setSelectedElements([el.id]);
      setEditingTextId(el.id);
    } else if (tool === 'line' || tool === 'arrow') {
      // Line/arrow are drag-to-create path shapes: 2 vertices, linear curve,
      // the arrow tool with a triangle end head. Closed/start-head are off;
      // toggle via panel.
      // Endpoints near a shape anchor bind to it (the live preview already
      // snapped them there); Meta/Cmd held at release suppresses binding.
      let [sx, sy, ex, ey] = rawLineRef.current ?? [drawState.snappedStartX, drawState.snappedStartY, drawState.snappedCurrentX, drawState.snappedCurrentY];
      let startBinding: ConnectorBinding | null = null;
      let endBinding: ConnectorBinding | null = null;
      if (!isMetaHeld()) {
        const bound = bindDraftEndpoints([sx, sy, ex, ey], getSlideElements(), useEditorStore.getState().zoom);
        [sx, sy, ex, ey] = bound.absPoints as [number, number, number, number];
        startBinding = bound.startBinding;
        endBinding = bound.endBinding;
      }
      const el = createShapeElement('path', {
        ...pathBoundsFor([sx, sy, ex, ey], 'linear', false),
        curve: 'linear',
        closed: false,
        ...(tool === 'arrow' ? { endHead: 'triangle' as const } : {}),
        startBinding,
        endBinding,
      });
      addElement(activeSlideId, el);
      setSelectedElements([el.id]);
    } else if (['rect', 'ellipse', 'triangle', 'star'].includes(tool)) {
      const el = createShapeElement(tool as 'rect' | 'ellipse' | 'triangle' | 'star', { x, y, width, height });
      addElement(activeSlideId, el);
      setSelectedElements([el.id]);
    }

    // Drop back to select after any successful shape commit — the text
    // branch above has already opened the edit overlay via
    // setEditingTextId, so switching the tool here doesn't interfere
    // with that.
    setTool('select');

    setDrawState({
      startX: 0, startY: 0, currentX: 0, currentY: 0, isDrawing: false,
      snappedStartX: 0, snappedStartY: 0, snappedCurrentX: 0, snappedCurrentY: 0,
    });
  }, [drawState, tool, activeSlideId, addElement, setTool, setSelectedElements, setEditingTextId, getSlideElements, onConnectorHighlight]);

  return {
    drawState,
    guides,
    polyDraft,
    commitPolyDraft,
    cancelPolyDraft,
    handlePointerDown,
    handlePointerMove,
    handlePointerUp,
    justFinishedDrawing,
  };
}
