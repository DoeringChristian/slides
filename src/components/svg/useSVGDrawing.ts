import { getActiveDoc } from '../../collab/yDocAdapter';
import { getActiveUndoManager } from '../../collab/activeUndo';
import { useCanvasGestureGuard } from './useCanvasGestureGuard';
import { isClientPointInCanvas } from '../../utils/canvasViewport';
import { composeUserShape, creationBox } from '../../utils/userShapeCreation';
import { screenPixelsToSlide } from '../../utils/screenSpace';
import { useState, useCallback, useEffect, useRef } from 'react';
import { useEditorStore } from '../../store/editorStore';
import { usePresentationStore } from '../../store/presentationStore';
import { markTextCreation } from '../../store/textEditSession';
import { DEFAULT_TEXT_STYLE } from '../../utils/constants';
import { createTextElement } from '../../utils/slideFactory';
import { computePointSnap, guideKey, type Guide } from '../../hooks/useAlignmentGuides';
import { getMarginLayout, getMarginBounds } from '../../utils/marginLayouts';
import { isMetaHeld, isShiftHeld } from '../../utils/keyboard';
import { DRAG_SLOP_MOUSE, DRAG_SLOP_TOUCH } from '../../utils/constants';
import { snapPathPoint, resolvedPointGuides, withVertexMagnets } from '../../utils/pathSnapping';
import { pathPointsInSlide, pathExtensionUpdate } from '../../utils/pathEditing';
import { pathBoundsFor } from '../../utils/pathShapes';
import { getBindingTarget2, bindDraftEndpoints, bindingDrop, bindingAimGuides, connectorDockCue, bindingAimPoint, supportsConnectorDocks, type ConnectorHighlightCallback, type BindingAimGuide } from '../../utils/connectorUtils';
import type { PathCurve, ConnectorBinding, SlideElement, ShapeElement } from '../../types/presentation';

/** Click within this many screen pixels of the first vertex while drafting a
 *  polygon / bspline closes the path. Matches typical SVG editors. */
const POLY_CLOSE_RADIUS = 10;

type DrawingPointer = Pick<React.PointerEvent, 'clientX' | 'clientY' | 'shiftKey' | 'ctrlKey' | 'metaKey'> & { pointerId?: number };
type ScreenToSVG = (clientX: number, clientY: number) => { x: number; y: number };

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

/** Click-to-add path drafting (polygon, polyline, through-point curve). Vertices are
 *  absolute slide coords; the previewX/Y is the rubber-band endpoint at
 *  the cursor. `curve` carries the drawing tool's smoothing default. */
export interface PolyDraftState {
  context?: { slideId: string; tool: import('../../types/presentation').Tool; request: ReturnType<typeof useEditorStore.getState>['pathExtension'] };
  curve: PathCurve;
  endHead?: 'triangle';
  extension?: { source: ShapeElement; end: 'start' | 'end' };
  previewElement?: ShapeElement;
  retainedStart?: ConnectorBinding | null;
  physicalStart?: { x: number; y: number };
  canClose?: boolean;
  vertices: number[];
  acceptedTerminal?: { x: number; y: number };
  previewX: number;
  previewY: number;
  /** Resolved display geometry; vertices above retain raw binding intent. */
  previewPoints?: number[];
  aimGuides?: BindingAimGuide[];
  previewClosed?: boolean;
}

function draftContextIsCurrent(draft: PolyDraftState): boolean {
  const editor = useEditorStore.getState();
  return !draft.context || (draft.context.slideId === editor.activeSlideId
    && draft.context.tool === editor.tool && draft.context.request === editor.pathExtension);
}

function effectiveDraftStart(draft: PolyDraftState, elements: SlideElement[], suppress: boolean): PolyDraftState {
  if (!draft.retainedStart || !draft.physicalStart) return draft;
  const target = elements.find(el => el.id === draft.retainedStart!.elementId && supportsConnectorDocks(el));
  const point = target && !suppress ? bindingAimPoint(draft.retainedStart, target) : draft.physicalStart;
  const vertices = draft.vertices.slice();
  vertices[0] = point.x; vertices[1] = point.y;
  return { ...draft, vertices, retainedStart: target ? draft.retainedStart : null };
}

/** Gesture-local identity only: authored coincident vertices are never deduplicated. */
function isDraftTerminal(draft: PolyDraftState, point: { x: number; y: number }): boolean {
  const i = draft.extension?.end === 'start' ? 0 : draft.vertices.length - 2;
  return Math.hypot(point.x - draft.vertices[i], point.y - draft.vertices[i + 1]) < 1e-6
    || !!draft.acceptedTerminal && Math.hypot(point.x - draft.acceptedTerminal.x, point.y - draft.acceptedTerminal.y) < 1e-6;
}

function addDraftVertex(draft: PolyDraftState, x: number, y: number): number[] {
  if (isDraftTerminal(draft, { x, y })) return draft.vertices;
  const vertices = draft.vertices.slice();
  const i = draft.extension?.end === 'start' ? 0 : vertices.length - 2;
  if (draft.acceptedTerminal) { vertices[i] = draft.acceptedTerminal.x; vertices[i + 1] = draft.acceptedTerminal.y; }
  return draft.extension?.end === 'start' ? [x, y, ...vertices] : [...vertices, x, y];
}

/** Resolve only the NEW terminal. The opposite binding and every original
 * vertex remain unchanged; the old terminal is now an unbound interior point. */
