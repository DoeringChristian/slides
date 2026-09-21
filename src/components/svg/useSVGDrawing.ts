import { useState, useCallback, useEffect, useRef } from 'react';
import { useEditorStore } from '../../store/editorStore';
import { usePresentationStore } from '../../store/presentationStore';
import { createTextElement, createShapeElement } from '../../utils/slideFactory';
import { computePointSnap, guideKey, type Guide } from '../../hooks/useAlignmentGuides';
import { getMarginLayout, getMarginBounds } from '../../utils/marginLayouts';
import { isShiftHeld, isMetaHeld } from '../../utils/keyboard';
import { pathBounds } from '../../utils/pathShapes';
import { getBindingTarget2, bindingFor, resolveBinding, bindDraftEndpoints } from '../../utils/connectorUtils';
import type { PathCurve, ConnectorBinding, SlideElement } from '../../types/presentation';

/** Click within this many slide units of the first vertex while drafting a
 *  polygon / bspline closes the path. Matches typical SVG editors. */
const POLY_CLOSE_RADIUS = 10;

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

/** Click-to-add path drafting (polygon, polyline, B-spline). Vertices are
 *  absolute slide coords; the previewX/Y is the rubber-band endpoint at
 *  the cursor. `curve` carries the drawing tool's smoothing default. */
