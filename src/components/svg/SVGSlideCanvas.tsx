import { SVGTextAutoFitHandle } from './SVGTextAutoFitHandle';
import { canAutoFitText } from '../../utils/textAutoFit';
import { textHoverOwner } from '../../utils/textHoverOwner';
import { autoFitText, hasPendingTextFinish, subscribeTextFinishes, textFinishRevision } from '../../store/textEditSession';
import { getActiveDoc } from '../../collab/yDocAdapter';
import { boundTextMeasurementKey } from '../../utils/boundTextLayout';
import { readSlideForMutation } from '../../store/currentMutation';
import { updateShapeStyleFromCurrent } from '../../store/shapeStyleMutation';
import { planElementTranslation } from '../../utils/elementTranslation';
import { screenPixelsToSlide } from '../../utils/screenSpace';
import React, { useSyncExternalStore, useRef, useCallback, useMemo, useState, useEffect, useLayoutEffect, type DragEvent } from 'react';
import { useEditorStore } from '../../store/editorStore';
import { usePresentationStore } from '../../store/presentationStore';
import { useActiveSlide, useObjectElements } from '../../store/selectors';
import { useCoarsePointer } from '../../hooks/useCoarsePointer';
import { usePointerGesture, type GestureFrame } from '../../hooks/usePointerGesture';
import { SVGBackground } from './SVGBackground';
import { SVGElementRenderer } from './SVGElementRenderer';
import { SVGGridOverlay } from './SVGGridOverlay';
import { SVGAlignmentGuides } from './SVGAlignmentGuides';
import { SVGMarginGuides } from './SVGMarginGuides';
import { SVGHoverOverlay } from './SVGHoverOverlay';
import { type ConnectorDockCue, supportsConnectorDocks } from '../../utils/connectorUtils';
import { SVGConnectorHighlight } from './SVGConnectorHighlight';
import { SVGDrawingPreview, SVGPolyDraftPreview } from './SVGDrawingPreview';
import { projectGestureScene, type GesturePatch } from '../../utils/gestureProjection';
import { readGestureSlide } from './useCanvasGestureGuard';
import { SVGSelectionDrag } from './SVGSelectionDrag';
import { SVGSelectionTransformer } from './SVGSelectionTransformer';
import { SVGPeerSelectionOverlay } from './SVGPeerSelectionOverlay';
import { SVGPathHandles } from './SVGPathHandles';
import { SVGCornerRadiusHandle } from './SVGCornerRadiusHandle';
import { useSVGDrag } from './useSVGDrag';
import { useSVGDrawing } from './useSVGDrawing';
import { TextEditOverlay } from '../canvas/TextEditOverlay';
import { CropOverlay } from '../canvas/CropOverlay';
import { SelectionActionBar } from '../canvas/SelectionActionBar';
import { computeGuides } from '../../hooks/useAlignmentGuides';
import { getMarginLayout, getMarginBounds } from '../../utils/marginLayouts';
import { snapToGrid as snapToGridFn } from '../../utils/geometry';
import { isShiftHeld, isMetaHeld } from '../../utils/keyboard';
import { SLIDE_WIDTH, SLIDE_HEIGHT, CANVAS_PADDING } from '../../utils/constants';
import { loadImageFile, loadPdfFile, loadVideoFile, duplicateElements } from '../../utils/slideFactory';
import { isPointOnTextContent } from '../../utils/textHitTest';
import {
  attachLabelMasks,
  createBoundLabel,
  expandWithBoundTexts,
  findBoundText,
  fitLabelToDoc,
  labelWrapWidthFor,
} from '../../utils/syncDependents';
import type { ShapeElement, SlideElement, TextElement } from '../../types/presentation';
import { layoutSvgText, type SvgTextDoc } from '../../utils/textLayout';
import type { Guide } from '../../hooks/useAlignmentGuides';

// Transform a slide-space point into an element's local coordinates (handle rotation)
function toLocalPoint(el: SlideElement, pos: { x: number; y: number }): { x: number; y: number } {
  const centerX = el.x + el.width / 2;
  const centerY = el.y + el.height / 2;
  const relCenterX = pos.x - centerX;
  const relCenterY = pos.y - centerY;
  const radians = -(el.rotation || 0) * Math.PI / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return {
    x: relCenterX * cos - relCenterY * sin + el.width / 2,
    y: relCenterX * sin + relCenterY * cos + el.height / 2,
  };
}

/**
 * Hug-the-text refit for one bound label (Excalidraw model): lay the label's
 * text out at the container's wrap width (module-level layout cache — free
 * when already measured; the SAME layoutSvgText pipeline that renders it, so
 * LaTeX spans contribute their MathJax-measured extents to doc.width/height),
 * then apply the pure fitLabelToDoc box math through the store. Store state
 * is re-read after the async layout hop — the label may have been deleted or
 * mutated in between.
 */
function refitBoundLabel(textId: string, canRefit: () => boolean): void {
  if (!canRefit()) return;
  const slideId = useEditorStore.getState().activeSlideId;
  if (hasPendingTextFinish(slideId, textId)) return;
  const currentSlide = readSlideForMutation(slideId);
  const label = currentSlide?.elements[textId];
  if (!label || label.type !== 'text') return;
  const cid = (label as TextElement).containerId;
  if (!cid) return;
  const container = currentSlide.elements[cid];
  if (!container) return;

  const text = (label as TextElement).text || '';
  const style = (label as TextElement).style;
  const activeDoc = getActiveDoc();
  const presentationId = usePresentationStore.getState().presentation.id;
  const signature = boundTextMeasurementKey(container, label);
  layoutSvgText(text, style, labelWrapWidthFor(container, label)).then(
    (doc) => {
      if (!canRefit() || hasPendingTextFinish(slideId, textId)) return;
      const s = readSlideForMutation(slideId);
      const lbl = s?.elements[textId];
      const cont = s?.elements[cid];
      if (!lbl || lbl.type !== 'text' || !cont) return;
      const cur = lbl as TextElement;
      if (useEditorStore.getState().activeSlideId !== slideId ||
          getActiveDoc() !== activeDoc || usePresentationStore.getState().presentation.id !== presentationId ||
          boundTextMeasurementKey(cont, lbl) !== signature) return;
      const fit = fitLabelToDoc(cont, cur, doc);
      const updates: Array<{ elementId: string; changes: Partial<SlideElement> }> = [];
      if (fit.label) updates.push({ elementId: textId, changes: fit.label });
      if (fit.container) updates.push({ elementId: cid, changes: fit.container });
      if (updates.length > 0) {
        usePresentationStore.getState().updateElements(slideId, updates, true);
      }
    },
    () => {}, // layout failure → renderer falls back too; keep the old box
  );
}