function resolveExtensionDraft(draft: PolyDraftState, raw: number[], elements: SlideElement[], zoom: number, suppress: boolean, preserveRay: boolean): Partial<ShapeElement> {
  const { source, end } = draft.extension!;
  const points = raw.slice();
  const idx = end === 'start' ? 0 : points.length - 2;
  const adjIdx = end === 'start' ? 2 : idx - 2;
  const point = { x: points[idx], y: points[idx + 1] }, adj = { x: points[adjIdx], y: points[adjIdx + 1] };
  const drop = suppress ? null : bindingDrop(point, adj, elements, source.id, zoom, preserveRay);
  if (drop) {
    points[idx] = drop.point.x; points[idx + 1] = drop.point.y;
  }
  return { ...pathExtensionUpdate(source, points, end), [end === 'start' ? 'startBinding' : 'endBinding']: drop?.binding ?? null };
}

/** Shared movement/click/release policy: binding priority, then compatible guides. */
function snapDraftPoint(point: { x: number; y: number }, origin: { x: number; y: number } | undefined,
  elements: SlideElement[], zoom: number, shift: boolean, suppress: boolean,
  alignment?: Parameters<typeof snapPathPoint>[4], excludeId = '') {
  const direction = snapPathPoint(point, origin ? [origin] : [], zoom, shift);
  const drop = !suppress && origin ? bindingDrop(direction.point, origin, elements, excludeId, zoom, shift) : null;
  const snapped = drop ? direction : snapPathPoint(point, origin ? [origin] : [], zoom, shift, alignment);
  const finalDrop = drop ?? (!suppress && origin ? bindingDrop(snapped.point, origin, elements, excludeId, zoom, shift) : null);
  return { ...snapped, drop: finalDrop };
}

/** Returning to an accepted terminal is not a new zero-length segment. Resolve
 * its retained raw intent against its ORIGINAL adjacency, including modifier replay. */
function snapPolyDraftPoint(point: { x: number; y: number }, draft: PolyDraftState,
  elements: SlideElement[], zoom: number, shift: boolean, suppress: boolean,
  alignment?: Parameters<typeof snapPathPoint>[4]) {
  const i = draft.extension?.end === 'start' ? 0 : draft.vertices.length - 2;
  const raw = { x: draft.vertices[i], y: draft.vertices[i + 1] };
  const snapped = isDraftTerminal(draft, point) ? null : snapDraftPoint(point, draft.acceptedTerminal ?? raw,
    elements, zoom, shift, suppress, alignment, draft.extension?.source.id);
  if (snapped && !isDraftTerminal(draft, snapped.point)) return snapped;
  const adjacentIndex = i === 0 ? 2 : i - 2;
  const adjacent = draft.vertices.length >= 4 ? { x: draft.vertices[adjacentIndex], y: draft.vertices[adjacentIndex + 1] } : undefined;
  return { point: raw,
    guides: adjacent && shift ? [{ type: 'direction' as const, x1: adjacent.x, y1: adjacent.y, x2: raw.x, y2: raw.y, destination: raw }] : [],
    drop: !suppress && adjacent ? bindingDrop(raw, adjacent, elements, draft.extension?.source.id ?? '', zoom, shift) : null };
}

/** Same-path vertex magnets for a draft: every ALREADY ACCEPTED vertex — the
 * first one above all — is an H/V alignment candidate for the point being
 * placed. Candidates are the VISIBLE vertices, so the terminal contributes
 * where it renders (a binding may have resolved it away from its raw intent)
 * and its guide line lands on the drawn geometry. */
function draftMagnets(draft: PolyDraftState, alignment?: Parameters<typeof snapPathPoint>[4]) {
  const vertices = draft.vertices.slice();
  if (draft.acceptedTerminal) {
    const i = draft.extension?.end === 'start' ? 0 : vertices.length - 2;
    vertices[i] = draft.acceptedTerminal.x;
    vertices[i + 1] = draft.acceptedTerminal.y;
  }
  return withVertexMagnets(alignment, vertices);
}

/** Snap once, then resolve topology from the coalesced vertex identity. A
 * remembered closed draft can become a two-point connector when alignment
 * returns to its accepted terminal. Restore its drop using the ORIGINAL
 * adjacency, without re-snapping or inventing a third vertex. */
function resolvePolyDraftPoint(point: { x: number; y: number }, draft: PolyDraftState,
  tool: import('../../types/presentation').Tool, elements: SlideElement[], zoom: number,
  shift: boolean, suppress: boolean, alignment?: Parameters<typeof snapPathPoint>[4]) {
  const prospectiveClosed = !draft.extension && !!composeUserShape(tool, { points: addDraftVertex(draft, point.x, point.y) }).closed;
  const snapped = snapPolyDraftPoint(point, draft, elements, zoom, shift, suppress || prospectiveClosed, draftMagnets(draft, alignment));
  const vertices = addDraftVertex(draft, snapped.point.x, snapped.point.y);
  const closed = !draft.extension && !!composeUserShape(tool, { points: vertices }).closed;
  if (prospectiveClosed && !closed && !suppress && vertices.length >= 4) {
    const i = vertices.length - 2;
    return { ...snapped, closed, drop: bindingDrop(
      { x: vertices[i], y: vertices[i + 1] }, { x: vertices[i - 2], y: vertices[i - 1] }, elements, '', zoom, shift) };
  }
  return { ...snapped, closed };
}