export interface PolyDraftState {
  curve: PathCurve;
  vertices: number[];
  previewX: number;
  previewY: number;
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
  // Id of the bind target under the START of a drag-created line/arrow,
  // picked up at pointerdown. Kept in a ref so pointermove can keep the
  // start point raw (edge bindings preserve the exact point via focus/gap)
  // instead of re-running the grid/alignment snap over it every frame.
  const startTargetRef = useRef<string | null>(null);

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
      setPolyDraft(null);
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
    const bounds = pathBounds(vertices);
    const el = createShapeElement('path', {
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
      points: bounds.points,
      curve: draft.curve,
      closed,
      startBinding,
      endBinding,
    });
    addElement(activeSlideId, el);
    setSelectedElements([el.id]);
    setPolyDraft(null);
    setTool('select');
    justFinishedDrawing.current = true;
  }, [activeSlideId, addElement, setSelectedElements, setTool, getSlideElements]);

  const cancelPolyDraft = useCallback(() => {
    setPolyDraft(null);
    setTool('select');
  }, [setTool]);

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
    if (tool === 'polygon' || tool === 'bspline') {
      // Double-click on the in-progress draft → commit (open).
      if (e.detail >= 2 && polyDraftRef.current) {
        commitPolyDraft(false);
        return;
      }
      const draft = polyDraftRef.current;
      if (draft && draft.vertices.length >= 6) {
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
      const curve: PathCurve = tool === 'bspline' ? 'bspline3' : 'linear';
      setGuides(startSnap.guides);
      setPolyDraft((prev) => {
        if (!prev) {
          return {
            curve,
            vertices: [snappedStartX, snappedStartY],
            previewX: snappedStartX,
            previewY: snappedStartY,
          };
        }
        return {
          ...prev,
          vertices: [...prev.vertices, snappedStartX, snappedStartY],
        };
      });
      return;
    }

    let startX = snappedStartX;
    let startY = snappedStartY;
    let startGuides = startSnap.guides;

    // Line/arrow: a START over a bind target binds at commit (edge mode).
    // The raw pointer position wins over grid/alignment snap there — the
    // binding keeps the exact point via focus/gap, and a start inside the
    // silhouette gets pulled onto the outline at commit. Meta/Cmd
    // suppresses the target search entirely.
    startTargetRef.current = null;
    if ((tool === 'line' || tool === 'arrow') && !e.metaKey) {
      const target = getBindingTarget2(pos, getSlideElements(), '', useEditorStore.getState().zoom);
      if (target) {
        startX = pos.x;
        startY = pos.y;
        startGuides = [];
        startTargetRef.current = target.id;
        onConnectorHighlight?.(target.id);
      }
    }

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
      let previewX = snap.snapX ?? pos.x;
      let previewY = snap.snapY ?? pos.y;
      // Snap the rubber-band tip to the first vertex when within close
      // range — the user gets a visible cue that the next click closes.
      if (draft.vertices.length >= 6) {
        const dx = previewX - draft.vertices[0];
        const dy = previewY - draft.vertices[1];
        if (Math.hypot(dx, dy) <= POLY_CLOSE_RADIUS) {
          previewX = draft.vertices[0];
          previewY = draft.vertices[1];
        }
      }
      setGuides(snap.guides);
      setPolyDraft((prev) => prev ? { ...prev, previewX, previewY } : prev);
      return;
    }

    if (!drawState.isDrawing) return;

    const pos = screenToSVG(e.clientX, e.clientY);

    const { others, marginBounds, snappingEnabled } = getSnapContext();

    // Line/arrow: the moving END previews its binding — outside the target's
    // silhouette it stays under the cursor, inside it hugs the outline
    // (silhouette + gap preview). Binding preview wins over grid/alignment
    // snap; Meta/Cmd suppresses the target search.
    let endBindingSnap: { x: number; y: number; elementId: string } | null = null;
    if (tool === 'line' || tool === 'arrow') {
      const target = e.metaKey
        ? null
        : getBindingTarget2(pos, getSlideElements(), '', useEditorStore.getState().zoom);
      if (target) {
        const other = { x: drawState.snappedStartX, y: drawState.snappedStartY };
        const preview = resolveBinding(bindingFor(pos, target, other, 'edge'), target, other);
        endBindingSnap = { x: preview.x, y: preview.y, elementId: target.id };
      }
      onConnectorHighlight?.(endBindingSnap ? endBindingSnap.elementId : null);
    }

    // A start point over a bind target stays raw — don't grid-snap it.
    const startBound = startTargetRef.current !== null;

    if (snappingEnabled) {
      const currentSnap = endBindingSnap ? null : computePointSnap(pos, others, 5, marginBounds);
      const snappedCurrentX = endBindingSnap ? endBindingSnap.x : (currentSnap?.snapX ?? pos.x);
      const snappedCurrentY = endBindingSnap ? endBindingSnap.y : (currentSnap?.snapY ?? pos.y);

      const startSnap = startBound ? null : computePointSnap({ x: drawState.startX, y: drawState.startY }, others, 5, marginBounds);
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
        snappedStartX: startBound ? s.snappedStartX : (startSnap?.snapX ?? s.startX),
        snappedStartY: startBound ? s.snappedStartY : (startSnap?.snapY ?? s.startY),
      }));
    } else {
      setGuides([]);
      setDrawState((s) => ({
        ...s,
        currentX: pos.x,
        currentY: pos.y,
        snappedCurrentX: endBindingSnap ? endBindingSnap.x : pos.x,
        snappedCurrentY: endBindingSnap ? endBindingSnap.y : pos.y,
        snappedStartX: startBound ? s.snappedStartX : s.startX,
        snappedStartY: startBound ? s.snappedStartY : s.startY,
      }));
    }
  }, [drawState.isDrawing, drawState.startX, drawState.startY, drawState.snappedStartX, drawState.snappedStartY, getSnapContext, tool, getSlideElements, onConnectorHighlight]);

  const handlePointerUp = useCallback(() => {
    if (!drawState.isDrawing) return;

    const x = Math.min(drawState.snappedStartX, drawState.snappedCurrentX);
    const y = Math.min(drawState.snappedStartY, drawState.snappedCurrentY);
    const width = Math.abs(drawState.snappedCurrentX - drawState.snappedStartX);
    const height = Math.abs(drawState.snappedCurrentY - drawState.snappedStartY);

    setGuides([]);
    onConnectorHighlight?.(null);

    if (width < 5 && height < 5) {
      // Click without a drag — too small to materialize anything. Stay
      // in the drawing tool so the user can try again; we only reset to
      // select when a shape was actually committed.
      startTargetRef.current = null;
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
      // optional endArrow. Closed/start-arrow are off; toggle via panel.
      // Endpoints near a shape anchor bind to it (the live preview already
      // snapped them there); Meta/Cmd held at release suppresses binding.
      let sx = drawState.snappedStartX;
      let sy = drawState.snappedStartY;
      let ex = drawState.snappedCurrentX;
      let ey = drawState.snappedCurrentY;
      let startBinding: ConnectorBinding | null = null;
      let endBinding: ConnectorBinding | null = null;
      if (!isMetaHeld()) {
        const bound = bindDraftEndpoints([sx, sy, ex, ey], getSlideElements(), useEditorStore.getState().zoom);
        [sx, sy, ex, ey] = bound.absPoints as [number, number, number, number];
        startBinding = bound.startBinding;
        endBinding = bound.endBinding;
      }
      const el = createShapeElement('path', {
        x: sx,
        y: sy,
        width: Math.abs(ex - sx),
        height: Math.abs(ey - sy),
        points: [0, 0, ex - sx, ey - sy],
        curve: 'linear',
        closed: false,
        startArrow: false,
        endArrow: tool === 'arrow',
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

    startTargetRef.current = null;
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
