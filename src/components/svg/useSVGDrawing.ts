import { useState, useCallback, useEffect, useRef } from 'react';
import { useEditorStore } from '../../store/editorStore';
import { usePresentationStore } from '../../store/presentationStore';
import { createTextElement, createShapeElement } from '../../utils/slideFactory';
import { computePointSnap, type Guide } from '../../hooks/useAlignmentGuides';
import { getMarginLayout, getMarginBounds } from '../../utils/marginLayouts';
import { isShiftHeld } from '../../utils/keyboard';
import { pathBounds } from '../../utils/pathShapes';
import type { PathCurve } from '../../types/presentation';

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
export function useSVGDrawing() {
  const [drawState, setDrawState] = useState<DrawState>({
    startX: 0, startY: 0, currentX: 0, currentY: 0, isDrawing: false,
    snappedStartX: 0, snappedStartY: 0, snappedCurrentX: 0, snappedCurrentY: 0,
  });
  const [guides, setGuides] = useState<Guide[]>([]);
  const [polyDraft, setPolyDraft] = useState<PolyDraftState | null>(null);
  const polyDraftRef = useRef<PolyDraftState | null>(null);
  polyDraftRef.current = polyDraft;
  const justFinishedDrawing = useRef(false);

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

  const commitPolyDraft = useCallback((closed = false) => {
    const draft = polyDraftRef.current;
    if (!draft || draft.vertices.length < 4) {
      setPolyDraft(null);
      setTool('select');
      return;
    }
    const bounds = pathBounds(draft.vertices);
    const el = createShapeElement('path', {
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
      points: bounds.points,
      curve: draft.curve,
      closed,
    });
    addElement(activeSlideId, el);
    setSelectedElements([el.id]);
    setPolyDraft(null);
    // Stay in the drawing tool so the user can place another polygon /
    // bspline right away without re-picking the tool from the toolbar.
    justFinishedDrawing.current = true;
  }, [activeSlideId, addElement, setSelectedElements]);

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

    setGuides(startSnap.guides);
    setDrawState({
      startX: pos.x,
      startY: pos.y,
      currentX: pos.x,
      currentY: pos.y,
      isDrawing: true,
      snappedStartX,
      snappedStartY,
      snappedCurrentX: snappedStartX,
      snappedCurrentY: snappedStartY,
    });
  }, [tool, getSnapContext, commitPolyDraft]);

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

    if (snappingEnabled) {
      const currentSnap = computePointSnap(pos, others, 5, marginBounds);
      const snappedCurrentX = currentSnap.snapX ?? pos.x;
      const snappedCurrentY = currentSnap.snapY ?? pos.y;

      const startSnap = computePointSnap({ x: drawState.startX, y: drawState.startY }, others, 5, marginBounds);
      const allGuides = [...startSnap.guides, ...currentSnap.guides];
      const seen = new Set<string>();
      const uniqueGuides = allGuides.filter((g) => {
        const key = `${g.type}-${g.position}`;
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
        snappedStartX: startSnap.snapX ?? s.startX,
        snappedStartY: startSnap.snapY ?? s.startY,
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
  }, [drawState.isDrawing, drawState.startX, drawState.startY, getSnapContext]);

  const handlePointerUp = useCallback(() => {
    if (!drawState.isDrawing) return;

    const x = Math.min(drawState.snappedStartX, drawState.snappedCurrentX);
    const y = Math.min(drawState.snappedStartY, drawState.snappedCurrentY);
    const width = Math.abs(drawState.snappedCurrentX - drawState.snappedStartX);
    const height = Math.abs(drawState.snappedCurrentY - drawState.snappedStartY);

    setGuides([]);

    if (width < 5 && height < 5) {
      // Click without a drag — too small to materialize anything. Stay
      // in the drawing tool so the user can try again instead of
      // dropping back to select.
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
      const el = createShapeElement('path', {
        x: drawState.snappedStartX,
        y: drawState.snappedStartY,
        width,
        height,
        points: [0, 0, drawState.snappedCurrentX - drawState.snappedStartX, drawState.snappedCurrentY - drawState.snappedStartY],
        curve: 'linear',
        closed: false,
        startArrow: false,
        endArrow: tool === 'arrow',
      });
      addElement(activeSlideId, el);
      setSelectedElements([el.id]);
    } else if (['rect', 'ellipse', 'triangle', 'star'].includes(tool)) {
      const el = createShapeElement(tool as 'rect' | 'ellipse' | 'triangle' | 'star', { x, y, width, height });
      addElement(activeSlideId, el);
      setSelectedElements([el.id]);
    }

    // Stay in the drawing tool — the user usually wants to keep drawing
    // shapes of the same type rather than re-pick the tool every time.
    // Text is the one exception: createTextElement opens the edit
    // overlay; when the user finishes editing they'll naturally click
    // elsewhere, and re-entering text mode mid-flow would be jarring.
    if (tool === 'text') setTool('select');

    setDrawState({
      startX: 0, startY: 0, currentX: 0, currentY: 0, isDrawing: false,
      snappedStartX: 0, snappedStartY: 0, snappedCurrentX: 0, snappedCurrentY: 0,
    });
  }, [drawState, tool, activeSlideId, addElement, setTool, setSelectedElements, setEditingTextId]);

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
