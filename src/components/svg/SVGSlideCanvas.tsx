import React, { useRef, useCallback, useMemo, useState, useEffect, useLayoutEffect, type DragEvent } from 'react';
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
import { SVGConnectorHighlight } from './SVGConnectorHighlight';
import { SVGDrawingPreview, SVGPolyDraftPreview } from './SVGDrawingPreview';
import { SVGDragPreview, type DragPreviewState } from './SVGDragPreview';
import { SVGSelectionDrag } from './SVGSelectionDrag';
import { SVGSelectionTransformer } from './SVGSelectionTransformer';
import { SVGPeerSelectionOverlay } from './SVGPeerSelectionOverlay';
import { SVGLineEndpointHandles } from './SVGLineEndpointHandles';
import { SVGPolyVertexHandles } from './SVGPolyVertexHandles';
import { useSVGDrag } from './useSVGDrag';
import { useSVGDrawing } from './useSVGDrawing';
import { TextEditOverlay } from '../canvas/TextEditOverlay';
import { CropOverlay } from '../canvas/CropOverlay';
import { SelectionActionBar } from '../canvas/SelectionActionBar';
import { computeGuides } from '../../hooks/useAlignmentGuides';
import { getMarginLayout, getMarginBounds } from '../../utils/marginLayouts';
import { snapToGrid as snapToGridFn } from '../../utils/geometry';
import { isShiftHeld } from '../../utils/keyboard';
import { SLIDE_WIDTH, SLIDE_HEIGHT, CANVAS_PADDING } from '../../utils/constants';
import { loadImageFile, loadPdfFile, loadVideoFile, duplicateElement } from '../../utils/slideFactory';
import { isPointOnTextContent } from '../../utils/textHitTest';
import { isLinePath } from '../../utils/pathShapes';
import type { ShapeElement, SlideElement, TextElement } from '../../types/presentation';

