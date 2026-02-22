import React, { useRef, useCallback, useMemo, useState, useEffect, type DragEvent } from 'react';
import { Stage, Layer, Rect } from 'react-konva';
import { useEditorStore } from '../../store/editorStore';
import { usePresentationStore } from '../../store/presentationStore';
import { useActiveSlide, useObjectElements } from '../../store/selectors';
import { CanvasBackground } from './CanvasBackground';
import { ElementRenderer } from './ElementRenderer';
import { SelectionTransformer } from './SelectionTransformer';
import { LineEndpointHandles } from './LineEndpointHandles';
import { AlignmentGuides } from './AlignmentGuides';
import { ConnectorHighlight } from './ConnectorHighlight';
import { HoverOverlay } from './HoverOverlay';
import { TextEditOverlay } from './TextEditOverlay';
import { MarkdownTextOverlay } from './MarkdownTextOverlay';
import { CropOverlay } from './CropOverlay';
import { SelectionActionBar } from './SelectionActionBar';
import { DrawingPreview, useDrawing } from './DrawingLayer';
import { GridOverlay } from './GridOverlay';
import { MarginGuidesOverlay } from './MarginGuidesOverlay';
import { computeGuides } from '../../hooks/useAlignmentGuides';
import { getMarginLayout, getMarginBounds } from '../../utils/marginLayouts';
import { getBindingTarget, getAnchorPoint } from '../../utils/connectorUtils';
import { snapToGrid as snapToGridFn } from '../../utils/geometry';
import { isCtrlHeld } from '../../utils/keyboard';
import { SLIDE_WIDTH, SLIDE_HEIGHT, CANVAS_PADDING } from '../../utils/constants';
import { loadImageFile, loadPdfFile, loadVideoFile } from '../../utils/slideFactory';
import type { ShapeElement, TextElement } from '../../types/presentation';
import type Konva from 'konva';
import { isPointOnTextContent } from '../../utils/textHitTest';

interface Guide {
  type: 'horizontal' | 'vertical';
  position: number;
}

