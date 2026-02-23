import { useState, useCallback } from 'react';
import { useEditorStore } from '../../store/editorStore';
import { usePresentationStore } from '../../store/presentationStore';
import { createTextElement, createShapeElement } from '../../utils/slideFactory';
import { computePointSnap, type Guide } from '../../hooks/useAlignmentGuides';
import { getMarginLayout, getMarginBounds } from '../../utils/marginLayouts';

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
}

export function useSVGDrawing() {
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

  const handleMouseDown = useCallback((
    e: React.MouseEvent,
    screenToSVG: (clientX: number, clientY: number) => { x: number; y: number }
  ) => {
    if (tool === 'select') return;

    const pos = screenToSVG(e.clientX, e.clientY);

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

  const handleMouseMove = useCallback((
    e: React.MouseEvent,
    screenToSVG: (clientX: number, clientY: number) => { x: number; y: number }
  ) => {
    if (!drawState.isDrawing) return;

    const pos = screenToSVG(e.clientX, e.clientY);

    const { others, marginBounds } = getSnapContext();
    const currentSnap = computePointSnap(pos, others, 5, marginBounds);
    const snappedCurrentX = currentSnap.snapX ?? pos.x;
    const snappedCurrentY = currentSnap.snapY ?? pos.y;

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
      snappedStartX: startSnap.snapX ?? s.startX,
      snappedStartY: startSnap.snapY ?? s.startY,
    }));
  }, [drawState.isDrawing, drawState.startX, drawState.startY, getSnapContext]);

  const handleMouseUp = useCallback(() => {
    if (!drawState.isDrawing) return;

    const x = Math.min(drawState.snappedStartX, drawState.snappedCurrentX);
    const y = Math.min(drawState.snappedStartY, drawState.snappedCurrentY);
    const width = Math.abs(drawState.snappedCurrentX - drawState.snappedStartX);
    const height = Math.abs(drawState.snappedCurrentY - drawState.snappedStartY);

    setGuides([]);

    if (width < 5 && height < 5) {
      setDrawState({
        startX: 0, startY: 0, currentX: 0, currentY: 0, isDrawing: false,
        snappedStartX: 0, snappedStartY: 0, snappedCurrentX: 0, snappedCurrentY: 0,
      });
      return;
    }

    setTool('select');

    if (tool === 'text') {
      const el = createTextElement({ x, y, width: Math.max(width, 100), height: Math.max(height, 40) });
      addElement(activeSlideId, el);
      setSelectedElements([el.id]);
      setEditingTextId(el.id);
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
      const el = createShapeElement(tool as 'rect' | 'ellipse' | 'triangle' | 'star', { x, y, width, height });
      addElement(activeSlideId, el);
      setSelectedElements([el.id]);
    }

    setDrawState({
      startX: 0, startY: 0, currentX: 0, currentY: 0, isDrawing: false,
      snappedStartX: 0, snappedStartY: 0, snappedCurrentX: 0, snappedCurrentY: 0,
    });
  }, [drawState, tool, activeSlideId, addElement, setTool, setSelectedElements, setEditingTextId]);

  return { drawState, guides, handleMouseDown, handleMouseMove, handleMouseUp };
}
