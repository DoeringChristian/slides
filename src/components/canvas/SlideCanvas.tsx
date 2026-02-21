import React, { useRef, useCallback, useMemo } from 'react';
import { Stage, Layer } from 'react-konva';
import { useEditorStore } from '../../store/editorStore';
import { usePresentationStore } from '../../store/presentationStore';
import { useActiveSlide } from '../../store/selectors';
import { CanvasBackground } from './CanvasBackground';
import { ElementRenderer } from './ElementRenderer';
import { SelectionTransformer } from './SelectionTransformer';
import { TextEditOverlay } from './TextEditOverlay';
import { DrawingPreview, useDrawing } from './DrawingLayer';
import { GridOverlay } from './GridOverlay';
import { SLIDE_WIDTH, SLIDE_HEIGHT } from '../../utils/constants';
import type Konva from 'konva';

export const SlideCanvas: React.FC = () => {
  const containerRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<Konva.Stage>(null);

  const zoom = useEditorStore((s) => s.zoom);
  const tool = useEditorStore((s) => s.tool);
  const selectedElementIds = useEditorStore((s) => s.selectedElementIds);
  const setSelectedElements = useEditorStore((s) => s.setSelectedElements);
  const setEditingTextId = useEditorStore((s) => s.setEditingTextId);
  const editingTextId = useEditorStore((s) => s.editingTextId);
  const activeSlideId = useEditorStore((s) => s.activeSlideId);
  const showGrid = useEditorStore((s) => s.showGrid);
  const gridSize = useEditorStore((s) => s.gridSize);
  const updateElement = usePresentationStore((s) => s.updateElement);

  const slide = useActiveSlide();
  const { drawState, handleMouseDown, handleMouseMove, handleMouseUp } = useDrawing();

  const elements = useMemo(() => {
    if (!slide) return [];
    return slide.elementOrder.map((id) => slide.elements[id]).filter(Boolean);
  }, [slide]);

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

  const handleDragEnd = useCallback((id: string, x: number, y: number) => {
    if (activeSlideId) {
      updateElement(activeSlideId, id, { x, y });
    }
  }, [activeSlideId, updateElement]);

  const handleTransformEnd = useCallback((id: string, attrs: Record<string, number>) => {
    if (activeSlideId) {
      updateElement(activeSlideId, id, attrs);
    }
  }, [activeSlideId, updateElement]);

  const handleDoubleClick = useCallback((id: string) => {
    if (!slide) return;
    const el = slide.elements[id];
    if (el && el.type === 'text') {
      setEditingTextId(id);
    }
  }, [slide, setEditingTextId]);

  const stageWidth = SLIDE_WIDTH * zoom;
  const stageHeight = SLIDE_HEIGHT * zoom;
  const cursor = tool === 'select' ? 'default' : 'crosshair';

  return (
    <div ref={containerRef} className="relative" style={{ width: stageWidth, height: stageHeight, cursor }}>
      <Stage
        ref={stageRef}
        width={stageWidth}
        height={stageHeight}
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
              onDragEnd={handleDragEnd}
              onTransformEnd={handleTransformEnd}
              onDoubleClick={handleDoubleClick}
            />
          ))}
        </Layer>

        {/* Layer 3: UI */}
        <Layer>
          <GridOverlay gridSize={gridSize} visible={showGrid} />
          <SelectionTransformer selectedIds={editingTextId ? [] : selectedElementIds} stageRef={stageRef} />
          <DrawingPreview drawState={drawState} tool={tool} />
        </Layer>
      </Stage>

      <TextEditOverlay stageRef={containerRef} zoom={zoom} />
    </div>
  );
};