export const SlideCanvas: React.FC = () => {
  const containerRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<Konva.Stage>(null);

  const zoom = useEditorStore((s) => s.zoom);
  const setZoom = useEditorStore((s) => s.setZoom);
  const tool = useEditorStore((s) => s.tool);
  const selectedElementIds = useEditorStore((s) => s.selectedElementIds);
  const setSelectedElements = useEditorStore((s) => s.setSelectedElements);
  const setEditingTextId = useEditorStore((s) => s.setEditingTextId);
  const editingTextId = useEditorStore((s) => s.editingTextId);
  const activeSlideId = useEditorStore((s) => s.activeSlideId);
  const showGrid = useEditorStore((s) => s.showGrid);
  const gridSize = useEditorStore((s) => s.gridSize);
  const hoveredObjectId = useEditorStore((s) => s.hoveredObjectId);
  const snapToGrid = useEditorStore((s) => s.snapToGrid);
  const marginLayoutId = useEditorStore((s) => s.marginLayoutId);
  const updateElement = usePresentationStore((s) => s.updateElement);
  const unhideElement = usePresentationStore((s) => s.unhideElement);
  const addEmptySlide = usePresentationStore((s) => s.addEmptySlide);
  const setActiveSlide = useEditorStore((s) => s.setActiveSlide);

  const slide = useActiveSlide();
  const objectElements = useObjectElements();
  const { drawState, guides: drawingGuides, handleMouseDown: handleDrawMouseDown, handleMouseMove: handleDrawMouseMove, handleMouseUp: handleDrawMouseUp } = useDrawing();

  const [dragGuides, setDragGuides] = useState<Guide[]>([]);
  // Combine drag and drawing guides
  const guides = drawState.isDrawing ? drawingGuides : dragGuides;
  const [connectorHighlightId, setConnectorHighlightId] = useState<string | null>(null);

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

  // Bounds of non-selected visible elements for resize snapping
  const otherElementBounds = useMemo(() => {
    const selectedSet = new Set(selectedElementIds);
    return elements
      .filter((e) => !selectedSet.has(e.id) && e.visible)
      .map((e) => ({ x: e.x, y: e.y, width: e.width, height: e.height }));
  }, [elements, selectedElementIds]);

  // Determine if sole selected element is a visible line/arrow
  const soleSelectedLineElement = useMemo(() => {
    if (selectedElementIds.length !== 1 || !slide) return null;
    const el = slide.elements[selectedElementIds[0]];
    if (el && el.visible && el.type === 'shape' && (el.shapeType === 'line' || el.shapeType === 'arrow')) {
      return el as ShapeElement;
    }
    return null;
  }, [selectedElementIds, slide]);

  // Split selected IDs into locked vs unlocked for separate transformer treatment
  const { unlockedTransformerIds, lockedTransformerIds } = useMemo(() => {
    if (soleSelectedLineElement) return { unlockedTransformerIds: [], lockedTransformerIds: [] };
    if (!slide) return { unlockedTransformerIds: selectedElementIds, lockedTransformerIds: [] };
    const unlocked: string[] = [];
    const locked: string[] = [];
    for (const id of selectedElementIds) {
      if (slide.elements[id]?.locked) locked.push(id);
      else unlocked.push(id);
    }
    return { unlockedTransformerIds: unlocked, lockedTransformerIds: locked };
  }, [selectedElementIds, soleSelectedLineElement, slide]);

  // Keep aspect ratio only when all selected elements are images
  const shouldKeepRatio = useMemo(() => {
    if (!slide || selectedElementIds.length === 0) return false;
    return selectedElementIds.every((id) => {
      const el = slide.elements[id];
      return el && el.type === 'image';
    });
  }, [selectedElementIds, slide]);

  // Track if we just completed a selection drag or drawing to prevent click from clearing selection
  const justFinishedSelectionDrag = useRef(false);
  const lastDrawingFinishedAt = useRef(0);
  // Track element dragging to prevent entering edit mode after drag
  const isElementDragging = useRef(false);

  const handleStageClick = useCallback((e: Konva.KonvaEventObject<MouseEvent>) => {
    // Don't clear selection if we just finished a drag selection
    if (justFinishedSelectionDrag.current) {
      justFinishedSelectionDrag.current = false;
      return;
    }
    // Don't clear selection if we just finished drawing (within 100ms)
    if (Date.now() - lastDrawingFinishedAt.current < 100) {
      return;
    }
    if (e.target === e.target.getStage()) {
      setSelectedElements([]);
      setEditingTextId(null);
    }
  }, [setSelectedElements, setEditingTextId]);

  const handleSelect = useCallback((id: string, e: Konva.KonvaEventObject<MouseEvent>) => {
    const metaPressed = e.evt.shiftKey || e.evt.ctrlKey || e.evt.metaKey;

    // Check if clicking on a text element
    const clickedElement = slide?.elements[id];
    const isTextElement = clickedElement?.type === 'text';

    // If already editing this text element, let the textarea handle clicks
    if (editingTextId === id) return;

    // If clicking on a different element while editing, exit edit mode first
    if (editingTextId && editingTextId !== id) {
      setEditingTextId(null);
    }

    // Skip entering edit mode if we just finished dragging
    const wasDragging = isElementDragging.current;
    isElementDragging.current = false;

    if (metaPressed) {
      const ids = selectedElementIds.includes(id)
        ? selectedElementIds.filter((sid) => sid !== id)
        : [...selectedElementIds, id];
      setSelectedElements(ids);
    } else {
      setSelectedElements([id]);
      // Auto-enter edit mode for text elements only if clicking on actual text content
      // and not after a drag operation
      if (isTextElement && clickedElement && !wasDragging) {
        // Get click position relative to the element
        const stage = e.target.getStage();
        if (stage) {
          const pointerPos = stage.getPointerPosition();
          if (pointerPos) {
            // Convert to element-local coordinates
            const localX = pointerPos.x / zoom - CANVAS_PADDING - clickedElement.x;
            const localY = pointerPos.y / zoom - CANVAS_PADDING - clickedElement.y;

            // Only enter edit mode if click is on actual text content
            if (isPointOnTextContent(clickedElement as TextElement, { x: localX, y: localY })) {
              setEditingTextId(id, { x: localX, y: localY });
            }
          }
        }
      }
    }
  }, [selectedElementIds, setSelectedElements, editingTextId, setEditingTextId, slide, zoom]);

  const handleTransformEnd = useCallback((id: string, attrs: Record<string, number>) => {
    if (activeSlideId) {
      updateElement(activeSlideId, id, attrs);
    }
  }, [activeSlideId, updateElement]);

  const handleDragMove = useCallback((id: string, x: number, y: number, node: Konva.Node) => {
    if (!slide) return;
    const el = slide.elements[id];
    if (!el) return;

    // Mark that we're dragging to prevent entering edit mode on click
    isElementDragging.current = true;

    // Select the element immediately when dragging starts
    if (!selectedElementIds.includes(id)) {
      setSelectedElements([id]);
    }

    // Check if this is a center-based shape (ellipse, triangle, star use center positioning in Konva)
    const isCenterBased = el.type === 'shape' && ['ellipse', 'triangle', 'star'].includes((el as ShapeElement).shapeType);

    // Ctrl-constrain: lock to horizontal or vertical axis
    let constrainedX = x;
    let constrainedY = y;
    if (isCtrlHeld()) {
      const dx = Math.abs(x - el.x);
      const dy = Math.abs(y - el.y);
      if (dx >= dy) {
        constrainedY = el.y; // horizontal lock
      } else {
        constrainedX = el.x; // vertical lock
      }
      // Convert to node coordinates (center for center-based shapes)
      const nodeX = isCenterBased ? constrainedX + el.width / 2 : constrainedX;
      const nodeY = isCenterBased ? constrainedY + el.height / 2 : constrainedY;
      node.x(nodeX);
      node.y(nodeY);
    }

    const { snapToGrid: snappingEnabled, showGrid: isGridVisible, gridSize: grid, marginLayoutId: currentMarginLayoutId } = useEditorStore.getState();
    const marginLayout = getMarginLayout(currentMarginLayoutId);
    const marginBounds = marginLayout ? getMarginBounds(marginLayout) : null;

    // Compute alignment guides from (possibly constrained) position
    const dragged = { x: constrainedX, y: constrainedY, width: el.width, height: el.height };
    const others = elements
      .filter((e) => e.id !== id && e.visible)
      .map((e) => ({ x: e.x, y: e.y, width: e.width, height: e.height }));
    const result = computeGuides(dragged, others, 5, marginBounds);
    setDragGuides(snappingEnabled ? result.guides : []);

    if (snappingEnabled) {
      let snappedX = constrainedX;
      let snappedY = constrainedY;

      // Grid snap (only when grid is visible)
      if (isGridVisible) {
        snappedX = snapToGridFn(constrainedX, grid);
        snappedY = snapToGridFn(constrainedY, grid);
      }

      // Alignment guides override grid snap
      if (result.snapX !== null) snappedX = result.snapX;
      if (result.snapY !== null) snappedY = result.snapY;

      // Convert to node coordinates (center for center-based shapes)
      const nodeX = isCenterBased ? snappedX + el.width / 2 : snappedX;
      const nodeY = isCenterBased ? snappedY + el.height / 2 : snappedY;
      node.x(nodeX);
      node.y(nodeY);
    }
  }, [slide, elements, selectedElementIds, setSelectedElements]);

  const handleDragEndWithGuides = useCallback((id: string, x: number, y: number) => {
    setDragGuides([]);
    if (!activeSlideId) return;

    const { snapToGrid: snappingEnabled, showGrid: isGridVisible, gridSize: grid, marginLayoutId: currentMarginLayoutId } = useEditorStore.getState();
    const marginLayout = getMarginLayout(currentMarginLayoutId);
    const marginBounds = marginLayout ? getMarginBounds(marginLayout) : null;
    const el = slide?.elements[id];

    // Ctrl-constrain: lock to horizontal or vertical axis
    let constrainedX = x;
    let constrainedY = y;
    if (isCtrlHeld() && el) {
      const dx = Math.abs(x - el.x);
      const dy = Math.abs(y - el.y);
      if (dx >= dy) {
        constrainedY = el.y;
      } else {
        constrainedX = el.x;
      }
    }

    let snappedX = constrainedX;
    let snappedY = constrainedY;

    if (snappingEnabled && el) {
      const dragged = { x: constrainedX, y: constrainedY, width: el.width, height: el.height };
      const others = elements
        .filter((e) => e.id !== id && e.visible)
        .map((e) => ({ x: e.x, y: e.y, width: e.width, height: e.height }));
      const result = computeGuides(dragged, others, 5, marginBounds);

      if (isGridVisible) {
        snappedX = snapToGridFn(constrainedX, grid);
        snappedY = snapToGridFn(constrainedY, grid);
      }

      if (result.snapX !== null) snappedX = result.snapX;
      if (result.snapY !== null) snappedY = result.snapY;
    }

    updateElement(activeSlideId, id, { x: snappedX, y: snappedY });
  }, [activeSlideId, updateElement, slide, elements]);

  const handleLineEndpointUpdate = useCallback((attrs: Partial<ShapeElement>) => {
    if (!activeSlideId || !soleSelectedLineElement) return;
    updateElement(activeSlideId, soleSelectedLineElement.id, attrs);
  }, [activeSlideId, soleSelectedLineElement, updateElement]);

  const handleBindingDrag = useCallback((point: { x: number; y: number }, endpoint: 'start' | 'end') => {
    if (!slide || !soleSelectedLineElement) return;
    const target = getBindingTarget(point, Object.values(slide.elements), soleSelectedLineElement.id, 30);
    setConnectorHighlightId(target ? target.elementId : null);
  }, [slide, soleSelectedLineElement]);

  const handleBindingDragEnd = useCallback((point: { x: number; y: number }, endpoint: 'start' | 'end') => {
    if (!slide || !soleSelectedLineElement || !activeSlideId) return;
    const target = getBindingTarget(point, Object.values(slide.elements), soleSelectedLineElement.id, 30);
    if (target) {
      const bindingKey = endpoint === 'start' ? 'startBinding' : 'endBinding';
      updateElement(activeSlideId, soleSelectedLineElement.id, { [bindingKey]: target } as any);
      // Snap endpoint to the anchor point
      const anchorPt = getAnchorPoint(slide.elements[target.elementId], target.anchor);
      if (anchorPt) {
        const pts = soleSelectedLineElement.points ?? [0, 0, soleSelectedLineElement.width, 0];
        if (endpoint === 'start') {
          const endAbsX = soleSelectedLineElement.x + pts[2];
          const endAbsY = soleSelectedLineElement.y + pts[3];
          updateElement(activeSlideId, soleSelectedLineElement.id, {
            x: anchorPt.x,
            y: anchorPt.y,
            points: [0, 0, endAbsX - anchorPt.x, endAbsY - anchorPt.y],
          });
        } else {
          updateElement(activeSlideId, soleSelectedLineElement.id, {
            points: [0, 0, anchorPt.x - soleSelectedLineElement.x, anchorPt.y - soleSelectedLineElement.y],
          });
        }
      }
    } else {
      const bindingKey = endpoint === 'start' ? 'startBinding' : 'endBinding';
      updateElement(activeSlideId, soleSelectedLineElement.id, { [bindingKey]: null } as any);
    }
  }, [slide, soleSelectedLineElement, activeSlideId, updateElement]);

  const handleBindingDragStop = useCallback(() => {
    setConnectorHighlightId(null);
  }, []);

  const handleDoubleClick = useCallback((id: string) => {
    if (!slide) return;
    const el = slide.elements[id];
    if (el && el.type === 'text') {
      setEditingTextId(id);
    }
  }, [slide, setEditingTextId]);

  const addElement = usePresentationStore((s) => s.addElement);

  const handleDragOver = useCallback((e: DragEvent<HTMLDivElement>) => {
    if (e.dataTransfer.types.includes('application/x-object-id') || e.dataTransfer.types.includes('Files')) {
      e.preventDefault();
      e.dataTransfer.dropEffect = e.dataTransfer.types.includes('application/x-object-id') ? 'move' : 'copy';
    }
  }, []);

  const addResource = usePresentationStore((s) => s.addResource);

  const handleDrop = useCallback((e: DragEvent<HTMLDivElement>) => {
    // Internal object drop (unhide)
    const objectId = e.dataTransfer.getData('application/x-object-id');
    if (objectId && activeSlideId && containerRef.current) {
      e.preventDefault();
      const rect = containerRef.current.getBoundingClientRect();
      const x = (e.clientX - rect.left) / zoom - CANVAS_PADDING;
      const y = (e.clientY - rect.top) / zoom - CANVAS_PADDING;
      unhideElement(activeSlideId, objectId, { x, y });
      setSelectedElements([objectId]);
      return;
    }

    // External file drop
    const files = e.dataTransfer.files;
    if (!files.length || !activeSlideId || !containerRef.current) return;
    e.preventDefault();
    const rect = containerRef.current.getBoundingClientRect();
    const dropX = (e.clientX - rect.left) / zoom - CANVAS_PADDING;
    const dropY = (e.clientY - rect.top) / zoom - CANVAS_PADDING;

    const { slideOrder } = usePresentationStore.getState().presentation;
    const currentIdx = slideOrder.indexOf(activeSlideId);

    Array.from(files).forEach(async (file) => {
      if (file.type === 'application/pdf' || file.name.endsWith('.pdf')) {
        const { resources, elements } = await loadPdfFile(file);
        resources.forEach((r) => addResource(r));
        if (elements.length === 1) {
          elements[0].x = dropX;
          elements[0].y = dropY;
          addElement(activeSlideId, elements[0]);
          setSelectedElements([elements[0].id]);
        } else {
          let insertIdx = currentIdx + 1;
          let lastSlideId = '';
          for (const pageEl of elements) {
            const newSlideId = addEmptySlide(insertIdx);
            addElement(newSlideId, pageEl);
            lastSlideId = newSlideId;
            insertIdx++;
          }
          if (lastSlideId) setActiveSlide(lastSlideId);
        }
      } else if (file.type.startsWith('image/') || file.name.endsWith('.svg')) {
        const { resource, element } = await loadImageFile(file, { x: dropX, y: dropY });
        addResource(resource);
        addElement(activeSlideId, element);
        setSelectedElements([element.id]);
      } else if (file.type.startsWith('video/')) {
        const { resource, element } = await loadVideoFile(file, { x: dropX, y: dropY });
        addResource(resource);
        addElement(activeSlideId, element);
        setSelectedElements([element.id]);
      }
    });
  }, [activeSlideId, zoom, unhideElement, setSelectedElements, addElement, addEmptySlide, setActiveSlide, addResource]);

  // Ctrl+wheel and trackpad pinch-to-zoom
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const handleWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const zoomRef = useEditorStore.getState().zoom;
      const delta = -e.deltaY * 0.01;
      setZoom(zoomRef + delta);
    };
    el.addEventListener('wheel', handleWheel, { passive: false });
    return () => el.removeEventListener('wheel', handleWheel);
  }, [setZoom]);

  // Resolve hovered element: prefer current slide, fall back to objectElements for rendering data
  const hoveredElement = useMemo(() => {
    if (!hoveredObjectId) return null;
    return slide?.elements[hoveredObjectId] ?? objectElements[hoveredObjectId] ?? null;
  }, [hoveredObjectId, slide, objectElements]);

  const isHoveredVisibleOnSlide = hoveredObjectId ? !!(slide?.elements[hoveredObjectId]?.visible) : false;

  // Find all visible elements for selection action bar
  const visibleElements = useMemo(() => {
    return elements.filter((el) => el.visible);
  }, [elements]);

  // Combined mouse handlers for drawing and selection drag
  const handleMouseDown = useCallback((e: Konva.KonvaEventObject<MouseEvent>) => {
    if (tool !== 'select') {
      handleDrawMouseDown(e);
      return;
    }
    // Only start selection drag when clicking on the stage (empty area)
    if (e.target !== e.target.getStage()) return;
    const stage = e.target.getStage();
    if (!stage) return;
    const pos = stage.getRelativePointerPosition();
    if (!pos) return;
    setSelectionDrag({
      startX: pos.x,
      startY: pos.y,
      currentX: pos.x,
      currentY: pos.y,
      isSelecting: true,
    });
  }, [tool, handleDrawMouseDown]);

  const handleMouseMove = useCallback((e: Konva.KonvaEventObject<MouseEvent>) => {
    if (tool !== 'select') {
      handleDrawMouseMove(e);
      return;
    }
    if (!selectionDrag?.isSelecting) return;
    const stage = e.target.getStage();
    if (!stage) return;
    const pos = stage.getRelativePointerPosition();
    if (!pos) return;
    setSelectionDrag((prev) => prev ? { ...prev, currentX: pos.x, currentY: pos.y } : null);
  }, [tool, handleDrawMouseMove, selectionDrag?.isSelecting]);

  const handleMouseUp = useCallback(() => {
    if (tool !== 'select') {
      handleDrawMouseUp();
      lastDrawingFinishedAt.current = Date.now();
      return;
    }
    if (!selectionDrag?.isSelecting) return;

    // Calculate selection rectangle bounds
    const x = Math.min(selectionDrag.startX, selectionDrag.currentX);
    const y = Math.min(selectionDrag.startY, selectionDrag.currentY);
    const width = Math.abs(selectionDrag.currentX - selectionDrag.startX);
    const height = Math.abs(selectionDrag.currentY - selectionDrag.startY);

    // Only select if the drag was significant (not just a click)
    if (width > 5 || height > 5) {
      // Find elements that intersect with the selection rectangle
      const selectedIds = elements
        .filter((el) => {
          if (!el.visible) return false;
          // Check if element bounds intersect with selection rectangle
          const elRight = el.x + el.width;
          const elBottom = el.y + el.height;
          const selRight = x + width;
          const selBottom = y + height;
          return !(el.x > selRight || elRight < x || el.y > selBottom || elBottom < y);
        })
        .map((el) => el.id);
      setSelectedElements(selectedIds);
      // Prevent the click handler from clearing the selection
      justFinishedSelectionDrag.current = true;
    }

    setSelectionDrag(null);
  }, [tool, handleDrawMouseUp, selectionDrag, elements, setSelectedElements]);

  const stageWidth = (SLIDE_WIDTH + 2 * CANVAS_PADDING) * zoom;
  const stageHeight = (SLIDE_HEIGHT + 2 * CANVAS_PADDING) * zoom;
  const cursor = tool === 'select' ? 'default' : 'crosshair';

  return (
    <div ref={containerRef} className="relative" style={{ width: stageWidth, height: stageHeight, cursor }}
      onDragOver={handleDragOver} onDrop={handleDrop}>
      <Stage
        ref={stageRef}
        width={stageWidth}
        height={stageHeight}
        x={CANVAS_PADDING * zoom}
        y={CANVAS_PADDING * zoom}
        scaleX={zoom}
        scaleY={zoom}
        onClick={handleStageClick}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
      >
        {/* Layer 1: Background */}
        <Layer listening={false}>
          {slide && <CanvasBackground background={slide.background} width={SLIDE_WIDTH} height={SLIDE_HEIGHT} />}
        </Layer>

        {/* Layer 2: Content */}
        <Layer>
          {elements.map((el) => (
            <ElementRenderer
              key={el.id}
              element={el}
              isSelected={selectedElementIds.includes(el.id)}
              disableInteraction={tool !== 'select'}
              onSelect={handleSelect}
              onDragEnd={handleDragEndWithGuides}
              onDragMove={handleDragMove}
              onTransformEnd={handleTransformEnd}
              onDoubleClick={handleDoubleClick}
            />
          ))}
        </Layer>

        {/* Layer 3: UI */}
        <Layer>
          <GridOverlay gridSize={gridSize} visible={showGrid} />
          <MarginGuidesOverlay />
          {/* Selection drag rectangle */}
          {selectionDrag?.isSelecting && (
            <Rect
              x={Math.min(selectionDrag.startX, selectionDrag.currentX)}
              y={Math.min(selectionDrag.startY, selectionDrag.currentY)}
              width={Math.abs(selectionDrag.currentX - selectionDrag.startX)}
              height={Math.abs(selectionDrag.currentY - selectionDrag.startY)}
              fill="rgba(66, 133, 244, 0.1)"
              stroke="#4285f4"
              strokeWidth={1}
              dash={[5, 5]}
              listening={false}
            />
          )}
          <AlignmentGuides guides={guides} />
          <SelectionTransformer
            selectedIds={unlockedTransformerIds}
            stageRef={stageRef}
            otherElementBounds={otherElementBounds}
            snappingEnabled={snapToGrid}
            zoom={zoom}
            onGuides={setDragGuides}
            keepRatio={shouldKeepRatio}
            elementCount={elements.length}
          />
          <SelectionTransformer selectedIds={lockedTransformerIds} stageRef={stageRef} locked elementCount={elements.length} />
          {soleSelectedLineElement && !editingTextId && (
            <LineEndpointHandles
              element={soleSelectedLineElement}
              zoom={zoom}
              onUpdate={handleLineEndpointUpdate}
              onBindingDrag={handleBindingDrag}
              onBindingDragEnd={handleBindingDragEnd}
              onBindingDragStop={handleBindingDragStop}
            />
          )}
          {connectorHighlightId && slide && slide.elements[connectorHighlightId] && (
            <ConnectorHighlight element={slide.elements[connectorHighlightId]} />
          )}
          {hoveredElement && <HoverOverlay element={hoveredElement} isVisibleOnSlide={isHoveredVisibleOnSlide} />}
          <DrawingPreview drawState={drawState} tool={tool} />
        </Layer>
      </Stage>

      <MarkdownTextOverlay stageRef={containerRef} zoom={zoom} />
      <TextEditOverlay stageRef={containerRef} zoom={zoom} onGuides={setDragGuides} />
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
