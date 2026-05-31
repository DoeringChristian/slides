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

// Element drag hook — pointer-event based so it works for mouse, touch, and stylus.
// Preserves Ctrl-axis-constrain behavior. Uses setPointerCapture so the drag keeps
// flowing even if the pointer leaves the element bounds.
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
  const pointerIdRef = useRef<number | null>(null);

  const handlePointerDown = useCallback((
    id: string,
    elementX: number,
    elementY: number,
    e: React.PointerEvent
  ) => {
    // Only react to the primary button on mouse pointers; touch/stylus report
    // button === 0 and isPrimary === true.
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    pointerIdRef.current = e.pointerId;
    isDraggingRef.current = true;
    // Capture on the originating element so subsequent moves/up reach us
    // regardless of where the pointer goes (e.g. outside the SVG).
    try {
      (e.currentTarget as Element).setPointerCapture(e.pointerId);
    } catch {
      // Capture can fail in rare cases; window listeners still cover us.
    }
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

  // Back-compat alias for any existing callers using the old name.
  const handleMouseDown = handlePointerDown;

  useEffect(() => {
    if (!dragState.isDragging) return;

    const handlePointerMove = (e: PointerEvent) => {
      if (pointerIdRef.current !== null && e.pointerId !== pointerIdRef.current) return;
      e.preventDefault();
      const dx = (e.clientX - dragState.startX) / zoom;
      const dy = (e.clientY - dragState.startY) / zoom;

      let newX = dragState.startElementX + dx;
      let newY = dragState.startElementY + dy;

      // Ctrl-constrain: lock to horizontal or vertical axis
      if (isCtrlHeld()) {
        if (Math.abs(dx) >= Math.abs(dy)) {
          newY = dragState.startElementY;
        } else {
          newX = dragState.startElementX;
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

    const handlePointerUp = (e: PointerEvent) => {
      if (pointerIdRef.current !== null && e.pointerId !== pointerIdRef.current) return;
      if (dragState.elementId) {
        const dx = (e.clientX - dragState.startX) / zoom;
        const dy = (e.clientY - dragState.startY) / zoom;

        let finalX = dragState.startElementX + dx;
        let finalY = dragState.startElementY + dy;

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
      pointerIdRef.current = null;
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

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    // pointercancel fires on iOS gestures, alt-tab, etc. — treat like up so we
    // don't leak drag state.
    window.addEventListener('pointercancel', handlePointerUp);

    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerUp);
    };
  }, [dragState, zoom, onDragMove, onDragEnd]);

  return {
    dragState,
    handlePointerDown,
    handleMouseDown,
    isDragging: isDraggingRef.current,
  };
}
