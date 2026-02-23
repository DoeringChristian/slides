import { useState, useCallback, useEffect, useRef } from 'react';
import { isCtrlHeld } from '../../utils/keyboard';

interface DragState {
  isDragging: boolean;
  elementId: string | null;
  startX: number;
  startY: number;
  startElementX: number;
  startElementY: number;
  currentX: number;
  currentY: number;
}

interface UseSVGDragOptions {
  zoom: number;
  onDragStart?: (id: string) => void;
  onDragMove?: (id: string, x: number, y: number) => void;
  onDragEnd?: (id: string, x: number, y: number) => void;
}

export function useSVGDrag(options: UseSVGDragOptions) {
  const { zoom, onDragStart, onDragMove, onDragEnd } = options;

  const [dragState, setDragState] = useState<DragState>({
    isDragging: false,
    elementId: null,
    startX: 0,
    startY: 0,
    startElementX: 0,
    startElementY: 0,
    currentX: 0,
    currentY: 0,
  });

  const isDraggingRef = useRef(false);

  const handleMouseDown = useCallback((
    id: string,
    elementX: number,
    elementY: number,
    e: React.MouseEvent
  ) => {
    e.preventDefault(); // Prevent text selection
    e.stopPropagation();
    isDraggingRef.current = true;
    onDragStart?.(id);
    setDragState({
      isDragging: true,
      elementId: id,
      startX: e.clientX,
      startY: e.clientY,
      startElementX: elementX,
      startElementY: elementY,
      currentX: elementX,
      currentY: elementY,
    });
  }, [onDragStart]);

  useEffect(() => {
    if (!dragState.isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      e.preventDefault(); // Prevent text selection during drag
      const dx = (e.clientX - dragState.startX) / zoom;
      const dy = (e.clientY - dragState.startY) / zoom;

      let newX = dragState.startElementX + dx;
      let newY = dragState.startElementY + dy;

      // Ctrl-constrain: lock to horizontal or vertical axis
      if (isCtrlHeld()) {
        if (Math.abs(dx) >= Math.abs(dy)) {
          newY = dragState.startElementY; // horizontal lock
        } else {
          newX = dragState.startElementX; // vertical lock
        }
      }

      setDragState((prev) => ({
        ...prev,
        currentX: newX,
        currentY: newY,
      }));

      if (dragState.elementId) {
        onDragMove?.(dragState.elementId, newX, newY);
      }
    };

    const handleMouseUp = (e: MouseEvent) => {
      if (dragState.elementId) {
        const dx = (e.clientX - dragState.startX) / zoom;
        const dy = (e.clientY - dragState.startY) / zoom;

        let finalX = dragState.startElementX + dx;
        let finalY = dragState.startElementY + dy;

        // Ctrl-constrain final position
        if (isCtrlHeld()) {
          if (Math.abs(dx) >= Math.abs(dy)) {
            finalY = dragState.startElementY;
          } else {
            finalX = dragState.startElementX;
          }
        }

        onDragEnd?.(dragState.elementId, finalX, finalY);
      }

      isDraggingRef.current = false;
      setDragState({
        isDragging: false,
        elementId: null,
        startX: 0,
        startY: 0,
        startElementX: 0,
        startElementY: 0,
        currentX: 0,
        currentY: 0,
      });
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [dragState, zoom, onDragMove, onDragEnd]);

  return {
    dragState,
    handleMouseDown,
    isDragging: isDraggingRef.current,
  };
}
