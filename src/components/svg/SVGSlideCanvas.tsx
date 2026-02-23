import React, { useRef, useCallback, useMemo, useState, useEffect, type DragEvent } from 'react';
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
import { SVGSelectionDrag } from './SVGSelectionDrag';
import { SVGSelectionTransformer } from './SVGSelectionTransformer';
import { useSVGDrag } from './useSVGDrag';
import { useSVGDrawing } from './useSVGDrawing';
import { TextEditOverlay } from '../canvas/TextEditOverlay';
import { CropOverlay } from '../canvas/CropOverlay';
import { SelectionActionBar } from '../canvas/SelectionActionBar';
import { computeGuides } from '../../hooks/useAlignmentGuides';
import { getMarginLayout, getMarginBounds } from '../../utils/marginLayouts';
import { snapToGrid as snapToGridFn } from '../../utils/geometry';
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
  const [connectorHighlightId, _setConnectorHighlightId] = useState<string | null>(null);

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

  // Drawing hook
  const { drawState, guides: drawingGuides, handleMouseDown: handleDrawMouseDown, handleMouseMove: handleDrawMouseMove, handleMouseUp: handleDrawMouseUp } = useSVGDrawing();

  // Combine drag and drawing guides
  const guides = drawState.isDrawing ? drawingGuides : dragGuides;

  // Drag handling
  const handleDragStart = useCallback((id: string) => {
    // Don't set isElementDragging here - we only want to set it when actual movement happens
    // This allows single-click on text to enter edit mode
    if (!selectedElementIds.includes(id)) {
      setSelectedElements([id]);
    }
  }, [selectedElementIds, setSelectedElements]);

  const handleDragMove = useCallback((id: string, x: number, y: number) => {
    // Mark that an actual drag is happening (mouse moved while button down)
    isElementDragging.current = true;

    if (!slide) return;
    const el = slide.elements[id];
    if (!el) return;

    const { snapToGrid: snappingEnabled, showGrid: isGridVisible, gridSize: grid, marginLayoutId: currentMarginLayoutId } = useEditorStore.getState();
    const marginLayout = getMarginLayout(currentMarginLayoutId);
    const marginBounds = marginLayout ? getMarginBounds(marginLayout) : null;

    const dragged = { x, y, width: el.width, height: el.height };
    const others = elements
      .filter((e) => e.id !== id && e.visible)
      .map((e) => ({ x: e.x, y: e.y, width: e.width, height: e.height }));
    const result = computeGuides(dragged, others, 5, marginBounds);
    setDragGuides(snappingEnabled ? result.guides : []);

    let snappedX = x;
    let snappedY = y;

    if (snappingEnabled) {
      if (isGridVisible) {
        snappedX = snapToGridFn(x, grid);
        snappedY = snapToGridFn(y, grid);
      }
      if (result.snapX !== null) snappedX = result.snapX;
      if (result.snapY !== null) snappedY = result.snapY;
    }

    if (activeSlideId) {
      updateElement(activeSlideId, id, { x: snappedX, y: snappedY });
    }
  }, [slide, elements, activeSlideId, updateElement]);

  const handleDragEnd = useCallback((id: string, x: number, y: number) => {
    setDragGuides([]);
    if (!activeSlideId || !slide) return;

    const { snapToGrid: snappingEnabled, showGrid: isGridVisible, gridSize: grid, marginLayoutId: currentMarginLayoutId } = useEditorStore.getState();
    const marginLayout = getMarginLayout(currentMarginLayoutId);
    const marginBounds = marginLayout ? getMarginBounds(marginLayout) : null;
    const el = slide.elements[id];

    let snappedX = x;
    let snappedY = y;

    if (snappingEnabled && el) {
      const dragged = { x, y, width: el.width, height: el.height };
      const others = elements
        .filter((e) => e.id !== id && e.visible)
        .map((e) => ({ x: e.x, y: e.y, width: e.width, height: e.height }));
      const result = computeGuides(dragged, others, 5, marginBounds);

      if (isGridVisible) {
        snappedX = snapToGridFn(x, grid);
        snappedY = snapToGridFn(y, grid);
      }

      if (result.snapX !== null) snappedX = result.snapX;
      if (result.snapY !== null) snappedY = result.snapY;
    }

    updateElement(activeSlideId, id, { x: snappedX, y: snappedY });
  }, [activeSlideId, updateElement, slide, elements]);

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

    if (editingTextId === id) return;

    if (editingTextId && editingTextId !== id) {
      setEditingTextId(null);
    }

    const wasDragging = isElementDragging.current;
    isElementDragging.current = false;

    if (metaPressed) {
      const ids = selectedElementIds.includes(id)
        ? selectedElementIds.filter((sid) => sid !== id)
        : [...selectedElementIds, id];
      setSelectedElements(ids);
    } else {
      setSelectedElements([id]);

      if (isTextElement && clickedElement && !wasDragging) {
        const pos = screenToSVG(e.clientX, e.clientY);

        // With center-based rotation, we need to:
        // 1. Get the click position relative to the element's center
        // 2. Rotate that point back to unrotated space
        // 3. Convert back to top-left relative coordinates
        const centerX = clickedElement.x + clickedElement.width / 2;
        const centerY = clickedElement.y + clickedElement.height / 2;

        // Position relative to center
        const relCenterX = pos.x - centerX;
        const relCenterY = pos.y - centerY;

        // Rotate back (negative angle to undo the rotation)
        const rotation = clickedElement.rotation || 0;
        const radians = -rotation * Math.PI / 180;
        const cos = Math.cos(radians);
        const sin = Math.sin(radians);
        const unrotatedRelX = relCenterX * cos - relCenterY * sin;
        const unrotatedRelY = relCenterX * sin + relCenterY * cos;

        // Convert back to top-left relative coordinates
        const localX = unrotatedRelX + clickedElement.width / 2;
        const localY = unrotatedRelY + clickedElement.height / 2;

        if (isPointOnTextContent(clickedElement as TextElement, { x: localX, y: localY })) {
          setEditingTextId(id, { x: localX, y: localY });
        }
      }
    }

    // Start drag
    if (!clickedElement?.locked) {
      handleElementMouseDown(id, clickedElement?.x || 0, clickedElement?.y || 0, e);
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
    if (e.target === e.currentTarget || (e.target as Element).classList.contains('svg-background')) {
      setSelectedElements([]);
      setEditingTextId(null);
    }
  }, [setSelectedElements, setEditingTextId]);

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
    if (activeSlideId) {
      updateElement(activeSlideId, id, attrs);
    }
  }, [activeSlideId, updateElement]);

  const handleTransformEnd = useCallback((id: string, attrs: Record<string, number>) => {
    if (activeSlideId) {
      updateElement(activeSlideId, id, attrs);
    }
  }, [activeSlideId, updateElement]);

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

  // Zoom with wheel
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    let pendingZoom: number | null = null;
    let rafId: number | null = null;

    const applyZoom = () => {
      if (pendingZoom !== null) {
        setZoom(pendingZoom);
        pendingZoom = null;
      }
      rafId = null;
    };

    const handleWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();

      const currentZoom = pendingZoom ?? useEditorStore.getState().zoom;
      const delta = -e.deltaY * 0.01;
      pendingZoom = currentZoom + delta;

      if (rafId === null) {
        rafId = requestAnimationFrame(applyZoom);
      }
    };

    el.addEventListener('wheel', handleWheel, { passive: false });
    return () => {
      el.removeEventListener('wheel', handleWheel);
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
      }
    };
  }, [setZoom]);

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

  return (
    <div
      ref={containerRef}
      className="relative"
      style={{ width: containerWidth, height: containerHeight, cursor }}
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
