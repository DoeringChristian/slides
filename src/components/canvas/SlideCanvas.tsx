import React, { useRef, useCallback, useMemo, useState, useEffect, type DragEvent } from 'react';
import { Stage, Layer } from 'react-konva';
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
import { DrawingPreview, useDrawing } from './DrawingLayer';
import { GridOverlay } from './GridOverlay';
import { computeGuides } from '../../hooks/useAlignmentGuides';
import { getBindingTarget, getAnchorPoint } from '../../utils/connectorUtils';
import { snapToGrid as snapToGridFn } from '../../utils/geometry';
import { SLIDE_WIDTH, SLIDE_HEIGHT, CANVAS_PADDING } from '../../utils/constants';
import type { ShapeElement } from '../../types/presentation';
import type Konva from 'konva';

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
  const updateElement = usePresentationStore((s) => s.updateElement);
  const unhideElement = usePresentationStore((s) => s.unhideElement);

  const slide = useActiveSlide();
  const objectElements = useObjectElements();
  const { drawState, handleMouseDown, handleMouseMove, handleMouseUp } = useDrawing();

  const [guides, setGuides] = useState<Guide[]>([]);
  const [connectorHighlightId, setConnectorHighlightId] = useState<string | null>(null);

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

  const handleStageClick = useCallback((e: Konva.KonvaEventObject<MouseEvent>) => {
    if (e.target === e.target.getStage()) {
      setSelectedElements([]);
      setEditingTextId(null);
    }
  }, [setSelectedElements, setEditingTextId]);

  const handleSelect = useCallback((id: string, e: Konva.KonvaEventObject<MouseEvent>) => {
    if (editingTextId) return;
    const metaPressed = e.evt.shiftKey || e.evt.ctrlKey || e.evt.metaKey;
    if (metaPressed) {
      const ids = selectedElementIds.includes(id)
        ? selectedElementIds.filter((sid) => sid !== id)
        : [...selectedElementIds, id];
      setSelectedElements(ids);
    } else {
      setSelectedElements([id]);
    }
  }, [selectedElementIds, setSelectedElements, editingTextId]);

  const handleTransformEnd = useCallback((id: string, attrs: Record<string, number>) => {
    if (activeSlideId) {
      updateElement(activeSlideId, id, attrs);
    }
  }, [activeSlideId, updateElement]);

  const handleDragMove = useCallback((id: string, x: number, y: number, node: Konva.Node) => {
    if (!slide) return;
    const el = slide.elements[id];
    if (!el) return;

    const { snapToGrid: snappingEnabled, showGrid: isGridVisible, gridSize: grid } = useEditorStore.getState();

    // Compute alignment guides from raw position
    const dragged = { x, y, width: el.width, height: el.height };
    const others = elements
      .filter((e) => e.id !== id && e.visible)
      .map((e) => ({ x: e.x, y: e.y, width: e.width, height: e.height }));
    const result = computeGuides(dragged, others);
    setGuides(snappingEnabled ? result.guides : []);

    if (snappingEnabled) {
      let snappedX = x;
      let snappedY = y;

      // Grid snap (only when grid is visible)
      if (isGridVisible) {
        snappedX = snapToGridFn(x, grid);
        snappedY = snapToGridFn(y, grid);
      }

      // Alignment guides override grid snap
      if (result.snapX !== null) snappedX = result.snapX;
      if (result.snapY !== null) snappedY = result.snapY;

      node.x(snappedX);
      node.y(snappedY);
    }
  }, [slide, elements]);

  const handleDragEndWithGuides = useCallback((id: string, x: number, y: number) => {
    setGuides([]);
    if (!activeSlideId) return;

    const { snapToGrid: snappingEnabled, showGrid: isGridVisible, gridSize: grid } = useEditorStore.getState();
    const el = slide?.elements[id];

    let snappedX = x;
    let snappedY = y;

    if (snappingEnabled && el) {
      const dragged = { x, y, width: el.width, height: el.height };
      const others = elements
        .filter((e) => e.id !== id && e.visible)
        .map((e) => ({ x: e.x, y: e.y, width: e.width, height: e.height }));
      const result = computeGuides(dragged, others);

      if (isGridVisible) {
        snappedX = snapToGridFn(x, grid);
        snappedY = snapToGridFn(y, grid);
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

  const handleDragOver = useCallback((e: DragEvent<HTMLDivElement>) => {
    if (e.dataTransfer.types.includes('application/x-object-id')) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
    }
  }, []);

  const handleDrop = useCallback((e: DragEvent<HTMLDivElement>) => {
    const objectId = e.dataTransfer.getData('application/x-object-id');
    if (!objectId || !activeSlideId || !containerRef.current) return;
    e.preventDefault();
    const rect = containerRef.current.getBoundingClientRect();
    const x = (e.clientX - rect.left) / zoom - CANVAS_PADDING;
    const y = (e.clientY - rect.top) / zoom - CANVAS_PADDING;
    unhideElement(activeSlideId, objectId, { x, y });
    setSelectedElements([objectId]);
  }, [activeSlideId, zoom, unhideElement, setSelectedElements]);

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
          <AlignmentGuides guides={guides} />
          <SelectionTransformer selectedIds={editingTextId ? [] : unlockedTransformerIds} stageRef={stageRef} />
          <SelectionTransformer selectedIds={editingTextId ? [] : lockedTransformerIds} stageRef={stageRef} locked />
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

      <TextEditOverlay stageRef={containerRef} zoom={zoom} />
    </div>
  );
};
