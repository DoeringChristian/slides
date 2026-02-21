import React, { useState, useCallback } from 'react';
import { Rect, Ellipse, Line, Arrow } from 'react-konva';
import { useEditorStore } from '../../store/editorStore';
import { usePresentationStore } from '../../store/presentationStore';
import { createTextElement, createShapeElement } from '../../utils/slideFactory';
import type { Tool } from '../../types/presentation';
import type Konva from 'konva';

interface DrawState {
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
  isDrawing: boolean;
}

export function useDrawing() {
  const [drawState, setDrawState] = useState<DrawState>({
    startX: 0, startY: 0, currentX: 0, currentY: 0, isDrawing: false,
  });

  const tool = useEditorStore((s) => s.tool);
  const activeSlideId = useEditorStore((s) => s.activeSlideId);
  const setTool = useEditorStore((s) => s.setTool);
  const setSelectedElements = useEditorStore((s) => s.setSelectedElements);
  const addElement = usePresentationStore((s) => s.addElement);

  const handleMouseDown = useCallback((e: Konva.KonvaEventObject<MouseEvent>) => {
    if (tool === 'select') return;
    const stage = e.target.getStage();
    if (!stage) return;
    const pos = stage.getPointerPosition();
    if (!pos) return;
    setDrawState({ startX: pos.x, startY: pos.y, currentX: pos.x, currentY: pos.y, isDrawing: true });
  }, [tool]);

  const handleMouseMove = useCallback((e: Konva.KonvaEventObject<MouseEvent>) => {
    if (!drawState.isDrawing) return;
    const stage = e.target.getStage();
    if (!stage) return;
    const pos = stage.getPointerPosition();
    if (!pos) return;
    setDrawState((s) => ({ ...s, currentX: pos.x, currentY: pos.y }));
  }, [drawState.isDrawing]);

  const handleMouseUp = useCallback(() => {
    if (!drawState.isDrawing) return;

    const x = Math.min(drawState.startX, drawState.currentX);
    const y = Math.min(drawState.startY, drawState.currentY);
    const width = Math.abs(drawState.currentX - drawState.startX);
    const height = Math.abs(drawState.currentY - drawState.startY);

    if (width < 5 && height < 5) {
      setDrawState({ startX: 0, startY: 0, currentX: 0, currentY: 0, isDrawing: false });
      return;
    }

    if (tool === 'text') {
      const el = createTextElement({ x, y, width: Math.max(width, 100), height: Math.max(height, 40) });
      addElement(activeSlideId, el);
      setSelectedElements([el.id]);
    } else if (tool === 'line' || tool === 'arrow') {
      const el = createShapeElement(tool, {
        x: drawState.startX,
        y: drawState.startY,
        width,
        height,
        points: [0, 0, drawState.currentX - drawState.startX, drawState.currentY - drawState.startY],
      });
      addElement(activeSlideId, el);
      setSelectedElements([el.id]);
    } else if (['rect', 'ellipse', 'triangle', 'star'].includes(tool)) {
      const el = createShapeElement(tool as any, { x, y, width, height });
      addElement(activeSlideId, el);
      setSelectedElements([el.id]);
    }

    setTool('select');
    setDrawState({ startX: 0, startY: 0, currentX: 0, currentY: 0, isDrawing: false });
  }, [drawState, tool, activeSlideId, addElement, setTool, setSelectedElements]);

  return { drawState, handleMouseDown, handleMouseMove, handleMouseUp };
}

interface DrawPreviewProps {
  drawState: DrawState;
  tool: Tool;
}

export const DrawingPreview: React.FC<DrawPreviewProps> = ({ drawState, tool }) => {
  if (!drawState.isDrawing) return null;

  const x = Math.min(drawState.startX, drawState.currentX);
  const y = Math.min(drawState.startY, drawState.currentY);
  const width = Math.abs(drawState.currentX - drawState.startX);
  const height = Math.abs(drawState.currentY - drawState.startY);

  const commonProps = {
    fill: 'rgba(66, 133, 244, 0.1)',
    stroke: '#4285f4',
    strokeWidth: 1,
    dash: [5, 5],
    listening: false,
  };

  switch (tool) {
    case 'rect':
    case 'text':
      return <Rect x={x} y={y} width={width} height={height} {...commonProps} />;
    case 'ellipse':
      return <Ellipse x={x + width/2} y={y + height/2} radiusX={width/2} radiusY={height/2} {...commonProps} />;
    case 'line':
      return <Line points={[drawState.startX, drawState.startY, drawState.currentX, drawState.currentY]} stroke="#4285f4" strokeWidth={2} dash={[5, 5]} listening={false} />;
    case 'arrow':
      return <Arrow points={[drawState.startX, drawState.startY, drawState.currentX, drawState.currentY]} stroke="#4285f4" strokeWidth={2} fill="#4285f4" dash={[5, 5]} pointerLength={10} pointerWidth={10} listening={false} />;
    case 'triangle':
    case 'star':
      return <Rect x={x} y={y} width={width} height={height} {...commonProps} />;
    default:
      return null;
  }
};