interface Guide {
  type: 'horizontal' | 'vertical';
  position: number;
}

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
  const addResource = usePresentationStore((s) => s.addResource);
  const deleteElements = usePresentationStore((s) => s.deleteElements);

  const slide = useActiveSlide();
  const objectElements = useObjectElements();

  const [dragGuides, setDragGuides] = useState<Guide[]>([]);
  const [connectorHighlightId, setConnectorHighlightId] = useState<string | null>(null);
  const [dragPreview, setDragPreview] = useState<DragPreviewState[] | null>(null);
  const [transformPreview, setTransformPreview] = useState<DragPreviewState | null>(null);

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
    return slide.elementOrder.map((id) => slide.elements[id]).filter(Boolean);
  }, [slide]);

  // Sole selected element is a visible 2-vertex linear path (line / arrow).
  // Gets connector-aware endpoint handles instead of the standard
  // transformer.
  const soleSelectedLineElement = useMemo(() => {
    if (selectedElementIds.length !== 1 || !slide) return null;
    const el = slide.elements[selectedElementIds[0]];
    if (el && el.visible && el.type === 'shape' && isLinePath(el)) {
      return el as ShapeElement;
    }
    return null;
  }, [selectedElementIds, slide]);

  // Sole selected multi-vertex / curved path — gets per-vertex handles.
  const soleSelectedPolyElement = useMemo(() => {
    if (selectedElementIds.length !== 1 || !slide) return null;
    const el = slide.elements[selectedElementIds[0]];
    if (el && el.visible && el.type === 'shape' && el.shapeType === 'path' && !isLinePath(el)) {
      return el as ShapeElement;
    }
    return null;
  }, [selectedElementIds, slide]);

  // Track element dragging to prevent entering edit mode after drag
  const isElementDragging = useRef(false);
  const justFinishedSelectionDrag = useRef(false);
  const draggingElementId = useRef<string | null>(null);
  const pendingTextEdit = useRef<{ id: string; localX: number; localY: number } | null>(null);
  // Track initial positions of all selected elements for multi-element drag
  const dragStartPositions = useRef<Map<string, { x: number; y: number }>>(new Map());

  // Drawing hook (pointer-based — mouse, touch, stylus all flow through here)
  const { drawState, guides: drawingGuides, polyDraft, handlePointerDown: handleDrawPointerDown, handlePointerMove: handleDrawPointerMove, handlePointerUp: handleDrawPointerUp, justFinishedDrawing } = useSVGDrawing();

  // Combine drag and drawing guides
  const guides = drawState.isDrawing ? drawingGuides : dragGuides;

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

  // Drag handling
  const handleDragStart = useCallback((id: string) => {
    // Don't set isElementDragging here - we only want to set it when actual movement happens
    // This allows single-click on text to enter edit mode
    draggingElementId.current = id;

    // Read fresh state to avoid stale closures from React.memo'd children
    const currentSelectedIds = useEditorStore.getState().selectedElementIds;
    const currentSlide = usePresentationStore.getState().presentation.slides[activeSlideId];

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
  }, [activeSlideId, setSelectedElements]);

  // Snap a dragged element's position to grid and alignment guides. Returns
  // the position unchanged (with no guides) when snapping is off or the
  // element is missing.
  const computeDragSnap = useCallback((id: string, x: number, y: number): { snappedX: number; snappedY: number; guides: Guide[] } => {
    const el = slide?.elements[id];
    const { snapToGrid: snappingEnabled, showGrid: isGridVisible, gridSize: grid, marginLayoutId: currentMarginLayoutId } = useEditorStore.getState();
    // Shift key disables snapping for precise placement
    const effectiveSnapping = snappingEnabled && !isShiftHeld();
    if (!effectiveSnapping || !el) return { snappedX: x, snappedY: y, guides: [] };

    const marginLayout = getMarginLayout(currentMarginLayoutId);
    const marginBounds = marginLayout ? getMarginBounds(marginLayout) : null;

    // Filter out all elements being dragged for guide computation
    const draggedIds = new Set(dragStartPositions.current.keys());
    const others = elements
      .filter((e) => !draggedIds.has(e.id) && e.visible)
      .map((e) => ({ x: e.x, y: e.y, width: e.width, height: e.height }));

    // Compute guides based on the dragged element
    const dragged = { x, y, width: el.width, height: el.height };
    const result = computeGuides(dragged, others, 5, marginBounds);

    let snappedX = x;
    let snappedY = y;

    if (isGridVisible) {
      snappedX = snapToGridFn(x, grid);
      snappedY = snapToGridFn(y, grid);
    }
    if (result.snapX !== null) snappedX = result.snapX;
    if (result.snapY !== null) snappedY = result.snapY;

    return { snappedX, snappedY, guides: result.guides };
  }, [slide, elements]);

  const handleDragMove = useCallback((id: string, x: number, y: number) => {
    // Any actual movement cancels the long-press timer — drag and long-press
    // are mutually exclusive.
    cancelElementLongPress();
    // Mark that an actual drag is happening (mouse moved while button down)
    isElementDragging.current = true;

    if (!slide) return;
    const el = slide.elements[id];
    if (!el) return;

    // Get the original position of the dragged element for delta calculation
    const originalPos = dragStartPositions.current.get(id);
    if (!originalPos) return;

    const { snappedX, snappedY, guides: snapGuides } = computeDragSnap(id, x, y);
    setDragGuides(snapGuides);

    // Calculate snapped delta
    const snappedDeltaX = snappedX - originalPos.x;
    const snappedDeltaY = snappedY - originalPos.y;

    // Create previews for all dragged elements
    const previews: DragPreviewState[] = [];
    for (const [elementId, startPos] of dragStartPositions.current) {
      const element = slide.elements[elementId];
      if (!element) continue;

      const newX = startPos.x + snappedDeltaX;
      const newY = startPos.y + snappedDeltaY;
      const isLine = element.type === 'shape' && isLinePath(element as ShapeElement);

      previews.push({
        isDragging: true,
        elementType: isLine ? 'line' : 'rect',
        x: newX,
        y: newY,
        width: element.width,
        height: element.height,
        rotation: element.rotation,
        points: isLine ? (element as ShapeElement).points : undefined,
      });
    }

    setDragPreview(previews.length > 0 ? previews : null);
  }, [slide, computeDragSnap, cancelElementLongPress]);

  const justFinishedElementDrag = useRef(false);

  const handleDragEnd = useCallback((id: string, x: number, y: number) => {
    cancelElementLongPress();
    // If a long-press just fired, swallow the rest of this pointerup — we
    // showed a menu, don't also enter edit mode / fire click handlers.
    if (longPressFiredRef.current) {
      longPressFiredRef.current = false;
      pendingTextEdit.current = null;
      dragStartPositions.current.clear();
      setDragGuides([]);
      setDragPreview(null);
      isElementDragging.current = false;
      draggingElementId.current = null;
      return;
    }
    setDragGuides([]);
    setDragPreview(null);
    const didDrag = isElementDragging.current;
    justFinishedElementDrag.current = didDrag;
    isElementDragging.current = false;
    draggingElementId.current = null;

    // If no actual drag happened and we had a pending text edit, enter edit mode
    if (!didDrag && pendingTextEdit.current && pendingTextEdit.current.id === id) {
      const { id: textId, localX, localY } = pendingTextEdit.current;
      pendingTextEdit.current = null;
      setEditingTextId(textId, { x: localX, y: localY });
      dragStartPositions.current.clear();
      return;
    }
    pendingTextEdit.current = null;

    if (!activeSlideId || !slide) {
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
    const updates: Array<{ elementId: string; changes: { x: number; y: number } }> = [];
    for (const [elementId, startPos] of dragStartPositions.current) {
      const element = slide.elements[elementId];
      if (!element) continue;

      const newX = startPos.x + snappedDeltaX;
      const newY = startPos.y + snappedDeltaY;

      // Only include if position actually changed
      if (newX !== element.x || newY !== element.y) {
        updates.push({ elementId, changes: { x: newX, y: newY } });
      }
    }

    // Batch update all elements (single undo operation)
    if (updates.length > 0) {
      updateElements(activeSlideId, updates);
    }

    dragStartPositions.current.clear();
  }, [activeSlideId, updateElements, slide, computeDragSnap, setEditingTextId, cancelElementLongPress]);

  const { handlePointerDown: handleElementPointerDown } = useSVGDrag({
    zoom,
    onDragStart: handleDragStart,
    onDragMove: handleDragMove,
    onDragEnd: handleDragEnd,
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
          const dup = duplicateElement(target);
          addElement(slideId, dup);
          setSelectedElements([dup.id]);
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
  }, [addElement, deleteElements, setSelectedElements, updateElement]);

  const handleSelect = useCallback((id: string, e: React.PointerEvent) => {
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

    const clickedElement = currentSlide?.elements[id];
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

    isElementDragging.current = false;

    if (metaPressed) {
      const ids = currentSelectedIds.includes(id)
        ? currentSelectedIds.filter((sid) => sid !== id)
        : [...currentSelectedIds, id];
      setSelectedElements(ids);
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
    if (!slide) return;
    const el = slide.elements[id];
    if (el && el.type === 'text') {
      setEditingTextId(id);
    }
  }, [slide, setEditingTextId]);

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
    if (e.target === e.currentTarget || (e.target as Element).classList.contains('svg-background')) {
      clearSelection();
    }
  }, [clearSelection, justFinishedDrawing]);

  // Selection drag handlers (pointer-based; mouse/touch/stylus all share this path)
  const handleCanvasPointerDown = useCallback((e: React.PointerEvent) => {
    // Ignore non-primary mouse buttons (right click). Middle-click panning is
    // handled separately below.
    if (e.pointerType === 'mouse' && e.button !== 0) return;

    if (tool !== 'select') {
      handleDrawPointerDown(e, screenToSVG);
      return;
    }

    // Only start selection drag on background
    const target = e.target as Element;
    if (target.classList.contains('svg-background') || target === svgRef.current) {
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

  const handleCanvasPointerUp = useCallback(() => {
    if (tool !== 'select') {
      handleDrawPointerUp();
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
        .map((el) => el.id);
      setSelectedElements(selectedIds);
      justFinishedSelectionDrag.current = true;
    }

    setSelectionDrag(null);
  }, [tool, handleDrawPointerUp, selectionDrag, elements, setSelectedElements]);

  // Two-finger pan/zoom via pointer events. Composes with the existing single-
  // pointer drag handlers above — the gesture hook only fires once a second
  // pointer is down, so single-finger drags / clicks aren't affected.
  const gestureActiveRef = useRef(false);
  const gesture = usePointerGesture({
    onGestureStart: () => {
      gestureActiveRef.current = true;
      // Cancel any in-flight single-pointer drag UI so it doesn't fight us.
      setDragGuides([]);
      setDragPreview(null);
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
    // Exit text edit mode when starting any transform
    if (editingTextId) {
      setEditingTextId(null);
    }
  }, [editingTextId, setEditingTextId]);

  const handleTransform = useCallback((id: string, attrs: Record<string, number>) => {
    // Show preview instead of updating element directly (better performance)
    const el = slide?.elements[id];
    if (!el) return;

    const isLine = el.type === 'shape' && isLinePath(el as ShapeElement);
    setTransformPreview({
      isDragging: true,
      elementType: isLine ? 'line' : 'rect',
      x: attrs.x ?? el.x,
      y: attrs.y ?? el.y,
      width: attrs.width ?? el.width,
      height: attrs.height ?? el.height,
      rotation: attrs.rotation ?? el.rotation,
      cursorX: attrs.cursorX,
      cursorY: attrs.cursorY,
      points: isLine ? (el as ShapeElement).points : undefined,
    });
  }, [slide]);

  const justFinishedTransform = useRef(false);

  const handleTransformEnd = useCallback((id: string, attrs: Record<string, number>) => {
    setTransformPreview(null);
    // eslint-disable-next-line react-hooks/immutability -- ref-flag pattern: set on transform end, consumed by the following background click; event-handler-only mutation
    justFinishedTransform.current = true;
    if (activeSlideId) {
      updateElement(activeSlideId, id, attrs);
    }
  }, [activeSlideId, updateElement]);

  // Line endpoint update handler
  const handleLineUpdate = useCallback((attrs: Partial<ShapeElement>) => {
    if (activeSlideId && soleSelectedLineElement) {
      updateElement(activeSlideId, soleSelectedLineElement.id, attrs);
    }
  }, [activeSlideId, soleSelectedLineElement, updateElement]);

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
    return slide?.elements[hoveredObjectId] ?? objectElements[hoveredObjectId] ?? null;
  }, [hoveredObjectId, slide, objectElements]);

  const isHoveredVisibleOnSlide = hoveredObjectId ? !!(slide?.elements[hoveredObjectId]?.visible) : false;

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
        onPointerUp={(e) => {
          gesture.onPointerUp(e);
          handleCanvasPointerUp();
        }}
        onPointerCancel={(e) => {
          gesture.onPointerCancel(e);
          handleCanvasPointerUp();
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
        <g className="content-layer">
          {elements.map((el) => (
            <SVGElementRenderer
              key={el.id}
              element={el}
              disableInteraction={tool !== 'select'}
              editingTextId={editingTextId}
              onPointerDown={handleSelect}
              onMouseEnter={handleMouseEnter}
              onMouseLeave={handleMouseLeave}
              onDoubleClick={handleDoubleClick}
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
          <SVGDragPreview preview={dragPreview} zoom={zoom} />
          <SVGDragPreview preview={transformPreview} zoom={zoom} />
          <SVGPeerSelectionOverlay slideId={activeSlideId || null} elements={elements} zoom={zoom} />

          {/* Selection transformer — suppressed for sole line/arrow (uses
              endpoint handles instead) and for sole polygon/bspline (uses
              per-vertex handles instead). */}
          {unlockedSelectedIds.length > 0 && !soleSelectedLineElement && !soleSelectedPolyElement && (
            <SVGSelectionTransformer
              elements={elements}
              selectedIds={unlockedSelectedIds}
              zoom={zoom}
              svgRef={svgRef}
              onTransformStart={handleTransformStart}
              onTransform={handleTransform}
              onTransformEnd={handleTransformEnd}
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

          {/* Polygon / B-spline vertex handles */}
          {soleSelectedPolyElement && !soleSelectedPolyElement.locked && (
            <SVGPolyVertexHandles
              element={soleSelectedPolyElement}
              elements={elements}
              zoom={zoom}
              svgRef={svgRef}
              onUpdate={(attrs) => activeSlideId && updateElement(activeSlideId, soleSelectedPolyElement.id, attrs)}
              onTransformStart={handleTransformStart}
              onConnectorHighlight={setConnectorHighlightId}
            />
          )}

          {/* Line/Arrow endpoint handles */}
          {soleSelectedLineElement && !soleSelectedLineElement.locked && (
            <SVGLineEndpointHandles
              element={soleSelectedLineElement}
              elements={elements}
              zoom={zoom}
              svgRef={svgRef}
              onUpdate={handleLineUpdate}
              onTransformStart={handleTransformStart}
              onGuidesChange={setDragGuides}
              onConnectorHighlight={setConnectorHighlightId}
            />
          )}

          {/* Connector highlight */}
          {connectorHighlightId && slide && slide.elements[connectorHighlightId] && (
            <SVGConnectorHighlight element={slide.elements[connectorHighlightId]} />
          )}

          {/* Hover overlay */}
          {hoveredElement && !selectedElementIds.includes(hoveredElement.id) && (
            <SVGHoverOverlay element={hoveredElement} isVisibleOnSlide={isHoveredVisibleOnSlide} zoom={zoom} />
          )}
        </g>
      </svg>

      {/* HTML overlays */}
      <TextEditOverlay stageRef={containerRef} zoom={zoom} />
      <CropOverlay stageRef={containerRef} zoom={zoom} />
      {visibleElements.map((el) => (
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
