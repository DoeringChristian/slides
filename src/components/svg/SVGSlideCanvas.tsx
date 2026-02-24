import React, { useRef, useCallback, useMemo, useState, useEffect, useLayoutEffect, type DragEvent } from 'react';
import { useEditorStore } from '../../store/editorStore';
import { usePresentationStore } from '../../store/presentationStore';
import { useActiveSlide, useObjectElements } from '../../store/selectors';
import { SVGBackground } from './SVGBackground';
import { SVGElementRenderer } from './SVGElementRenderer';
import { SVGGridOverlay } from './SVGGridOverlay';
import { SVGAlignmentGuides } from './SVGAlignmentGuides';
import { SVGMarginGuides } from './SVGMarginGuides';
import { SVGHoverOverlay } from './SVGHoverOverlay';
import { SVGConnectorHighlight } from './SVGConnectorHighlight';
import { SVGDrawingPreview } from './SVGDrawingPreview';
import { SVGDragPreview, type DragPreviewState } from './SVGDragPreview';
import { SVGSelectionDrag } from './SVGSelectionDrag';
import { SVGSelectionTransformer } from './SVGSelectionTransformer';
import { SVGLineEndpointHandles } from './SVGLineEndpointHandles';
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
import { loadImageFile, loadPdfFile, loadVideoFile } from '../../utils/slideFactory';
import { isPointOnTextContent } from '../../utils/textHitTest';
import type { ShapeElement, TextElement } from '../../types/presentation';

interface Guide {
  type: 'horizontal' | 'vertical';
  position: number;
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
  const unhideElement = usePresentationStore((s) => s.unhideElement);
  const addEmptySlide = usePresentationStore((s) => s.addEmptySlide);
  const setActiveSlide = useEditorStore((s) => s.setActiveSlide);
  const addElement = usePresentationStore((s) => s.addElement);
  const addResource = usePresentationStore((s) => s.addResource);

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