export const SVGSlideCanvas: React.FC = () => {
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const zoom = useEditorStore((s) => s.zoom);
  const setZoom = useEditorStore((s) => s.setZoom);
  const tool = useEditorStore((s) => s.tool);
  const selectedElementIds = useEditorStore((s) => s.selectedElementIds);
  const setSelectedElements = useEditorStore((s) => s.setSelectedElements);
  const clearSelection = useEditorStore((s) => s.clearSelection);
  const setEditingTextId = useEditorStore((s) => s.setEditingTextId);
  useSyncExternalStore(subscribeTextFinishes, textFinishRevision, textFinishRevision);
  const editingTextId = useEditorStore((s) => s.editingTextId);
    const activeSlideId = useEditorStore((s) => s.activeSlideId);
  const showGrid = useEditorStore((s) => s.showGrid);
  const gridSize = useEditorStore((s) => s.gridSize);
  const hoveredObjectId = useEditorStore((s) => s.hoveredObjectId);
  const setHoveredObjectId = useEditorStore((s) => s.setHoveredObjectId);
  // snapToGrid setting is read inside the drag handlers via useEditorStore.getState()
  const updateElement = usePresentationStore((s) => s.updateElement);
  const updateElements = usePresentationStore((s) => s.updateElements);
  const unhideElement = usePresentationStore((s) => s.unhideElement);
  const addEmptySlide = usePresentationStore((s) => s.addEmptySlide);
  const setActiveSlide = useEditorStore((s) => s.setActiveSlide);
  const addElement = usePresentationStore((s) => s.addElement);
  const addElements = usePresentationStore((s) => s.addElements);
  const addResource = usePresentationStore((s) => s.addResource);
  const deleteElements = usePresentationStore((s) => s.deleteElements);

  const slide = useActiveSlide();
  const objectElements = useObjectElements();

  const [dragGuides, setDragGuides] = useState<Guide[]>([]);
  const [connectorHighlight, setConnectorHighlight] = useState<{ elementId: string; dock?: ConnectorDockCue | null } | null>(null);
  const setConnectorHighlightId = useCallback((elementId: string | null, dock?: ConnectorDockCue | null) => {
    setConnectorHighlight(elementId ? { elementId, dock } : null);
  }, []);
  const [gesturePreview, setGesturePreview] = useState<{ slideId: string; elements: SlideElement[] } | null>(null);
  const previewActiveRef = useRef(false);
  const canRefit = useCallback(() => !previewActiveRef.current && !useEditorStore.getState().editingTextId, []);
  const clearGesturePreview = useCallback(() => { previewActiveRef.current = false; setGesturePreview(null); }, []);
  const publishGesturePreview = useCallback((patches: GesturePatch[], batch = true) => {
    previewActiveRef.current = true;
    const source = readGestureSlide();
    if (source) setGesturePreview({ slideId: source.id, elements: projectGestureScene(source, patches, batch) });
  }, []);
  const [pathPointEditing, setPathPointEditing] = useState(false);
  const [textPreview, setTextPreview] = useState<{ slideId: string; label: TextElement; patches: GesturePatch[] } | null>(null);

  // Pending scroll adjustment after zoom (applied in useLayoutEffect)
  const pendingScrollRef = useRef<{ left: number; top: number } | null>(null);

  // Track viewport (scroll parent) dimensions for padding-based centering
  const [viewport, setViewport] = useState({ w: 0, h: 0 });
  const initialScrollDone = useRef(false);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const scrollParent = el.closest('.canvas-scroll-parent') as HTMLElement | null;
    if (!scrollParent) return;

    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setViewport({ w: entry.contentRect.width, h: entry.contentRect.height });
      }
    });
    ro.observe(scrollParent);
    return () => ro.disconnect();
  }, []);

  // Selection drag state
  const [selectionDrag, setSelectionDrag] = useState<{
    startX: number;
    startY: number;
    currentX: number;
    currentY: number;
    isSelecting: boolean;
  } | null>(null);

  
  const elements = useMemo(() => {
    if (!slide) return [];
    const list = slide.elementOrder.map((id) => slide.elements[id]).filter(Boolean);
    // Bound-label masks (synthetic `_labelMask` hint consumed by the shared
    // RenderShape): arrow shafts get a background-coloured gap under their
    // label. White fallback for gradient/image backgrounds.
    const bgColor = slide.background.type === 'solid' ? slide.background.color : '#ffffff';
    return attachLabelMasks(list, bgColor);
  }, [slide]);

  const displayElements = gesturePreview?.slideId === activeSlideId ? gesturePreview.elements
    : textPreview && textPreview.slideId === activeSlideId && textPreview.label.id === editingTextId && slide
      ? projectGestureScene(slide, textPreview.patches, true, true) : elements;

  // Sole selected visible path shape (2-point lines are just degenerate
  // polys) — gets the unified vertex/endpoint/tangent handles instead of
  // the standard transformer.
  const soleSelectedPathElement = useMemo(() => {
    if (selectedElementIds.length !== 1 || !slide) return null;
    const el = slide.elements[selectedElementIds[0]];
    if (el && el.visible && el.type === 'shape' && (el as ShapeElement).shapeType === 'path') {
      return el as ShapeElement;
    }
    return null;
  }, [selectedElementIds, slide]);

  // Sole selected unlocked shape that supports the on-canvas corner-radius
  // handle: rects, and LINEAR paths with corners (cornerRadius is forced to 0 for
  // every other configuration).
  const soleSelectedCornerElement = useMemo(() => {
    if (selectedElementIds.length !== 1 || !slide) return null;
    const el = slide.elements[selectedElementIds[0]];
    if (!el || !el.visible || el.locked || el.type !== 'shape') return null;
    const s = el as ShapeElement;
    const linearPath = s.shapeType === 'path'
      && (s.points?.length ?? 0) >= 6
      && (s.curve ?? 'linear') === 'linear';
    return s.shapeType === 'rect' || linearPath ? s : null;
  }, [selectedElementIds, slide]);

  const justFinishedSelectionDrag = useRef(false);
  const pendingTextEdit = useRef<{ id: string; localX: number; localY: number } | null>(null);
  // Track initial positions of all selected elements for multi-element drag
  const dragStartPositions = useRef<Map<string, { x: number; y: number }>>(new Map());

  // Drawing hook (pointer-based — mouse, touch, stylus all flow through here).
  // Gets the connector-highlight setter so bind-while-drawing can outline the
  // shape a line/arrow endpoint is about to bind to.
  const { drawState, guides: drawingGuides, polyDraft, commitPolyDraft, cancelPolyDraft, handlePointerDown: handleDrawPointerDown, handlePointerMove: handleDrawPointerMove, handlePointerLeave: handleDrawPointerLeave, handlePointerUp: handleDrawPointerUp, refreshIconPlacement, justFinishedDrawing } = useSVGDrawing(setConnectorHighlightId);

  // Combine drag and drawing guides
  const guides = drawState.isDrawing || polyDraft ? drawingGuides : dragGuides;

  // Long-press detection on canvas elements (touch / stylus only). 500 ms hold
  // without > 8 px movement shows a small context menu. Declared up here so
  // handleDragMove / handleDragEnd can call cancelElementLongPress without a
  // TDZ forward reference.
  const longPressTimerRef = useRef<number | null>(null);
  const longPressStartRef = useRef<{ x: number; y: number; pointerId: number } | null>(null);
  const longPressFiredRef = useRef(false);

  const cancelElementLongPress = useCallback(() => {
    if (longPressTimerRef.current !== null) {
      window.clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
    longPressStartRef.current = null;
  }, []);

  // Shared pointerup guard for handleElementClick / handleDragEnd: cancels any
  // pending long-press timer, and if the long-press already fired (we showed a
  // context menu), consumes it — resets the flag, drops the pending gesture
  // state, and returns true so the caller swallows the rest of the pointerup.
  const consumeLongPress = useCallback((): boolean => {
    cancelElementLongPress();
    if (!longPressFiredRef.current) return false;
    longPressFiredRef.current = false;
    pendingTextEdit.current = null;
    dragStartPositions.current.clear();
    return true;
  }, [cancelElementLongPress]);

  const pendingSelectionToggle = useRef<string[] | null>(null);

  // Drag handling
  const handleDragStart = useCallback((id: string) => {
    pendingSelectionToggle.current = null;
    // Read fresh state to avoid stale closures from React.memo'd children
    const currentSelectedIds = useEditorStore.getState().selectedElementIds;
    const currentSlide = readGestureSlide();

    // Capture initial positions of all selected elements for multi-element drag
    dragStartPositions.current.clear();
    const idsToTrack = currentSelectedIds.includes(id) ? currentSelectedIds : [id];
    if (currentSlide) {
      for (const elementId of idsToTrack) {
        const el = currentSlide.elements[elementId];
        if (el && !el.locked) {
          dragStartPositions.current.set(elementId, { x: el.x, y: el.y });
        }
      }
    }

    if (!currentSelectedIds.includes(id)) {
      setSelectedElements([id]);
    }
  }, [setSelectedElements]);

  // Snap a dragged element's position to grid and alignment guides. Returns
  // the position unchanged (with no guides) when snapping is off or the
  // element is missing.
  const computeDragSnap = useCallback((id: string, x: number, y: number): { snappedX: number; snappedY: number; guides: Guide[] } => {
    const source = readGestureSlide();
    const el = source?.elements[id];
    const { snapToGrid: snappingEnabled, showGrid: isGridVisible, gridSize: grid, marginLayoutId: currentMarginLayoutId } = useEditorStore.getState();
    // Cmd disables magnets; Shift constrains the raw body translation.
    const effectiveSnapping = snappingEnabled && !isMetaHeld();
    if (!effectiveSnapping || !el) return { snappedX: x, snappedY: y, guides: [] };

    const marginLayout = getMarginLayout(currentMarginLayoutId);
    const marginBounds = marginLayout ? getMarginBounds(marginLayout) : null;

    // Filter out all elements being dragged for guide computation
    const draggedIds = new Set(dragStartPositions.current.keys());
    const others = (source ? source.elementOrder.map(id => source.elements[id]).filter(Boolean) : [])
      .filter((e) => !draggedIds.has(e.id) && e.visible)
      .map((e) => ({ x: e.x, y: e.y, width: e.width, height: e.height }));

    // Compute guides based on the dragged element
    const dragged = { x, y, width: el.width, height: el.height };
    const result = computeGuides(dragged, others, screenPixelsToSlide(5, zoom), marginBounds);

    let snappedX = x;
    let snappedY = y;

    if (isGridVisible) {
      snappedX = snapToGridFn(x, grid);
      snappedY = snapToGridFn(y, grid);
    }
    if (result.snapX !== null) snappedX = result.snapX;
    if (result.snapY !== null) snappedY = result.snapY;

    const origin = dragStartPositions.current.get(id);
    if (isShiftHeld() && origin) {
      if (Math.abs(x - origin.x) >= Math.abs(y - origin.y)) {
        snappedY = origin.y;
        return { snappedX, snappedY, guides: result.guides.filter(g => g.type !== 'spacing' && g.type === 'vertical') };
      }
      snappedX = origin.x;
      return { snappedX, snappedY, guides: result.guides.filter(g => g.type !== 'spacing' && g.type === 'horizontal') };
    }
    return { snappedX, snappedY, guides: result.guides };
  }, [zoom]);

  const handleDragMove = useCallback((id: string, x: number, y: number) => {
    // Any actual movement cancels the long-press timer — drag and long-press
    // are mutually exclusive.
    cancelElementLongPress();

    const source = readGestureSlide();
    if (!source) return;
    const el = source.elements[id];
    if (!el) return;

    // Get the original position of the dragged element for delta calculation
    const originalPos = dragStartPositions.current.get(id);
    if (!originalPos) return;

    const { snappedX, snappedY, guides: snapGuides } = computeDragSnap(id, x, y);
    setDragGuides(snapGuides);

    // Calculate snapped delta
    const snappedDeltaX = snappedX - originalPos.x;
    const snappedDeltaY = snappedY - originalPos.y;

    publishGesturePreview(planElementTranslation(source.elements, dragStartPositions.current, { x: snappedDeltaX, y: snappedDeltaY }));
  }, [computeDragSnap, cancelElementLongPress, publishGesturePreview]);

  const justFinishedElementDrag = useRef(false);

  // Pointer released before the drag slop was crossed: a plain click. The drag
  // hook fires this INSTEAD of onDragStart/End, so a click never runs the
  // move-commit path (no snap jump, no undo entry, no collab write).
  const handleElementClick = useCallback((id: string) => {
    // If a long-press just fired, swallow the click — we showed a menu, don't
    // also enter edit mode.
    if (consumeLongPress()) return;
    justFinishedElementDrag.current = false;
    if (pendingSelectionToggle.current) {
      setSelectedElements(pendingSelectionToggle.current); pendingSelectionToggle.current = null; return;
    }

    // Tap-again-on-text enters edit mode (armed in handleSelect on pointerdown)
    if (pendingTextEdit.current && pendingTextEdit.current.id === id) {
      const { id: textId, localX, localY } = pendingTextEdit.current;
      setEditingTextId(textId, { x: localX, y: localY });
    }
    pendingTextEdit.current = null;
    dragStartPositions.current.clear();
  }, [consumeLongPress, setEditingTextId, setSelectedElements]);

  const handleDragEnd = useCallback((id: string, x: number, y: number) => {
    // If a long-press just fired, swallow the rest of this pointerup — we
    // showed a menu, don't also commit the drag.
    if (consumeLongPress()) {
      setDragGuides([]);
      clearGesturePreview();
      return;
    }
    setDragGuides([]);
    clearGesturePreview();
    // The drag slop in useSVGDrag guarantees onDragEnd only fires after real
    // movement — a slop-less release goes to handleElementClick instead.
    justFinishedElementDrag.current = true;
    pendingTextEdit.current = null;

    const source = readGestureSlide();
    if (!activeSlideId || !source) {
      dragStartPositions.current.clear();
      return;
    }

    // Calculate the delta from the dragged element's original position
    const originalPos = dragStartPositions.current.get(id);
    if (!originalPos) {
      dragStartPositions.current.clear();
      return;
    }

    const { snappedX, snappedY } = computeDragSnap(id, x, y);

    // Calculate snapped delta
    const snappedDeltaX = snappedX - originalPos.x;
    const snappedDeltaY = snappedY - originalPos.y;

    // Collect all updates for batch operation (single undo entry)
    const updates = planElementTranslation(source.elements, dragStartPositions.current, { x: snappedDeltaX, y: snappedDeltaY });

    // Batch update all elements (single undo operation)
    if (updates.length > 0) {
      updateElements(activeSlideId, updates);
    }

    dragStartPositions.current.clear();
  }, [activeSlideId, updateElements, computeDragSnap, consumeLongPress, clearGesturePreview]);

  const { handlePointerDown: handleElementPointerDown } = useSVGDrag({
    zoom,
    onDragStart: handleDragStart,
    onDragCancel: () => { pendingTextEdit.current = null; pendingSelectionToggle.current = null; cancelElementLongPress(); clearGesturePreview(); setDragGuides([]); dragStartPositions.current.clear(); },
    onDragMove: handleDragMove,
    onDragEnd: handleDragEnd,
    onClick: handleElementClick,
  });

  // Convert screen coordinates to SVG coordinates
  const screenToSVG = useCallback((clientX: number, clientY: number) => {
    if (!containerRef.current) return { x: 0, y: 0 };
    const rect = containerRef.current.getBoundingClientRect();
    return {
      x: (clientX - rect.left) / zoom - CANVAS_PADDING,
      y: (clientY - rect.top) / zoom - CANVAS_PADDING,
    };
  }, [zoom]);

  // Show a small context menu on long-press (touch / stylus) for the given
  // element. Mirrors the SlidePanel long-press menu for consistency.
  const showElementContextMenu = useCallback((elementId: string, clientX: number, clientY: number) => {
    const slideId = useEditorStore.getState().activeSlideId;
    const slide = usePresentationStore.getState().presentation.slides[slideId];
    const target = slide?.elements[elementId];
    if (!target) return;

    const menu = document.createElement('div');
    menu.className = 'fixed bg-white rounded-lg shadow-lg border border-gray-200 py-1 z-[100] text-sm';
    menu.style.left = `${clientX}px`;
    menu.style.top = `${clientY}px`;

    const items: { label: string; action: () => void }[] = [
      {
        label: 'Duplicate',
        action: () => {
          // Containers bring their bound labels along; ids are remapped so
          // the copied label points at the copied container.
          const ids = expandWithBoundTexts(slide.elements, slide.elementOrder, [elementId]);
          const dups = duplicateElements(ids.map((id) => slide.elements[id]).filter(Boolean));
          if (dups.length === 0) return;
          addElements(slideId, dups);
          setSelectedElements([dups[0].id]);
        },
      },
      {
        label: target.locked ? 'Unlock' : 'Lock',
        action: () => updateElement(slideId, elementId, { locked: !target.locked }),
      },
      {
        label: 'Delete',
        action: () => {
          deleteElements(slideId, [elementId]);
          setSelectedElements([]);
        },
      },
    ];

    items.forEach(({ label, action }) => {
      const btn = document.createElement('button');
      btn.className = 'block w-full text-left px-4 py-1.5 hover:bg-gray-100';
      btn.textContent = label;
      btn.onclick = () => { action(); menu.remove(); };
      menu.appendChild(btn);
    });

    document.body.appendChild(menu);
    const remove = () => { menu.remove(); document.removeEventListener('click', remove); };
    setTimeout(() => document.addEventListener('click', remove), 0);
  }, [addElements, deleteElements, setSelectedElements, updateElement]);

  const handleSelect = useCallback((id: string, e: React.PointerEvent) => {
    pendingSelectionToggle.current = null;
    // Ignore middle-click (used for panning) — only meaningful for mouse pointers
    if (e.pointerType === 'mouse' && e.button === 1) return;
    // Ignore non-primary mouse buttons (right click). Touch/stylus always pass.
    if (e.pointerType === 'mouse' && e.button !== 0) return;

    // Arm long-press for touch / pen on this element. If 500 ms passes
    // without movement > 8 px, fire the context menu and suppress the
    // normal drag/edit path.
    if (e.pointerType !== 'mouse') {
      longPressFiredRef.current = false;
      longPressStartRef.current = { x: e.clientX, y: e.clientY, pointerId: e.pointerId };
      const startClientX = e.clientX;
      const startClientY = e.clientY;
      longPressTimerRef.current = window.setTimeout(() => {
        longPressTimerRef.current = null;
        if (longPressStartRef.current) {
          longPressFiredRef.current = true;
          showElementContextMenu(id, startClientX, startClientY);
        }
      }, 500);
    }

    // Read fresh state from stores to avoid stale closures (SVGElementRenderer's
    // React.memo comparator skips callback comparison for performance, so this
    // callback may be called with outdated closure values after deselection etc.)
    const currentSelectedIds = useEditorStore.getState().selectedElementIds;
    const currentEditingTextId = useEditorStore.getState().editingTextId;
    const currentSlide = usePresentationStore.getState().presentation.slides[activeSlideId];

    const metaPressed = e.shiftKey || e.ctrlKey || e.metaKey;

    let clickedElement = currentSlide?.elements[id];

    // Bound-text forwarding: clicking a label selects (and drags) its
    // CONTAINER — the container drives the label's geometry, so the label
    // never gets its own transformer. Skipped while the label itself is
    // being edited (clicks then belong to the edit session below).
    if (
      clickedElement?.type === 'text' &&
      (clickedElement as TextElement).containerId &&
      currentEditingTextId !== id
    ) {
      const container = currentSlide?.elements[(clickedElement as TextElement).containerId!];
      if (container) {
        id = container.id;
        clickedElement = container;
      }
    }

    const isTextElement = clickedElement?.type === 'text';

    if (currentEditingTextId === id) {
      // We're editing this text element - check if click is on border (not text content)
      // If on border, exit edit mode and allow drag to start
      if (isTextElement && clickedElement) {
        const pos = screenToSVG(e.clientX, e.clientY);
        const { x: localX, y: localY } = toLocalPoint(clickedElement, pos);

        if (!isPointOnTextContent(clickedElement as TextElement, { x: localX, y: localY })) {
          // Click is on border, not text - exit edit mode and start drag
          setEditingTextId(null);
          if (!clickedElement.locked) {
            handleElementPointerDown(id, clickedElement.x, clickedElement.y, e);
          }
        }
      }
      return;
    }

    if (currentEditingTextId && currentEditingTextId !== id) {
      setEditingTextId(null);
    }

    if (metaPressed) {
      const ids = currentSelectedIds.includes(id)
        ? currentSelectedIds.filter((sid) => sid !== id)
        : [...currentSelectedIds, id];
      if (clickedElement?.locked) {
        setSelectedElements(ids);
      } else {
        pendingSelectionToggle.current = ids;
        if (!currentSelectedIds.includes(id)) setSelectedElements(ids);
        handleElementPointerDown(id, clickedElement?.x || 0, clickedElement?.y || 0, e);
      }
    } else {
      // Only reset selection if clicking on an unselected element
      // This preserves multi-selection when dragging one of the selected elements
      const isAlreadySelected = currentSelectedIds.includes(id);
      if (!isAlreadySelected) {
        setSelectedElements([id]);
      }

      // Store click info for potential edit-mode entry on mouseup (no drag)
      if (isTextElement && clickedElement) {
        const pos = screenToSVG(e.clientX, e.clientY);
        const { x: localX, y: localY } = toLocalPoint(clickedElement, pos);

        if (isPointOnTextContent(clickedElement as TextElement, { x: localX, y: localY })) {
          // Click is in the overflow region (below element bounds) — enter edit mode directly
          // Dragging overflowed text makes no sense, so skip drag tracking
          if (localY > clickedElement.height) {
            setEditingTextId(id, { x: localX, y: localY });
            return;
          }
          if (clickedElement.locked) {
            // Locked text can't drag, so enter edit mode immediately
            setEditingTextId(id, { x: localX, y: localY });
            return;
          }
          // Tap-once-tap-again: only enter edit mode if the element was already
          // selected before this pointerdown. First tap selects, second tap
          // edits. Desktop users keep the double-click fast path
          // (handleDoubleClick below). Without this gate, a single tap on text
          // would always pop the keyboard on touch.
          if (isAlreadySelected) {
            pendingTextEdit.current = { id, localX, localY };
          }
        }
      }

      // Always start drag
      if (!clickedElement?.locked) {
        handleElementPointerDown(id, clickedElement?.x || 0, clickedElement?.y || 0, e);
      }
    }
  }, [activeSlideId, setSelectedElements, setEditingTextId, screenToSVG, handleElementPointerDown, showElementContextMenu]);

  const handleDoubleClick = useCallback((id: string) => {
    if (!slide || !activeSlideId) return;
    const el = slide.elements[id];
    if (!el) return;
    if (el.type === 'text') {
      setEditingTextId(id);
      return;
    }
    // Bound text: double-clicking a shape (or arrow/path) opens its label —
    // creating an empty one centered in the container (bbox center for
    // shapes, arc-length midpoint for paths) when none exists yet.
    if (el.type === 'shape' && !el.locked) {
      const existing = findBoundText(slide, id);
      if (existing) {
        setEditingTextId(existing.id);
        return;
      }
      const label = createBoundLabel(el);
      addElement(activeSlideId, label);
      setEditingTextId(label.id);
    }
  }, [slide, activeSlideId, setEditingTextId, addElement]);

  // Touch devices don't have a hover state — painting a hover overlay on
  // tap-release looks like a stuck highlight. Skip the hover branch entirely
  // on coarse pointers; selection feedback still appears via the transformer.
  const coarsePointer = useCoarsePointer();
  const handleMouseEnter = useCallback((id: string) => {
    if (coarsePointer) return;
    setHoveredObjectId(id);
  }, [setHoveredObjectId, coarsePointer]);

  const handleMouseLeave = useCallback(() => {
    if (coarsePointer) return;
    setHoveredObjectId(null);
  }, [setHoveredObjectId, coarsePointer]);

  // Whether the current gesture's pointerdown landed on the empty canvas —
  // written by handleCanvasPointerDown, consumed by handleStageClick.
  const stagePointerDownOnBackground = useRef(false);

  // eslint-disable-next-line react-hooks/immutability -- ref-flag pattern: flags are set on mouseup and consumed by the click that follows; never touched during render
  const handleStageClick = useCallback((e: React.MouseEvent) => {
    if (justFinishedSelectionDrag.current) {
      justFinishedSelectionDrag.current = false;
      return;
    }
    if (justFinishedDrawing.current) {
      // eslint-disable-next-line react-hooks/immutability -- consuming the drawing-just-finished flag owned by useSVGDrawing; event-handler-only mutation
      justFinishedDrawing.current = false;
      return;
    }
    // Skip if an element drag or transform just finished (click fires after mouseup on background)
    if (justFinishedElementDrag.current) {
      justFinishedElementDrag.current = false;
      return;
    }
    if (justFinishedTransform.current) {
      justFinishedTransform.current = false;
      return;
    }
    // Both the click target AND the gesture's pointerdown must be on the
    // background. The click alone is not trustworthy: when the DOM changes
    // mid-gesture (e.g. pointerdown on a locked text enters edit mode and
    // mounts the edit overlay under the cursor), the browser retargets the
    // click to the common ancestor — this svg — which looks exactly like an
    // empty-canvas click and used to clear the selection/edit state that the
    // pointerdown had just created.
    if (
      (e.target === e.currentTarget || (e.target as Element).classList.contains('svg-background'))
      && stagePointerDownOnBackground.current
    ) {
      clearSelection();
    }
  }, [clearSelection, justFinishedDrawing]);

  // Selection drag handlers (pointer-based; mouse/touch/stylus all share this path)
  const handleCanvasPointerDown = useCallback((e: React.PointerEvent) => {
    pendingSelectionToggle.current = null;
    // Remember where this gesture STARTED for handleStageClick (see there).
    {
      const t = e.target as Element;
      stagePointerDownOnBackground.current = t.classList.contains('svg-background') || t === svgRef.current;
    }
    // Ignore non-primary mouse buttons (right click). Middle-click panning is
    // handled separately below.
    if (e.pointerType === 'mouse' && e.button !== 0) return;

    if (tool !== 'select') {
      handleDrawPointerDown(e, screenToSVG);
      return;
    }

    // Only start selection drag on background
    if (stagePointerDownOnBackground.current) {
      const pos = screenToSVG(e.clientX, e.clientY);
      setSelectionDrag({
        startX: pos.x,
        startY: pos.y,
        currentX: pos.x,
        currentY: pos.y,
        isSelecting: true,
      });
    }
  }, [tool, handleDrawPointerDown, screenToSVG]);

  const handleCanvasPointerMove = useCallback((e: React.PointerEvent) => {
    if (tool !== 'select') {
      handleDrawPointerMove(e, screenToSVG);
      return;
    }

    if (!selectionDrag?.isSelecting) return;
    const pos = screenToSVG(e.clientX, e.clientY);
    setSelectionDrag((prev) => prev ? { ...prev, currentX: pos.x, currentY: pos.y } : null);
  }, [tool, handleDrawPointerMove, screenToSVG, selectionDrag?.isSelecting]);

  const handleCanvasPointerUp = useCallback((e: React.PointerEvent) => {
    if (tool !== 'select') {
      handleDrawPointerUp(e, screenToSVG);
      return;
    }

    if (!selectionDrag?.isSelecting) return;

    const x = Math.min(selectionDrag.startX, selectionDrag.currentX);
    const y = Math.min(selectionDrag.startY, selectionDrag.currentY);
    const width = Math.abs(selectionDrag.currentX - selectionDrag.startX);
    const height = Math.abs(selectionDrag.currentY - selectionDrag.startY);

    if (width > 5 || height > 5) {
      const selectedIds = elements
        .filter((el) => {
          if (!el.visible) return false;
          const elRight = el.x + el.width;
          const elBottom = el.y + el.height;
          const selRight = x + width;
          const selBottom = y + height;
          return !(el.x > selRight || elRight < x || el.y > selBottom || elBottom < y);
        })
        .map((el) => {
          // Bound labels never enter the selection on their own — the
          // marquee picks their container instead (dedup below).
          if (el.type === 'text') {
            const cid = (el as TextElement).containerId;
            if (cid && slide?.elements[cid]) return cid;
          }
          return el.id;
        });
      setSelectedElements([...new Set(selectedIds)]);
      justFinishedSelectionDrag.current = true;
    }

    setSelectionDrag(null);
  }, [tool, handleDrawPointerUp, screenToSVG, selectionDrag, elements, setSelectedElements, slide]);

  // Two-finger pan/zoom via pointer events. Composes with the existing single-
  // pointer drag handlers above — the gesture hook only fires once a second
  // pointer is down, so single-finger drags / clicks aren't affected.
  const gestureActiveRef = useRef(false);
  const gesture = usePointerGesture({
    onGestureStart: () => {
      gestureActiveRef.current = true;
      // Cancel any in-flight single-pointer drag UI so it doesn't fight us.
      setDragGuides([]);
      clearGesturePreview();
      setSelectionDrag(null);
    },
    onGesture: (frame: GestureFrame) => {
      const scrollParent = containerRef.current?.closest('.canvas-scroll-parent') as HTMLElement | null;
      if (!scrollParent) return;

      // Pan: subtract translation from scrollLeft/Top
      scrollParent.scrollLeft -= frame.translation.dx;
      scrollParent.scrollTop -= frame.translation.dy;

      // Zoom about gesture midpoint
      if (Math.abs(frame.scaleDelta - 1) > 0.001) {
        const oldZoom = useEditorStore.getState().zoom;
        const newZoom = Math.max(0.25, Math.min(3, oldZoom * frame.scaleDelta));
        if (newZoom !== oldZoom) {
          const spRect = scrollParent.getBoundingClientRect();
          const cursorVpX = frame.midpoint.x - spRect.left;
          const cursorVpY = frame.midpoint.y - spRect.top;
          const padX2 = viewport.w / 2;
          const padY2 = viewport.h / 2;
          const svgX = (scrollParent.scrollLeft + cursorVpX - padX2) / oldZoom;
          const svgY = (scrollParent.scrollTop + cursorVpY - padY2) / oldZoom;
          pendingScrollRef.current = {
            left: padX2 + svgX * newZoom - cursorVpX,
            top: padY2 + svgY * newZoom - cursorVpY,
          };
          setZoom(newZoom);
        }
      }
    },
    onGestureEnd: () => {
      gestureActiveRef.current = false;
    },
  });

  // Transform handlers
  const handleTransformStart = useCallback(() => {
    pendingSelectionToggle.current = null;
    // Exit text edit mode when starting any transform
    if (editingTextId) {
      setEditingTextId(null);
    }
  }, [editingTextId, setEditingTextId]);

  const justFinishedTransform = useRef(false);
  const handleBatchTransform = useCallback((updates: GesturePatch[]) => {
    publishGesturePreview(updates);
  }, [publishGesturePreview]);
  const handleBatchTransformEnd = useCallback((updates: GesturePatch[]) => {
    clearGesturePreview();
    // eslint-disable-next-line react-hooks/immutability -- event-only completion flag
    justFinishedTransform.current = true;
    if (activeSlideId && updates.length) updateElements(activeSlideId, updates);
  }, [activeSlideId, updateElements, clearGesturePreview]);
  const handlePathPreview = useCallback((attrs: Partial<ShapeElement> | null) => {
    if (attrs && soleSelectedPathElement) publishGesturePreview([{ elementId: soleSelectedPathElement.id, changes: attrs }], false);
    else clearGesturePreview();
  }, [soleSelectedPathElement, publishGesturePreview, clearGesturePreview]);
  const handleRadiusPreview = useCallback((attrs: Partial<ShapeElement> | null) => {
    if (attrs && soleSelectedCornerElement) publishGesturePreview([{ elementId: soleSelectedCornerElement.id, changes: attrs }], false);
    else clearGesturePreview();
  }, [soleSelectedCornerElement, publishGesturePreview, clearGesturePreview]);

  // Bound-label hug-the-text refit (EDITOR canvas only, Excalidraw model):
  // whenever a label's text has been measured, re-lay it out at the WRAP
  // width (the container's inner width — labels wrap there, never at their
  // own hugged box) and shrink/grow the element box to the laid-out extent
  // via the pure fitLabelToDoc math; the container grows (never shrinks)
  // when the wrapped text truly exceeds its inner height. Epsilon guards in
  // fitLabelToDoc stop write loops: the fit depends only on (text, style,
  // wrap width, container geometry), none of which the fit itself changes
  // except a symmetric container height grow that converges in one pass.
  const handleTextLayout = useCallback((textId: string, _doc: SvgTextDoc) => {
    if (!previewActiveRef.current && !useEditorStore.getState().editingTextId) refitBoundLabel(textId, canRefit);
  }, [canRefit]);

  // A container RESIZE changes the wrap width, but SVGTextPaths only re-lays
  // a label out when the label's own props change — so re-run the fit for
  // every label whose container inner width changed (e.g. widening a box
  // un-wraps a width-capped label). Keyed on the wrap widths, so plain
  // moves / unrelated edits don't re-enter; the fit itself is epsilon-
  // guarded and its layouts are cache hits when nothing changed.
  const labelWrapKey = useMemo(() => {
    if (!slide) return '';
    const parts: string[] = [];
    for (const id of slide.elementOrder) {
      const el = slide.elements[id];
      if (!el || el.type !== 'text') continue;
      const cid = (el as TextElement).containerId;
      const container = cid ? slide.elements[cid] : undefined;
      if (container) parts.push(`${id}:${labelWrapWidthFor(container, el).toFixed(2)}`);
    }
    return parts.join('|');
  }, [slide]);
  useEffect(() => {
    if (!labelWrapKey) return;
    for (const part of labelWrapKey.split('|')) {
      refitBoundLabel(part.slice(0, part.lastIndexOf(':')), canRefit);
    }
  }, [labelWrapKey, canRefit, gesturePreview, editingTextId]);

  // Path handle update handler (vertex / tangent / binding commits).
  const handlePathUpdate = useCallback((attrs: Partial<ShapeElement>) => {
    if (activeSlideId && soleSelectedPathElement) {
      updateElement(activeSlideId, soleSelectedPathElement.id, attrs);
    }
  }, [activeSlideId, soleSelectedPathElement, updateElement]);

  // Drag and drop handlers
  const handleDragOver = useCallback((e: DragEvent<HTMLDivElement>) => {
    if (e.dataTransfer.types.includes('application/x-object-id') || e.dataTransfer.types.includes('Files')) {
      e.preventDefault();
      e.dataTransfer.dropEffect = e.dataTransfer.types.includes('application/x-object-id') ? 'move' : 'copy';
    }
  }, []);

  const handleDrop = useCallback((e: DragEvent<HTMLDivElement>) => {
    const objectId = e.dataTransfer.getData('application/x-object-id');
    if (objectId && activeSlideId && containerRef.current) {
      e.preventDefault();
      const pos = screenToSVG(e.clientX, e.clientY);
      unhideElement(activeSlideId, objectId, { x: pos.x, y: pos.y });
      setSelectedElements([objectId]);
      return;
    }

    const files = e.dataTransfer.files;
    if (!files.length || !activeSlideId || !containerRef.current) return;
    e.preventDefault();
    const pos = screenToSVG(e.clientX, e.clientY);

    const { slideOrder, resources: existingResources } = usePresentationStore.getState().presentation;
    const currentIdx = slideOrder.indexOf(activeSlideId);

    Array.from(files).forEach(async (file) => {
      if (file.type === 'application/pdf' || file.name.endsWith('.pdf')) {
        const { resources, elements: pdfElements, isExisting } = await loadPdfFile(file, existingResources);
        if (!isExisting) {
          resources.forEach((r) => addResource(r));
        }
        if (pdfElements.length === 1) {
          pdfElements[0].x = pos.x;
          pdfElements[0].y = pos.y;
          addElement(activeSlideId, pdfElements[0]);
          setSelectedElements([pdfElements[0].id]);
        } else {
          let insertIdx = currentIdx + 1;
          let lastSlideId = '';
          for (const pageEl of pdfElements) {
            const newSlideId = addEmptySlide(insertIdx);
            addElement(newSlideId, pageEl);
            lastSlideId = newSlideId;
            insertIdx++;
          }
          if (lastSlideId) setActiveSlide(lastSlideId);
        }
      } else if (file.type.startsWith('image/') || file.name.endsWith('.svg')) {
        const { resource, element, isExisting } = await loadImageFile(file, { x: pos.x, y: pos.y }, existingResources);
        if (!isExisting) {
          addResource(resource);
        }
        addElement(activeSlideId, element);
        setSelectedElements([element.id]);
      } else if (file.type.startsWith('video/')) {
        const { resource, element, isExisting } = await loadVideoFile(file, { x: pos.x, y: pos.y }, existingResources);
        if (!isExisting) {
          addResource(resource);
        }
        addElement(activeSlideId, element);
        setSelectedElements([element.id]);
      }
    });
  }, [activeSlideId, screenToSVG, unhideElement, setSelectedElements, addElement, addEmptySlide, setActiveSlide, addResource]);

  // Apply pending scroll adjustment synchronously after React renders new zoom
  useLayoutEffect(() => {
    if (!pendingScrollRef.current) return;
    const scrollParent = containerRef.current?.closest('.canvas-scroll-parent') as HTMLElement | null;
    if (scrollParent) {
      scrollParent.scrollLeft = pendingScrollRef.current.left;
      scrollParent.scrollTop = pendingScrollRef.current.top;
    }
    pendingScrollRef.current = null;
  }, [zoom]);

  // Center canvas on initial load and when viewport becomes available
  useLayoutEffect(() => {
    if (initialScrollDone.current) return;
    if (viewport.w === 0 || viewport.h === 0) return;
    const scrollParent = containerRef.current?.closest('.canvas-scroll-parent') as HTMLElement | null;
    if (!scrollParent) return;

    // Padding = half viewport on each side; centering scroll = canvasW / 2
    const totalW = SLIDE_WIDTH + 2 * CANVAS_PADDING;
    const totalH = SLIDE_HEIGHT + 2 * CANVAS_PADDING;
    const canvasW = totalW * zoom;
    const canvasH = totalH * zoom;
    scrollParent.scrollLeft = canvasW / 2;
    scrollParent.scrollTop = canvasH / 2;
    initialScrollDone.current = true;
  }, [viewport, zoom]);

  // While an icon is pressed, keep its preview under the stationary pointer
  // through zoom, scroll, and layout offsets. Run after the zoom scroll effects;
  // only a changed canvas mapping replays the candidate, with no document write.
  useLayoutEffect(() => {
    if (tool !== 'icon' || !drawState.isDrawing) return;
    let frame = 0;
    let previousBounds = '';
    const refresh = () => {
      const rect = containerRef.current?.getBoundingClientRect();
      if (rect) {
        const bounds = [rect.left, rect.top, rect.width, rect.height].join(',');
        if (bounds !== previousBounds) {
          previousBounds = bounds;
          refreshIconPlacement(screenToSVG);
        }
      }
      frame = requestAnimationFrame(refresh);
    };
    refresh();
    return () => cancelAnimationFrame(frame);
  }, [tool, drawState.isDrawing, screenToSVG, refreshIconPlacement]);

  // Zoom with wheel toward cursor position
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const scrollParent = el.closest('.canvas-scroll-parent') as HTMLElement | null;
    const target = scrollParent || el;

    const totalW = SLIDE_WIDTH + 2 * CANVAS_PADDING;
    const totalH = SLIDE_HEIGHT + 2 * CANVAS_PADDING;

    const handleWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();

      if (!scrollParent) return;
      const viewportW = scrollParent.clientWidth;
      const viewportH = scrollParent.clientHeight;

      // Padding = half viewport on each side (canvas always scrollable)
      const padX = viewportW / 2;
      const padY = viewportH / 2;

      // Min zoom: canvas fills at least half the viewport (shows ~2x canvas area)
      const minZoom = Math.min(viewportW / (2 * totalW), viewportH / (2 * totalH));

      const oldZoom = useEditorStore.getState().zoom;
      // Multiplicative zoom: constant perceptual speed at all zoom levels
      // Use smaller base (1.002) for smoother/less sensitive zooming, especially on touchpads
      const factor = Math.pow(1.002, -e.deltaY);
      const newZoom = Math.max(minZoom, Math.min(3, oldZoom * factor));
      if (newZoom === oldZoom) return;

      // Cursor position relative to scroll parent viewport
      const spRect = scrollParent.getBoundingClientRect();
      const cursorVpX = e.clientX - spRect.left;
      const cursorVpY = e.clientY - spRect.top;

      // SVG-space point under the cursor (padding is constant, doesn't change with zoom)
      const svgX = (scrollParent.scrollLeft + cursorVpX - padX) / oldZoom;
      const svgY = (scrollParent.scrollTop + cursorVpY - padY) / oldZoom;

      // Target scroll: place the same SVG point under the cursor
      pendingScrollRef.current = {
        left: padX + svgX * newZoom - cursorVpX,
        top: padY + svgY * newZoom - cursorVpY,
      };

      setZoom(newZoom);
    };

    target.addEventListener('wheel', handleWheel, { passive: false });
    return () => {
      target.removeEventListener('wheel', handleWheel);
    };
  }, [setZoom]);

  // Middle-click panning
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const scrollParent = el.closest('.canvas-scroll-parent') as HTMLElement | null;
    if (!scrollParent) return;

    let isPanning = false;
    let startX = 0;
    let startY = 0;
    let startScrollLeft = 0;
    let startScrollTop = 0;

    const handleMouseDown = (e: MouseEvent) => {
      // Middle mouse button (button === 1)
      if (e.button !== 1) return;
      e.preventDefault();
      isPanning = true;
      startX = e.clientX;
      startY = e.clientY;
      startScrollLeft = scrollParent.scrollLeft;
      startScrollTop = scrollParent.scrollTop;
      scrollParent.style.cursor = 'grabbing';
    };

    const handleMouseMove = (e: MouseEvent) => {
      if (!isPanning) return;
      e.preventDefault();
      scrollParent.scrollLeft = startScrollLeft - (e.clientX - startX);
      scrollParent.scrollTop = startScrollTop - (e.clientY - startY);
    };

    const handleMouseUp = () => {
      if (!isPanning) return;
      isPanning = false;
      scrollParent.style.cursor = '';
    };

    scrollParent.addEventListener('mousedown', handleMouseDown);
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      scrollParent.removeEventListener('mousedown', handleMouseDown);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, []);

  // Hovered element
  const hoveredElement = useMemo(() => {
    if (!hoveredObjectId) return null;
    const raw = slide?.elements[hoveredObjectId] ?? objectElements[hoveredObjectId] ?? null;
    return textHoverOwner(raw, slide?.elements ?? {}, selectedElementIds, editingTextId);
  }, [hoveredObjectId, slide, objectElements, selectedElementIds, editingTextId]);

  const isHoveredVisibleOnSlide = hoveredElement ? !!slide?.elements[hoveredElement.id]?.visible : false;
  const autoFitElement = !editingTextId && selectedElementIds.length === 1 ? slide?.elements[selectedElementIds[0]] : null;

  // Visible elements for selection action bar
  const visibleElements = useMemo(() => {
    return elements.filter((el) => el.visible);
  }, [elements]);

  // Unlocked selected elements for transformer
  const unlockedSelectedIds = useMemo(() => {
    if (!slide) return selectedElementIds;
    return selectedElementIds.filter((id) => !slide.elements[id]?.locked);
  }, [selectedElementIds, slide]);

  const lockedSelectedIds = useMemo(() => {
    if (!slide) return [];
    return selectedElementIds.filter((id) => slide.elements[id]?.locked);
  }, [selectedElementIds, slide]);

  // Calculate container and viewBox dimensions
  const containerWidth = (SLIDE_WIDTH + 2 * CANVAS_PADDING) * zoom;
  const containerHeight = (SLIDE_HEIGHT + 2 * CANVAS_PADDING) * zoom;
  const viewBoxWidth = SLIDE_WIDTH + 2 * CANVAS_PADDING;
  const viewBoxHeight = SLIDE_HEIGHT + 2 * CANVAS_PADDING;

  const cursor = tool === 'select' ? 'default' : 'crosshair';

  // Padding = half viewport on each side so the canvas is always scrollable
  // This replaces CSS flex centering and makes zoom-to-cursor work at all zoom levels
  const padX = viewport.w / 2;
  const padY = viewport.h / 2;

  return (
    <div
      ref={containerRef}
      className="relative"
      style={{
        width: containerWidth,
        height: containerHeight,
        margin: `${padY}px ${padX}px`,
        cursor,
      }}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      <svg
        ref={svgRef}
        width={containerWidth}
        height={containerHeight}
        viewBox={`${-CANVAS_PADDING} ${-CANVAS_PADDING} ${viewBoxWidth} ${viewBoxHeight}`}
        // touch-none: the browser would otherwise treat vertical touch drags as
        // page scrolling. We want every drag to become a canvas gesture.
        className="touch-none"
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
        }}
        onClick={handleStageClick}
        onPointerDown={(e) => {
          // Run gesture tracker first so two-finger detection has the full
          // pointer set. Single-finger interactions then continue normally via
          // handleCanvasPointerDown.
          gesture.onPointerDown(e);
          handleCanvasPointerDown(e);
        }}
        onPointerMove={(e) => {
          gesture.onPointerMove(e);
          if (!gestureActiveRef.current) handleCanvasPointerMove(e);
        }}
        onPointerLeave={handleDrawPointerLeave}
        onPointerUp={(e) => {
          gesture.onPointerUp(e);
          handleCanvasPointerUp(e);
        }}
        onPointerCancel={(e) => {
          gesture.onPointerCancel(e);
          if (tool !== 'select') cancelPolyDraft();
          else setSelectionDrag(null);
        }}
        onDoubleClick={(e) => {
          if (tool !== 'select' && polyDraft) {
            e.preventDefault();
            commitPolyDraft();
          }
        }}
      >
        {/* Background layer */}
        <g className="background-layer">
          {slide && (
            <SVGBackground
              background={slide.background}
              width={SLIDE_WIDTH}
              height={SLIDE_HEIGHT}
            />
          )}
          {/* Clickable background rect for selection clearing */}
          <rect
            className="svg-background"
            x={0}
            y={0}
            width={SLIDE_WIDTH}
            height={SLIDE_HEIGHT}
            fill="transparent"
          />
        </g>

        {/* Content layer */}
        <g className="content-layer" data-gesture-preview={gesturePreview ? true : undefined}>
          {displayElements.filter((el) => el.id !== polyDraft?.extension?.source.id).map((el) => (
            <SVGElementRenderer
              key={el.id}
              element={el}
              disableInteraction={tool !== 'select'}
              editingTextId={editingTextId}
              onPointerDown={handleSelect}
              onMouseEnter={handleMouseEnter}
              onMouseLeave={handleMouseLeave}
              onDoubleClick={handleDoubleClick}
              onTextLayout={gesturePreview || textPreview || editingTextId ? undefined : handleTextLayout}
            />
          ))}
        </g>

        {/* UI layer */}
        <g className="ui-layer">
          <SVGGridOverlay gridSize={gridSize} visible={showGrid} zoom={zoom} />
          <SVGMarginGuides zoom={zoom} />
          <SVGAlignmentGuides guides={guides} zoom={zoom} />
          <SVGSelectionDrag selectionDrag={selectionDrag} zoom={zoom} />
          <SVGDrawingPreview drawState={drawState} tool={tool} zoom={zoom} />
          <SVGPolyDraftPreview polyDraft={polyDraft} zoom={zoom} />
          <SVGPeerSelectionOverlay slideId={activeSlideId || null} elements={elements} zoom={zoom} />

          {/* Final user rule: a sole single-segment open path uses endpoint
              controls; multisegment and group selections retain box resize. */}
          {unlockedSelectedIds.length > 0 && !pathPointEditing && !(soleSelectedPathElement && !soleSelectedPathElement.closed && soleSelectedPathElement.points?.length === 4) && (
            <SVGSelectionTransformer
              elements={textPreview && editingTextId ? displayElements : elements}
              displayElements={displayElements}
              selectedIds={unlockedSelectedIds}
              zoom={zoom}
              svgRef={svgRef}
              onTransformStart={handleTransformStart}
              onBatchTransform={handleBatchTransform}
              onBatchTransformEnd={handleBatchTransformEnd}
              onTransformCancel={clearGesturePreview}
              onGuidesChange={setDragGuides}
            />
          )}
          {lockedSelectedIds.length > 0 && (
            <SVGSelectionTransformer
              elements={elements}
              selectedIds={lockedSelectedIds}
              locked
              zoom={zoom}
              svgRef={svgRef}
            />
          )}

          {/* Unified path handles (lines, arrows, polylines, polygons,
              B-splines, béziers — vertex / midpoint / endpoint / tangent). */}
          {soleSelectedPathElement && !soleSelectedPathElement.locked && (
            <SVGPathHandles
              key={`path:${activeSlideId}:${soleSelectedPathElement.id}`}
              element={soleSelectedPathElement}
              elements={elements}
              zoom={zoom}
              svgRef={svgRef}
              onPreview={handlePathPreview}
              displayElement={displayElements.find(el => el.id === soleSelectedPathElement.id) as ShapeElement}
              onUpdate={handlePathUpdate}
              onEditingChange={setPathPointEditing}
              onTransformStart={handleTransformStart}
              onGuidesChange={setDragGuides}
              onConnectorHighlight={setConnectorHighlightId}
            />
          )}

          {/* Corner-radius handle (rects + closed linear paths). */}
          {soleSelectedCornerElement && (
            <SVGCornerRadiusHandle
              key={`radius:${activeSlideId}:${soleSelectedCornerElement.id}`}
              onPreview={handleRadiusPreview}
              displayElement={displayElements.find(el => el.id === soleSelectedCornerElement.id) as ShapeElement}
              element={soleSelectedCornerElement}
              zoom={zoom}
              svgRef={svgRef}
              onUpdate={(attrs) => {
                if (!activeSlideId) return;
                updateShapeStyleFromCurrent(activeSlideId, soleSelectedCornerElement, attrs);
              }}
              onTransformStart={handleTransformStart}
            />
          )}

          {/* Connector highlight */}
          {connectorHighlight && displayElements.filter(el => el.id === connectorHighlight.elementId && el.visible !== false && !el.locked).map(element => (
            <SVGConnectorHighlight key={element.id} element={element} zoom={zoom} dock={supportsConnectorDocks(element) ? connectorHighlight.dock : null} />
          ))}

          {!gesturePreview && canAutoFitText(autoFitElement) && (
            <SVGTextAutoFitHandle element={autoFitElement} zoom={zoom} onAutoFit={() => { void autoFitText(activeSlideId, autoFitElement); }} />
          )}

          {/* Hover overlay */}
          {hoveredElement && !selectedElementIds.includes(hoveredElement.id) && (
            <SVGHoverOverlay element={hoveredElement} isVisibleOnSlide={isHoveredVisibleOnSlide} zoom={zoom} />
          )}
        </g>
      </svg>

      {/* HTML overlays */}
      <TextEditOverlay key={`${activeSlideId}:${editingTextId}`} stageRef={containerRef} zoom={zoom} onPreview={setTextPreview} />
      <CropOverlay stageRef={containerRef} zoom={zoom} />
      {/* Unmount actions during manipulation: no stale native hit targets.
          Body previews start only after drag slop; extension uses its own draft. */}
      {!editingTextId && !gesturePreview && !polyDraft?.extension && visibleElements.filter(el => selectedElementIds.includes(el.id) && !visibleElements.some(label =>
        label.type === 'text' && (label.id === el.id || label.containerId === el.id)
        && (editingTextId === label.id || hasPendingTextFinish(activeSlideId, label.id))
      )).map((el) => (
        <SelectionActionBar
          key={el.id}
          element={el}
          zoom={zoom}
          isSelected={selectedElementIds.includes(el.id)}
        />
      ))}
    </div>
  );
};