// Drawing hook — pointer-event based so it works for mouse, touch, and stylus.
// `onConnectorHighlight` outlines the element a drawn line/arrow endpoint
// would bind to (SVGSlideCanvas renders SVGConnectorHighlight from it).
export function useSVGDrawing(onConnectorHighlight?: ConnectorHighlightCallback) {
  const [drawState, setReactDrawState] = useState<DrawState>({
    startX: 0, startY: 0, currentX: 0, currentY: 0, isDrawing: false,
    snappedStartX: 0, snappedStartY: 0, snappedCurrentX: 0, snappedCurrentY: 0,
  });
  const drawStateRef = useRef(drawState);
  const setDrawState = useCallback((update: DrawState | ((state: DrawState) => DrawState)) => {
    const next = typeof update === 'function' ? update(drawStateRef.current) : update;
    drawStateRef.current = next;
    setReactDrawState(next);
  }, []);
  const [guides, setGuides] = useState<Guide[]>([]);
  const [polyDraft, setPolyDraft] = useState<PolyDraftState | null>(null);
  const polyDraftRef = useRef<PolyDraftState | null>(null);
  // eslint-disable-next-line react-hooks/refs -- latest-value ref pattern: mirrors state for pointer handlers; read only outside render
  polyDraftRef.current = polyDraft;
  const justFinishedDrawing = useRef(false);
  const lastPointerRef = useRef<{ event: DrawingPointer; screenToSVG: ScreenToSVG } | null>(null);
  const rawLineRef = useRef<number[] | null>(null);
  const startDockRef = useRef<ConnectorBinding | null | undefined>(undefined);
  const lineContextRef = useRef<{ slideId: string; tool: string; presentationId: string; doc: ReturnType<typeof getActiveDoc> } | null>(null);
  const initialPressRef = useRef<{ x: number; y: number; dragged: boolean; slop: number } | null>(null);

  const iconPressRef = useRef<{ pointerId: number; svg: SVGSVGElement } | null>(null);
  const { start: guardIcon, finish: finishIcon } = useCanvasGestureGuard();

  const { start: guardLine, finish: finishLine } = useCanvasGestureGuard();
  const invalidateLine = useCallback(() => {
    lastPointerRef.current = null;
    initialPressRef.current = null;
    rawLineRef.current = null;
    startDockRef.current = undefined;
    lineContextRef.current = null;
    polyDraftRef.current = null;
    setPolyDraft(null);
    setDrawState(s => ({ ...s, isDrawing: false }));
    setGuides([]);
    onConnectorHighlight?.(null);
  }, [onConnectorHighlight, setDrawState]);

  const tool = useEditorStore((s) => s.tool);
  const activeSlideId = useEditorStore((s) => s.activeSlideId);
  const setTool = useEditorStore((s) => s.setTool);
  const setSelectedElements = useEditorStore((s) => s.setSelectedElements);
  const setEditingTextId = useEditorStore((s) => s.setEditingTextId);
  const extensionRequest = useEditorStore((s) => s.pathExtension);
  const updateElement = usePresentationStore((s) => s.updateElement);
  const addElement = usePresentationStore((s) => s.addElement);

  useEffect(() => {
    if (!extensionRequest) {
      if (polyDraftRef.current && !draftContextIsCurrent(polyDraftRef.current)) {
        polyDraftRef.current = null;
        setPolyDraft(null);
        setGuides([]);
        onConnectorHighlight?.(null);
      }
      return;
    }
    const source = usePresentationStore.getState().presentation.slides[activeSlideId]?.elements[extensionRequest.elementId];
    if (!source || source.type !== 'shape' || source.shapeType !== 'path' || source.closed || source.locked) return;
    if (!guardLine(invalidateLine)) return;
    lastPointerRef.current = null;
    const vertices = pathPointsInSlide(source);
    const idx = extensionRequest.end === 'start' ? 0 : vertices.length - 2;
    const draft: PolyDraftState = {
      context: { slideId: activeSlideId, tool, request: extensionRequest },
      curve: source.curve ?? 'linear', canClose: false, vertices,
      previewX: vertices[idx], previewY: vertices[idx + 1],
      extension: { source, end: extensionRequest.end }, previewElement: source,
    };
    polyDraftRef.current = draft;
    // An explicit editor action starts this draft; no source geometry is mutated.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPolyDraft(draft);
  }, [extensionRequest, activeSlideId, tool, onConnectorHighlight, setDrawState, guardLine, invalidateLine]);

  const getSnapContext = useCallback((meta = isMetaHeld()) => {
    const { snapToGrid, marginLayoutId } = useEditorStore.getState();
    const slide = usePresentationStore.getState().presentation.slides[activeSlideId];
    if (!snapToGrid || meta || !slide) return { others: [], marginBounds: null, snappingEnabled: false };

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

  const commitPolyDraft = useCallback((closed = false, includePreview = false) => {
    const draft = polyDraftRef.current && effectiveDraftStart(polyDraftRef.current, getSlideElements(), isMetaHeld());
    const context = lineContextRef.current;
    const staleDocument = context && (context.presentationId !== usePresentationStore.getState().presentation.id || context.doc !== getActiveDoc());
    if (draft && (!draftContextIsCurrent(draft) || staleDocument)) {
      polyDraftRef.current = null;
      setPolyDraft(null);
      setGuides([]);
      onConnectorHighlight?.(null);
      return;
    }
    const appendPreview = draft && includePreview && !draft.previewClosed
      && !isDraftTerminal(draft, { x: draft.previewX, y: draft.previewY });
    const draftVertices = draft ? (appendPreview ? addDraftVertex(draft, draft.previewX, draft.previewY) : draft.vertices) : [];
    if (!draft || draftVertices.length < 4) {
      polyDraftRef.current = null;
      setPolyDraft(null);
      setGuides([]);
      onConnectorHighlight?.(null);
      setTool('select');
      return;
    }
    finishLine();
    if (draft.extension) {
      const { source } = draft.extension;
      const current = usePresentationStore.getState().presentation.slides[activeSlideId]?.elements[source.id];
      if (current?.type === 'shape' && !current.locked && !current.closed && draftVertices.length > (source.points?.length ?? 0)) {
        const preview = resolveExtensionDraft(draft, draftVertices, getSlideElements(), useEditorStore.getState().zoom, isMetaHeld(), isShiftHeld());
        updateElement(activeSlideId, source.id, preview);
        setSelectedElements([source.id]);
      }
      polyDraftRef.current = null;
      setPolyDraft(null);
      setGuides([]);
      onConnectorHighlight?.(null);
      setTool('select');
      justFinishedDrawing.current = true;
      return;
    }
    closed = closed || !!composeUserShape(useEditorStore.getState().tool, { points: draftVertices }).closed;
    // Bind the first/last vertex to a nearby shape anchor (open paths only —
    // a closed loop has no endpoints). Meta/Cmd suppresses binding.
    let vertices = draftVertices;
    let startBinding: ConnectorBinding | null = null;
    let endBinding: ConnectorBinding | null = null;
    if (!closed && !isMetaHeld()) {
      const bound = bindDraftEndpoints(vertices, getSlideElements(), useEditorStore.getState().zoom, isShiftHeld(), draft.retainedStart);
      vertices = bound.absPoints;
      startBinding = bound.startBinding;
      endBinding = bound.endBinding;
    }
    const bounds = pathBoundsFor(vertices, draft.curve, closed);
    const el = composeUserShape(useEditorStore.getState().tool, {
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
    polyDraftRef.current = null;
    setPolyDraft(null);
    setGuides([]);
    onConnectorHighlight?.(null);
    setTool('select');
    justFinishedDrawing.current = true;
  }, [activeSlideId, addElement, updateElement, setSelectedElements, setTool, getSlideElements, onConnectorHighlight, finishLine]);

  const clearIconPlacement = useCallback(() => {
    finishIcon();
    iconPressRef.current = null;
    lastPointerRef.current = null;
    initialPressRef.current = null;
    setDrawState(s => ({ ...s, isDrawing: false }));
    setGuides([]);
  }, [finishIcon, setDrawState]);

  const cancelPolyDraft = useCallback(() => {
    finishLine();
    finishIcon();
    iconPressRef.current = null;
    lastPointerRef.current = null;
    initialPressRef.current = null;
    rawLineRef.current = null;
    startDockRef.current = undefined;
    lineContextRef.current = null;
    setDrawState((s) => ({ ...s, isDrawing: false }));
    if (polyDraftRef.current?.extension) setSelectedElements([polyDraftRef.current.extension.source.id]);
    polyDraftRef.current = null;
    setPolyDraft(null);
    setGuides([]);
    onConnectorHighlight?.(null);
    setTool('select');
  }, [setTool, setSelectedElements, onConnectorHighlight, setDrawState, finishIcon, finishLine]);

  // Tool/slide changes invalidate pending dock intent, including idle hover.
  useEffect(() => {
    startDockRef.current = undefined;
    lineContextRef.current = null;
    lastPointerRef.current = null;
    setDrawState(s => ({ ...s, isDrawing: false }));
    onConnectorHighlight?.(null);
  }, [tool, activeSlideId, setDrawState, onConnectorHighlight]);

  useEffect(() => {
    if (tool !== 'icon' && tool !== 'line' && tool !== 'arrow') return;
    const cancel = () => cancelPolyDraft();
    window.addEventListener('blur', cancel);
    window.addEventListener('contextmenu', cancel);
    return () => {
      window.removeEventListener('blur', cancel);
      window.removeEventListener('contextmenu', cancel);
    };
  }, [tool, cancelPolyDraft]);

  // Enter / Escape during a poly draft.
  useEffect(() => {
    if (!polyDraft && !drawState.isDrawing) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter' && polyDraft) {
        e.preventDefault();
        e.stopPropagation();
        commitPolyDraft(false, true);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        cancelPolyDraft();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [polyDraft, drawState.isDrawing, commitPolyDraft, cancelPolyDraft]);

  const handlePointerDown = useCallback((
    e: React.PointerEvent,
    screenToSVG: (clientX: number, clientY: number) => { x: number; y: number }
  ) => {
    if (tool === 'select') return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (tool === 'icon') {
      if (iconPressRef.current) { cancelPolyDraft(); return; }
      const svg = e.currentTarget as SVGSVGElement;
      if (!isClientPointInCanvas(svg, e.clientX, e.clientY)) return;
      if (!guardIcon(clearIconPlacement)) return;
      iconPressRef.current = { pointerId: e.pointerId, svg };
    }

    lastPointerRef.current = { event: { clientX: e.clientX, clientY: e.clientY, shiftKey: e.shiftKey, ctrlKey: e.ctrlKey, metaKey: e.metaKey }, screenToSVG };
    const pos = screenToSVG(e.clientX, e.clientY);

    const { others, marginBounds, snappingEnabled } = getSnapContext(e.metaKey);
    const startSnap = snappingEnabled ? computePointSnap(pos, others, screenPixelsToSlide(5, useEditorStore.getState().zoom), marginBounds) : { snapX: null, snapY: null, guides: [] };
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
      const draft = polyDraftRef.current && effectiveDraftStart(polyDraftRef.current, getSlideElements(), e.metaKey);
      if (!e.metaKey && draft && draft.canClose !== false && draft.vertices.length >= 6) {
        // Close detection uses the RAW cursor position, not the grid/element
        // snap — `computePointSnap` may have pulled the cursor to a different
        // element's edge, making it look further from the first vertex than
        // it really is on screen.
        const dx = pos.x - draft.vertices[0];
        const dy = pos.y - draft.vertices[1];
        if (Math.hypot(dx, dy) <= screenPixelsToSlide(POLY_CLOSE_RADIUS, useEditorStore.getState().zoom)) {
          commitPolyDraft(true);
          return;
        }
      }
      const curve: PathCurve = draft?.curve ?? composeUserShape(tool).curve ?? 'linear';
      const alignment = snappingEnabled && !(!draft && !e.shiftKey && !e.metaKey && getBindingTarget2(pos, getSlideElements(), '', useEditorStore.getState().zoom)) ? { others, marginBounds } : undefined;
      const magnet = draft
        ? resolvePolyDraftPoint(pos, draft, tool, getSlideElements(), useEditorStore.getState().zoom, e.shiftKey, e.metaKey, alignment)
        : { ...snapDraftPoint(pos, undefined, getSlideElements(), useEditorStore.getState().zoom, e.shiftKey, e.metaKey, alignment),
          closed: !!composeUserShape(tool, { points: [pos.x, pos.y] }).closed };
      const closed = magnet.closed;
      onConnectorHighlight?.(magnet.drop?.target.id ?? null, magnet.drop?.dock);
      const vx = magnet.point.x, vy = magnet.point.y;
      // The first click of a double-click already materialized the endpoint.
      // Ignore a repeated terminal vertex (including a stationary finish).
      const repeated = draft && isDraftTerminal(draft, magnet.point);
      const vertices = repeated ? draft.vertices : draft ? addDraftVertex(draft, vx, vy) : [vx, vy];
      const previewPoints = (e.metaKey || closed) ? vertices : bindDraftEndpoints(vertices, getSlideElements(), useEditorStore.getState().zoom, e.shiftKey, draft?.retainedStart).absPoints;
      const next: PolyDraftState = { ...draft, curve, vertices, previewX: vx, previewY: vy, previewPoints, previewClosed: false,
        previewElement: draft?.extension ? { ...draft.extension.source, ...resolveExtensionDraft(draft, vertices, getSlideElements(), useEditorStore.getState().zoom, e.metaKey, e.shiftKey) } : undefined };
      const draftBindings = !e.metaKey && !closed ? bindDraftEndpoints(vertices, getSlideElements(), useEditorStore.getState().zoom, e.shiftKey, draft?.retainedStart) : null;
      next.aimGuides = next.previewElement
        ? bindingAimGuides(pathPointsInSlide(next.previewElement), next.previewElement.startBinding, next.previewElement.endBinding, getSlideElements())
        : draftBindings ? bindingAimGuides(previewPoints, draftBindings.startBinding, draftBindings.endBinding, getSlideElements()) : [];
      const visible = next.previewElement ? pathPointsInSlide(next.previewElement) : previewPoints;
      const terminal = draft?.extension?.end === 'start' ? 0 : visible.length - 2;
      next.acceptedTerminal = repeated ? draft.acceptedTerminal : { x: visible[terminal], y: visible[terminal + 1] };
      polyDraftRef.current = next;
      setGuides(resolvedPointGuides(magnet.guides, { x: visible[terminal], y: visible[terminal + 1] }));
      setPolyDraft(next);
      return;
    }

    if ((tool === 'line' || tool === 'arrow') && !guardLine(invalidateLine)) return;
    startDockRef.current = undefined;
    if (tool === 'line' || tool === 'arrow') lineContextRef.current = {
      slideId: activeSlideId, tool, presentationId: usePresentationStore.getState().presentation.id, doc: getActiveDoc(),
    };
    let startX = snappedStartX;
    let startY = snappedStartY;
    let startGuides = startSnap.guides;

    // Binding intent must use the raw start point, before alignment snap.
    // Meta/Cmd suppresses the target search entirely.
    if ((tool === 'line' || tool === 'arrow') && !composeUserShape(tool).closed && !e.metaKey) {
      const target = getBindingTarget2(pos, getSlideElements(), '', useEditorStore.getState().zoom);
      if (target) {
        const dock = connectorDockCue(pos, target, useEditorStore.getState().zoom);
        startDockRef.current = dock?.active ? dock.binding : undefined;
        startX = dock?.active ? dock.point.x : pos.x;
        startY = dock?.active ? dock.point.y : pos.y;
        startGuides = [];
        onConnectorHighlight?.(target.id, dock);
      }
    }

    initialPressRef.current = { x: e.clientX, y: e.clientY, dragged: false, slop: e.pointerType === 'touch' ? DRAG_SLOP_TOUCH : DRAG_SLOP_MOUSE };
    try { (e.currentTarget as Element).setPointerCapture(e.pointerId); } catch { /* window/canvas still handles release */ }
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
      preserveAspect: e.shiftKey,
    });
  }, [tool, activeSlideId, getSnapContext, commitPolyDraft, getSlideElements, onConnectorHighlight, setDrawState, guardIcon, clearIconPlacement, cancelPolyDraft, guardLine, invalidateLine]);

  const handlePointerMove = useCallback((
    e: DrawingPointer,
    screenToSVG: ScreenToSVG
  ) => {
    if (tool === 'icon' && iconPressRef.current && e.pointerId !== undefined && e.pointerId !== iconPressRef.current.pointerId) return;
    lastPointerRef.current = { event: { clientX: e.clientX, clientY: e.clientY, shiftKey: e.shiftKey, ctrlKey: e.ctrlKey, metaKey: e.metaKey }, screenToSVG };
    const context = lineContextRef.current;
    if (context && (context.slideId !== useEditorStore.getState().activeSlideId || context.tool !== useEditorStore.getState().tool
      || context.presentationId !== usePresentationStore.getState().presentation.id || context.doc !== getActiveDoc())) {
      cancelPolyDraft();
      return;
    }
    // Update the rubber-band end of an in-progress polygon / bspline draft.
    if (polyDraftRef.current) {
      const draft = effectiveDraftStart(polyDraftRef.current, getSlideElements(), e.metaKey);
      const pos = screenToSVG(e.clientX, e.clientY);
      const { others, marginBounds, snappingEnabled } = getSnapContext(e.metaKey);
      const magnet = resolvePolyDraftPoint(pos, draft, tool, getSlideElements(), useEditorStore.getState().zoom, e.shiftKey, e.metaKey,
        snappingEnabled ? { others, marginBounds } : undefined);
      const closed = magnet.closed;
      let previewX = magnet.point.x, previewY = magnet.point.y;
      const previewClosed = !e.metaKey && draft.canClose !== false && draft.vertices.length >= 6
        && Math.hypot(pos.x - draft.vertices[0], pos.y - draft.vertices[1]) <= screenPixelsToSlide(POLY_CLOSE_RADIUS, useEditorStore.getState().zoom);
      if (previewClosed) { previewX = draft.vertices[0]; previewY = draft.vertices[1]; }
      const atLast = isDraftTerminal(draft, { x: previewX, y: previewY });
      const raw = previewClosed || atLast ? draft.vertices : addDraftVertex(draft, previewX, previewY);
      const bound = previewClosed || closed || e.metaKey ? null : bindDraftEndpoints(raw, getSlideElements(), useEditorStore.getState().zoom, e.shiftKey, draft.retainedStart);
      const previewPoints = bound?.absPoints ?? raw;
      onConnectorHighlight?.(!previewClosed ? magnet.drop?.target.id ?? null : null, !previewClosed ? magnet.drop?.dock : null);

      const next = { ...draft, previewX, previewY, previewPoints, previewClosed,
        aimGuides: bound ? bindingAimGuides(previewPoints, bound.startBinding, bound.endBinding, getSlideElements()) : [],
        previewElement: draft.extension ? { ...draft.extension.source, ...resolveExtensionDraft(draft, raw, getSlideElements(), useEditorStore.getState().zoom, e.metaKey, e.shiftKey) } : undefined };
      if (next.previewElement) next.aimGuides = bindingAimGuides(pathPointsInSlide(next.previewElement), next.previewElement.startBinding, next.previewElement.endBinding, getSlideElements());
      const visible = next.previewElement ? pathPointsInSlide(next.previewElement) : previewPoints;
      const terminal = draft.extension?.end === 'start' ? 0 : visible.length - 2;
      const adjacent = terminal === 0 ? 2 : terminal - 2;
      setGuides(previewClosed ? [] : resolvedPointGuides(magnet.guides, { x: visible[terminal], y: visible[terminal + 1] }, { x: visible[adjacent], y: visible[adjacent + 1] }));
      polyDraftRef.current = next;
      setPolyDraft(next);
      return;
    }

    if (!drawStateRef.current.isDrawing) {
      if (tool === 'line' || tool === 'arrow') {
        const pos = screenToSVG(e.clientX, e.clientY);
        const target = !e.metaKey && !composeUserShape(tool).closed && getBindingTarget2(pos, getSlideElements(), '', useEditorStore.getState().zoom);
        onConnectorHighlight?.(target ? target.id : null, target ? connectorDockCue(pos, target, useEditorStore.getState().zoom) : null);
      }
      return;
    }
    const press = initialPressRef.current;
    if (press && Math.hypot(e.clientX - press.x, e.clientY - press.y) >= press.slop) press.dragged = true;

    const pos = screenToSVG(e.clientX, e.clientY);

    const { others, marginBounds, snappingEnabled } = getSnapContext(e.metaKey);

    if (tool === 'icon') {
      const snap = snappingEnabled ? computePointSnap(pos, others, screenPixelsToSlide(5, useEditorStore.getState().zoom), marginBounds) : null;
      setGuides(snap?.guides ?? []);
      setDrawState(s => ({ ...s, currentX: pos.x, currentY: pos.y,
        snappedCurrentX: snap?.snapX ?? pos.x, snappedCurrentY: snap?.snapY ?? pos.y }));
      return;
    }

    // Resolve both ends from the SAME raw snapshot for preview and commit.
    // Never infer pin intent from a previously snapped silhouette point.
    if (tool === 'line' || tool === 'arrow') {
      const elements = getSlideElements();
      const zoom = useEditorStore.getState().zoom;
      const latched = startDockRef.current;
      const dockTarget = latched && elements.find(el => el.id === latched.elementId && supportsConnectorDocks(el));
      if (latched && !dockTarget) startDockRef.current = null;
      const start = !e.metaKey && latched && dockTarget ? bindingAimPoint(latched, dockTarget)
        : { x: drawStateRef.current.startX, y: drawStateRef.current.startY };
      const closed = !!composeUserShape(tool).closed;
      const startTarget = !closed && !e.metaKey && getBindingTarget2(start, elements, '', zoom);
      const startSnap = snappingEnabled && !startTarget ? computePointSnap(start, others, screenPixelsToSlide(5, useEditorStore.getState().zoom), marginBounds) : null;
      const sx = startSnap?.snapX ?? start.x, sy = startSnap?.snapY ?? start.y;
      const magnet = snapDraftPoint(pos, { x: sx, y: sy }, elements, zoom, e.shiftKey, e.metaKey || closed,
        snappingEnabled ? { others, marginBounds } : undefined);
      const raw = [sx, sy, magnet.point.x, magnet.point.y];
      rawLineRef.current = raw;
      const bound = closed || e.metaKey ? null : bindDraftEndpoints(raw, elements, zoom, e.shiftKey, startDockRef.current);
      const resolved = bound?.absPoints ?? raw;
      onConnectorHighlight?.(magnet.drop?.target.id ?? null, magnet.drop?.dock);
      setGuides([...resolvedPointGuides(startSnap?.guides ?? [], { x: resolved[0], y: resolved[1] }), ...resolvedPointGuides(magnet.guides, { x: resolved[2], y: resolved[3] }, { x: resolved[0], y: resolved[1] })]);
      setDrawState((s) => ({ ...s, currentX: pos.x, currentY: pos.y,
        aimGuides: bound ? bindingAimGuides(resolved, bound.startBinding, bound.endBinding, elements) : [],
        snappedStartX: resolved[0], snappedStartY: resolved[1],
        snappedCurrentX: resolved[2], snappedCurrentY: resolved[3],
      }));
      return;
    }

    if (snappingEnabled) {
      const currentSnap = computePointSnap(pos, others, screenPixelsToSlide(5, useEditorStore.getState().zoom), marginBounds);
      const snappedCurrentX = (currentSnap.snapX ?? pos.x);
      const snappedCurrentY = (currentSnap.snapY ?? pos.y);

      const startSnap = computePointSnap({ x: drawStateRef.current.startX, y: drawStateRef.current.startY }, others, screenPixelsToSlide(5, useEditorStore.getState().zoom), marginBounds);
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
        preserveAspect: e.shiftKey,
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
        preserveAspect: e.shiftKey,
        snappedCurrentX: pos.x,
        snappedCurrentY: pos.y,
        snappedStartX: s.startX,
        snappedStartY: s.startY,
      }));
    }
  }, [getSnapContext, tool, getSlideElements, onConnectorHighlight, setDrawState, cancelPolyDraft]);

  // Re-evaluate the live candidate from physical coordinates on modifier-only
  // changes. Accepted draft vertices are never rewritten by this replay.
  useEffect(() => {
    if (!drawState.isDrawing && !polyDraft && tool !== 'line' && tool !== 'arrow') return;
    const onModifier = (e: KeyboardEvent) => {
      if (!['Shift', 'Control', 'Meta'].includes(e.key)) return;
      const last = lastPointerRef.current;
      if (last) handlePointerMove({ ...last.event, shiftKey: e.shiftKey, ctrlKey: e.ctrlKey, metaKey: e.metaKey }, last.screenToSVG);
    };
    window.addEventListener('keydown', onModifier);
    window.addEventListener('keyup', onModifier);
    return () => {
      window.removeEventListener('keydown', onModifier);
      window.removeEventListener('keyup', onModifier);
    };
  }, [drawState.isDrawing, polyDraft, tool, handlePointerMove]);

  // Viewport changes do not produce pointermove. Replay only the owned icon
  // placement, never restart a cancelled gesture or touch other drawing tools.
  const refreshIconPlacement = useCallback((screenToSVG: ScreenToSVG) => {
    if (!iconPressRef.current || !drawStateRef.current.isDrawing) return;
    const last = lastPointerRef.current;
    if (last) handlePointerMove(last.event, screenToSVG);
  }, [handlePointerMove]);

  const handlePointerUp = useCallback((event?: DrawingPointer, screenToSVG?: ScreenToSVG) => {
    // Multipoint clicks already accepted their vertex on pointerdown. Replaying
    // against that NEW terminal on release invents another rubber-band point.
    if (!drawStateRef.current.isDrawing || polyDraftRef.current) return;
    const last = lastPointerRef.current;
    if (tool === 'icon') {
      const press = iconPressRef.current;
      if (!press || (event?.pointerId !== undefined && event.pointerId !== press.pointerId)) return;
      const pointer = event ?? last?.event;
      const hit = pointer && press.svg.ownerDocument.elementFromPoint(pointer.clientX, pointer.clientY);
      if (!pointer || !isClientPointInCanvas(press.svg, pointer.clientX, pointer.clientY) || !hit || !press.svg.contains(hit)) {
        cancelPolyDraft();
        return;
      }
      finishIcon();
      iconPressRef.current = null;
    }
    if (event && last) handlePointerMove(event, tool === 'icon' && screenToSVG ? screenToSVG : last.screenToSVG);
    const current = drawStateRef.current;
    if (!current.isDrawing || polyDraftRef.current) return;
    const isLineTool = tool === 'line' || tool === 'arrow';
    if (isLineTool && !initialPressRef.current?.dragged) {
      const raw = rawLineRef.current ?? [current.startX, current.startY];
      const draft: PolyDraftState = {
        curve: composeUserShape(tool).curve ?? 'linear', canClose: false,
        context: { slideId: activeSlideId, tool, request: null },
        retainedStart: startDockRef.current,
        physicalStart: { x: current.startX, y: current.startY },
        vertices: raw.slice(0, 2), previewX: raw[0], previewY: raw[1],
      };
      polyDraftRef.current = draft;
      setPolyDraft(draft);
      setDrawState((s) => ({ ...s, isDrawing: false }));
      setGuides([]);
      return;
    }

    const { x, y, width, height } = creationBox(tool, current.snappedStartX, current.snappedStartY, current.snappedCurrentX, current.snappedCurrentY, current.preserveAspect);

    setGuides([]);
    onConnectorHighlight?.(null);

    if (tool !== 'text' && !isLineTool && width < 5 && height < 5) {
      // Click without a drag — too small to materialize anything. Stay
      // in the drawing tool so the user can try again; we only reset to
      // select when a shape was actually committed.
      setDrawState({
        startX: 0, startY: 0, currentX: 0, currentY: 0, isDrawing: false,
        snappedStartX: 0, snappedStartY: 0, snappedCurrentX: 0, snappedCurrentY: 0,
      });
      return;
    }

    finishLine();
    justFinishedDrawing.current = true;

    if (tool === 'text') {
      const click = width < 5 && height < 5;
      const el = createTextElement({
        x, y, text: '', textSizing: click ? 'auto-content' : 'user-width',
        width: click ? 1 : Math.max(width, 1),
        height: DEFAULT_TEXT_STYLE.fontSize * DEFAULT_TEXT_STYLE.lineHeight,
      });
      markTextCreation(activeSlideId, el.id);
      addElement(activeSlideId, el);
      setSelectedElements([el.id]);
      setEditingTextId(el.id);
    } else if (tool === 'line' || tool === 'arrow') {
      // Two-point line/arrow gestures stay open while retaining remembered
      // curve, paint and heads. Multipoint drafts can retain closed topology.
      // Endpoints near a shape anchor bind to it (the live preview already
      // snapped them there); Meta/Cmd at release suppresses both bindings.
      let [sx, sy, ex, ey] = rawLineRef.current ?? [current.snappedStartX, current.snappedStartY, current.snappedCurrentX, current.snappedCurrentY];
      let startBinding: ConnectorBinding | null = null;
      let endBinding: ConnectorBinding | null = null;
      if (!composeUserShape(tool).closed && !isMetaHeld()) {
        const bound = bindDraftEndpoints([sx, sy, ex, ey], getSlideElements(), useEditorStore.getState().zoom, lastPointerRef.current?.event.shiftKey ?? isShiftHeld(), startDockRef.current);
        [sx, sy, ex, ey] = bound.absPoints as [number, number, number, number];
        startBinding = bound.startBinding;
        endBinding = bound.endBinding;
      }
      const preset = composeUserShape(tool);
      const el = composeUserShape(tool, {
        ...pathBoundsFor([sx, sy, ex, ey], preset.curve ?? 'linear', !!preset.closed),
        startBinding,
        endBinding,
      });
      addElement(activeSlideId, el);
      setSelectedElements([el.id]);
    } else if (['rect', 'ellipse', 'triangle', 'star', 'icon'].includes(tool)) {
      const el = composeUserShape(tool, { x, y, width, height });
      // A placement is one discrete undo, never part of Yjs's typing window.
      const undo = tool === 'icon' ? getActiveUndoManager() : null;
      undo?.stopCapturing();
      addElement(activeSlideId, el);
      undo?.stopCapturing();
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
  }, [handlePointerMove, tool, activeSlideId, addElement, setTool, setSelectedElements, setEditingTextId, getSlideElements, onConnectorHighlight, setDrawState, cancelPolyDraft, finishIcon, finishLine]);

  const handlePointerLeave = useCallback(() => {
    if (drawStateRef.current.isDrawing || polyDraftRef.current) return;
    lastPointerRef.current = null;
    onConnectorHighlight?.(null);
  }, [onConnectorHighlight]);

  return {
    drawState,
    guides,
    polyDraft: polyDraft && draftContextIsCurrent(polyDraft) ? polyDraft : null,
    commitPolyDraft,
    cancelPolyDraft,
    handlePointerDown,
    handlePointerMove,
    handlePointerLeave,
    handlePointerUp,
    refreshIconPlacement,
    justFinishedDrawing,
  };
}
