import React, { useState, useCallback } from 'react';
import { Rect, Ellipse, Line, Arrow } from 'react-konva';
import { useEditorStore } from '../../store/editorStore';
import { usePresentationStore } from '../../store/presentationStore';
import { createTextElement, createShapeElement } from '../../utils/slideFactory';
import { computePointSnap, type Guide } from '../../hooks/useAlignmentGuides';
import { getMarginLayout, getMarginBounds } from '../../utils/marginLayouts';
import type { Tool } from '../../types/presentation';
import type Konva from 'konva';

interface DrawState {
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
  isDrawing: boolean;
  // Snapped positions (may differ from raw positions)
  snappedStartX: number;
  snappedStartY: number;
  snappedCurrentX: number;
  snappedCurrentY: number;
}

export function useDrawing() {
  const [drawState, setDrawState] = useState<DrawState>({
    startX: 0, startY: 0, currentX: 0, currentY: 0, isDrawing: false,
    snappedStartX: 0, snappedStartY: 0, snappedCurrentX: 0, snappedCurrentY: 0,
  });
  const [guides, setGuides] = useState<Guide[]>([]);

  const tool = useEditorStore((s) => s.tool);
  const activeSlideId = useEditorStore((s) => s.activeSlideId);
  const setTool = useEditorStore((s) => s.setTool);
  const setSelectedElements = useEditorStore((s) => s.setSelectedElements);
  const setEditingTextId = useEditorStore((s) => s.setEditingTextId);
  const addElement = usePresentationStore((s) => s.addElement);

  // Helper to get snapping context
  const getSnapContext = useCallback(() => {
    const { snapToGrid, marginLayoutId } = useEditorStore.getState();
    const slide = usePresentationStore.getState().presentation.slides[activeSlideId];
    if (!snapToGrid || !slide) return { others: [], marginBounds: null };

    const others = Object.values(slide.elements)
      .filter((el) => el.visible)
      .map((el) => ({ x: el.x, y: el.y, width: el.width, height: el.height }));

    const marginLayout = getMarginLayout(marginLayoutId);
    const marginBounds = marginLayout ? getMarginBounds(marginLayout) : null;

    return { others, marginBounds };
  }, [activeSlideId]);

  const handleMouseDown = useCallback((e: Konva.KonvaEventObject<MouseEvent>) => {
    if (tool === 'select') return;
    const stage = e.target.getStage();
    if (!stage) return;
    const pos = stage.getRelativePointerPosition();
    if (!pos) return;

    // Snap start point
    const { others, marginBounds } = getSnapContext();
    const startSnap = computePointSnap(pos, others, 5, marginBounds);
    const snappedStartX = startSnap.snapX ?? pos.x;
    const snappedStartY = startSnap.snapY ?? pos.y;

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
  }, [tool, getSnapContext]);

  const handleMouseMove = useCallback((e: Konva.KonvaEventObject<MouseEvent>) => {
    if (!drawState.isDrawing) return;
    const stage = e.target.getStage();
    if (!stage) return;
    const pos = stage.getRelativePointerPosition();
    if (!pos) return;

    // Snap current point
    const { others, marginBounds } = getSnapContext();
    const currentSnap = computePointSnap(pos, others, 5, marginBounds);
    const snappedCurrentX = currentSnap.snapX ?? pos.x;
    const snappedCurrentY = currentSnap.snapY ?? pos.y;

    // Combine guides from start and current snaps
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
      // Update snapped start as well in case snap context changed
      snappedStartX: startSnap.snapX ?? s.startX,
      snappedStartY: startSnap.snapY ?? s.startY,
    }));
  }, [drawState.isDrawing, drawState.startX, drawState.startY, getSnapContext]);

  const handleMouseUp = useCallback(() => {
    if (!drawState.isDrawing) return;

    // Use snapped positions for final element
    const x = Math.min(drawState.snappedStartX, drawState.snappedCurrentX);
    const y = Math.min(drawState.snappedStartY, drawState.snappedCurrentY);
    const width = Math.abs(drawState.snappedCurrentX - drawState.snappedStartX);
    const height = Math.abs(drawState.snappedCurrentY - drawState.snappedStartY);

    // Clear guides
    setGuides([]);

    if (width < 5 && height < 5) {
      setDrawState({
        startX: 0, startY: 0, currentX: 0, currentY: 0, isDrawing: false,
        snappedStartX: 0, snappedStartY: 0, snappedCurrentX: 0, snappedCurrentY: 0,
      });
      return;
    }

    if (tool === 'text') {
      const el = createTextElement({ x, y, width: Math.max(width, 100), height: Math.max(height, 40) });
      addElement(activeSlideId, el);
      setSelectedElements([el.id]);
      // Automatically enter edit mode for new text elements (defer to ensure element is in store)
      setTimeout(() => setEditingTextId(el.id), 0);
    } else if (tool === 'line' || tool === 'arrow') {
      const el = createShapeElement(tool, {
        x: drawState.snappedStartX,
        y: drawState.snappedStartY,
        width,
        height,
        points: [0, 0, drawState.snappedCurrentX - drawState.snappedStartX, drawState.snappedCurrentY - drawState.snappedStartY],
      });
      addElement(activeSlideId, el);
      setSelectedElements([el.id]);
    } else if (['rect', 'ellipse', 'triangle', 'star'].includes(tool)) {
      const el = createShapeElement(tool as any, { x, y, width, height });
      addElement(activeSlideId, el);
      setSelectedElements([el.id]);
    }

    setTool('select');
    setDrawState({
      startX: 0, startY: 0, currentX: 0, currentY: 0, isDrawing: false,
      snappedStartX: 0, snappedStartY: 0, snappedCurrentX: 0, snappedCurrentY: 0,
    });
  }, [drawState, tool, activeSlideId, addElement, setTool, setSelectedElements, setEditingTextId]);

  return { drawState, guides, handleMouseDown, handleMouseMove, handleMouseUp };
}

interface DrawPreviewProps {
  drawState: DrawState;
  tool: Tool;
}

export const DrawingPreview: React.FC<DrawPreviewProps> = ({ drawState, tool }) => {
  if (!drawState.isDrawing) return null;

  // Use snapped positions for the preview
  const x = Math.min(drawState.snappedStartX, drawState.snappedCurrentX);
  const y = Math.min(drawState.snappedStartY, drawState.snappedCurrentY);
  const width = Math.abs(drawState.snappedCurrentX - drawState.snappedStartX);
  const height = Math.abs(drawState.snappedCurrentY - drawState.snappedStartY);

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
      return <Line points={[drawState.snappedStartX, drawState.snappedStartY, drawState.snappedCurrentX, drawState.snappedCurrentY]} stroke="#4285f4" strokeWidth={2} dash={[5, 5]} listening={false} />;
    case 'arrow':
      return <Arrow points={[drawState.snappedStartX, drawState.snappedStartY, drawState.snappedCurrentX, drawState.snappedCurrentY]} stroke="#4285f4" strokeWidth={2} fill="#4285f4" dash={[5, 5]} pointerLength={10} pointerWidth={10} listening={false} />;
    case 'triangle':
    case 'star':
      return <Rect x={x} y={y} width={width} height={height} {...commonProps} />;
    default:
      return null;
  }
};