  // Determine if sole selected element is a visible line/arrow
  const soleSelectedLineElement = useMemo(() => {
    if (selectedElementIds.length !== 1 || !slide) return null;
    const el = slide.elements[selectedElementIds[0]];
    if (el && el.visible && el.type === 'shape' && (el.shapeType === 'line' || el.shapeType === 'arrow')) {
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

  // Drawing hook
  const { drawState, guides: drawingGuides, handleMouseDown: handleDrawMouseDown, handleMouseMove: handleDrawMouseMove, handleMouseUp: handleDrawMouseUp, justFinishedDrawing } = useSVGDrawing();

  // Combine drag and drawing guides
  const guides = drawState.isDrawing ? drawingGuides : dragGuides;

  // Drag handling
  const handleDragStart = useCallback((id: string) => {
    // Don't set isElementDragging here - we only want to set it when actual movement happens
    // This allows single-click on text to enter edit mode
    draggingElementId.current = id;

    // Capture initial positions of all selected elements for multi-element drag
    dragStartPositions.current.clear();
    const idsToTrack = selectedElementIds.includes(id) ? selectedElementIds : [id];
    if (slide) {
      for (const elementId of idsToTrack) {
        const el = slide.elements[elementId];
        if (el && !el.locked) {
          dragStartPositions.current.set(elementId, { x: el.x, y: el.y });
        }
      }
    }

    if (!selectedElementIds.includes(id)) {
      setSelectedElements([id]);
    }
  }, [selectedElementIds, setSelectedElements, slide]);

  const handleDragMove = useCallback((id: string, x: number, y: number) => {
    // Mark that an actual drag is happening (mouse moved while button down)
    isElementDragging.current = true;

    if (!slide) return;
    const el = slide.elements[id];
    if (!el) return;

    // Get the original position of the dragged element for delta calculation
    const originalPos = dragStartPositions.current.get(id);
    if (!originalPos) return;

    const { snapToGrid: snappingEnabled, showGrid: isGridVisible, gridSize: grid, marginLayoutId: currentMarginLayoutId } = useEditorStore.getState();
    // Shift key disables snapping for precise placement
    const effectiveSnapping = snappingEnabled && !isShiftHeld();
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
    setDragGuides(effectiveSnapping ? result.guides : []);

    let snappedX = x;
    let snappedY = y;

    if (effectiveSnapping) {
      if (isGridVisible) {
        snappedX = snapToGridFn(x, grid);
        snappedY = snapToGridFn(y, grid);
      }
      if (result.snapX !== null) snappedX = result.snapX;
      if (result.snapY !== null) snappedY = result.snapY;
    }

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
      const isLine = element.type === 'shape' && ((element as ShapeElement).shapeType === 'line' || (element as ShapeElement).shapeType === 'arrow');

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
  }, [slide, elements]);

  const justFinishedElementDrag = useRef(false);

  const handleDragEnd = useCallback((id: string, x: number, y: number) => {
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

    const { snapToGrid: snappingEnabled, showGrid: isGridVisible, gridSize: grid, marginLayoutId: currentMarginLayoutId } = useEditorStore.getState();
    // Shift key disables snapping for precise placement
    const effectiveSnapping = snappingEnabled && !isShiftHeld();
    const marginLayout = getMarginLayout(currentMarginLayoutId);
    const marginBounds = marginLayout ? getMarginBounds(marginLayout) : null;
    const el = slide.elements[id];

    let snappedX = x;
    let snappedY = y;

    if (effectiveSnapping && el) {
      // Filter out all elements being dragged for guide computation
      const draggedIds = new Set(dragStartPositions.current.keys());
      const dragged = { x, y, width: el.width, height: el.height };
      const others = elements
        .filter((e) => !draggedIds.has(e.id) && e.visible)
        .map((e) => ({ x: e.x, y: e.y, width: e.width, height: e.height }));
      const result = computeGuides(dragged, others, 5, marginBounds);

      if (isGridVisible) {
        snappedX = snapToGridFn(x, grid);
        snappedY = snapToGridFn(y, grid);
      }

      if (result.snapX !== null) snappedX = result.snapX;
      if (result.snapY !== null) snappedY = result.snapY;
    }

    // Calculate snapped delta
    const snappedDeltaX = snappedX - originalPos.x;
    const snappedDeltaY = snappedY - originalPos.y;

    // Update all dragged elements
    for (const [elementId, startPos] of dragStartPositions.current) {
      const element = slide.elements[elementId];
      if (!element) continue;

      const newX = startPos.x + snappedDeltaX;
      const newY = startPos.y + snappedDeltaY;

      // Only update if position actually changed (avoids re-render that breaks dblclick)
      if (newX !== element.x || newY !== element.y) {
        updateElement(activeSlideId, elementId, { x: newX, y: newY });
      }
    }

    dragStartPositions.current.clear();
  }, [activeSlideId, updateElement, slide, elements, setEditingTextId]);

  const { handleMouseDown: handleElementMouseDown } = useSVGDrag({
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

  const handleSelect = useCallback((id: string, e: React.MouseEvent) => {
    const metaPressed = e.shiftKey || e.ctrlKey || e.metaKey;

    const clickedElement = slide?.elements[id];
    const isTextElement = clickedElement?.type === 'text';

    if (editingTextId === id) {
      // We're editing this text element - check if click is on border (not text content)
      // If on border, exit edit mode and allow drag to start
      if (isTextElement && clickedElement) {
        const pos = screenToSVG(e.clientX, e.clientY);

        // Transform click to local coordinates (handle rotation)
        const centerX = clickedElement.x + clickedElement.width / 2;
        const centerY = clickedElement.y + clickedElement.height / 2;
        const relCenterX = pos.x - centerX;
        const relCenterY = pos.y - centerY;
        const rotation = clickedElement.rotation || 0;
        const radians = -rotation * Math.PI / 180;
        const cos = Math.cos(radians);
        const sin = Math.sin(radians);
        const unrotatedRelX = relCenterX * cos - relCenterY * sin;
        const unrotatedRelY = relCenterX * sin + relCenterY * cos;
        const localX = unrotatedRelX + clickedElement.width / 2;
        const localY = unrotatedRelY + clickedElement.height / 2;

        if (!isPointOnTextContent(clickedElement as TextElement, { x: localX, y: localY })) {
          // Click is on border, not text - exit edit mode and start drag
          setEditingTextId(null);
          if (!clickedElement.locked) {
            handleElementMouseDown(id, clickedElement.x, clickedElement.y, e);
          }
        }
      }
      return;
    }

    if (editingTextId && editingTextId !== id) {
      setEditingTextId(null);
    }

    isElementDragging.current = false;

    if (metaPressed) {
      const ids = selectedElementIds.includes(id)
        ? selectedElementIds.filter((sid) => sid !== id)
        : [...selectedElementIds, id];
      setSelectedElements(ids);
    } else {
      // Only reset selection if clicking on an unselected element
      // This preserves multi-selection when dragging one of the selected elements
      const isAlreadySelected = selectedElementIds.includes(id);
      if (!isAlreadySelected) {
        setSelectedElements([id]);
      }

      // Store click info for potential edit-mode entry on mouseup (no drag)
      if (isTextElement && clickedElement) {
        const pos = screenToSVG(e.clientX, e.clientY);
        const centerX = clickedElement.x + clickedElement.width / 2;
        const centerY = clickedElement.y + clickedElement.height / 2;
        const relCenterX = pos.x - centerX;
        const relCenterY = pos.y - centerY;
        const rotation = clickedElement.rotation || 0;
        const radians = -rotation * Math.PI / 180;
        const cos = Math.cos(radians);
        const sin = Math.sin(radians);
        const localX = relCenterX * cos - relCenterY * sin + clickedElement.width / 2;
        const localY = relCenterX * sin + relCenterY * cos + clickedElement.height / 2;

        if (isPointOnTextContent(clickedElement as TextElement, { x: localX, y: localY })) {
          pendingTextEdit.current = { id, localX, localY };
        }
      }

      // Always start drag
      if (!clickedElement?.locked) {
        handleElementMouseDown(id, clickedElement?.x || 0, clickedElement?.y || 0, e);
      }
    }
  }, [selectedElementIds, setSelectedElements, editingTextId, setEditingTextId, slide, screenToSVG, handleElementMouseDown]);

  const handleDoubleClick = useCallback((id: string) => {
    if (!slide) return;
    const el = slide.elements[id];
    if (el && el.type === 'text') {
      setEditingTextId(id);
    }
  }, [slide, setEditingTextId]);

  const handleMouseEnter = useCallback((id: string) => {
    setHoveredObjectId(id);
  }, [setHoveredObjectId]);

  const handleMouseLeave = useCallback(() => {
    setHoveredObjectId(null);
  }, [setHoveredObjectId]);

  const handleStageClick = useCallback((e: React.MouseEvent) => {
    if (justFinishedSelectionDrag.current) {
      justFinishedSelectionDrag.current = false;
      return;
    }
    if (justFinishedDrawing.current) {
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

  // Selection drag handlers
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (tool !== 'select') {
      handleDrawMouseDown(e, screenToSVG);
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
  }, [tool, handleDrawMouseDown, screenToSVG]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (tool !== 'select') {
      handleDrawMouseMove(e, screenToSVG);
      return;
    }

    if (!selectionDrag?.isSelecting) return;
    const pos = screenToSVG(e.clientX, e.clientY);
    setSelectionDrag((prev) => prev ? { ...prev, currentX: pos.x, currentY: pos.y } : null);
  }, [tool, handleDrawMouseMove, screenToSVG, selectionDrag?.isSelecting]);

  const handleMouseUp = useCallback(() => {
    if (tool !== 'select') {
      handleDrawMouseUp();
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
  }, [tool, handleDrawMouseUp, selectionDrag, elements, setSelectedElements]);

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

    const isLine = el.type === 'shape' && ((el as ShapeElement).shapeType === 'line' || (el as ShapeElement).shapeType === 'arrow');
    setTransformPreview({
      isDragging: true,
      elementType: isLine ? 'line' : 'rect',
      x: attrs.x ?? el.x,
      y: attrs.y ?? el.y,
      width: attrs.width ?? el.width,
      height: attrs.height ?? el.height,
      rotation: attrs.rotation ?? el.rotation,
      points: isLine ? (el as ShapeElement).points : undefined,
    });
  }, [slide]);

  const justFinishedTransform = useRef(false);

  const handleTransformEnd = useCallback((id: string, attrs: Record<string, number>) => {
    setTransformPreview(null);
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
      const factor = Math.pow(1.005, -e.deltaY);
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
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
        }}
        onClick={handleStageClick}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
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
              onMouseDown={handleSelect}
              onMouseEnter={handleMouseEnter}
              onMouseLeave={handleMouseLeave}
              onDoubleClick={handleDoubleClick}
            />
          ))}
        </g>

        {/* UI layer */}
        <g className="ui-layer">
          <SVGGridOverlay gridSize={gridSize} visible={showGrid} />
          <SVGMarginGuides />
          <SVGAlignmentGuides guides={guides} />
          <SVGSelectionDrag selectionDrag={selectionDrag} />
          <SVGDrawingPreview drawState={drawState} tool={tool} />
          <SVGDragPreview preview={dragPreview} />
          <SVGDragPreview preview={transformPreview} />

          {/* Selection transformer */}
          {unlockedSelectedIds.length > 0 && !soleSelectedLineElement && (
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
            <SVGHoverOverlay element={hoveredElement} isVisibleOnSlide={isHoveredVisibleOnSlide} />
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
