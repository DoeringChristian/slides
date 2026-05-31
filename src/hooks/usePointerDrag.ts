import { useCallback, useRef } from 'react';

// Generic pointer-based drag hook. Replaces the mouse-only
// mousedown→window.addEventListener('mousemove')→mouseup pattern used across
// the canvas. Pointer events bridge mouse, touch, and stylus in a single API,
// and setPointerCapture eliminates the "drag escapes the element" failure
// mode (pointer events keep flowing to the captured element even if the
// physical pointer leaves its bounds).
//
// Usage:
//   const dragHandlers = usePointerDrag({
//     onStart: (e) => { ... },
//     onMove: (e, delta) => { ... },
//     onEnd: (e, delta) => { ... },
//   });
//   <div {...dragHandlers} style={{ touchAction: 'none' }}>...</div>
//
// `touchAction: 'none'` (or the Tailwind `touch-none` class) is required on
// the target — without it the browser will hijack vertical drags as page
// scrolling on mobile.

export interface PointerDragDelta {
  dx: number;
  dy: number;
  clientX: number;
  clientY: number;
}

export interface UsePointerDragOptions {
  onStart?: (e: React.PointerEvent) => boolean | void;
  onMove?: (e: PointerEvent, delta: PointerDragDelta) => void;
  onEnd?: (e: PointerEvent, delta: PointerDragDelta) => void;
}

interface DragState {
  pointerId: number;
  startX: number;
  startY: number;
  target: Element;
}

export function usePointerDrag(options: UsePointerDragOptions) {
  const { onStart, onMove, onEnd } = options;
  const stateRef = useRef<DragState | null>(null);

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    // Only react to the primary button on mouse pointers; touch and stylus
    // pointers report button === 0 and isPrimary === true.
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (onStart?.(e) === false) return;

    const target = e.currentTarget as Element;
    target.setPointerCapture(e.pointerId);
    stateRef.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      target,
    };

    const handleMove = (ev: PointerEvent) => {
      if (!stateRef.current || ev.pointerId !== stateRef.current.pointerId) return;
      onMove?.(ev, {
        dx: ev.clientX - stateRef.current.startX,
        dy: ev.clientY - stateRef.current.startY,
        clientX: ev.clientX,
        clientY: ev.clientY,
      });
    };

    const handleUp = (ev: PointerEvent) => {
      if (!stateRef.current || ev.pointerId !== stateRef.current.pointerId) return;
      const delta: PointerDragDelta = {
        dx: ev.clientX - stateRef.current.startX,
        dy: ev.clientY - stateRef.current.startY,
        clientX: ev.clientX,
        clientY: ev.clientY,
      };
      cleanup();
      onEnd?.(ev, delta);
    };

    const cleanup = () => {
      if (!stateRef.current) return;
      try {
        stateRef.current.target.releasePointerCapture(stateRef.current.pointerId);
      } catch {
        // Capture may have already been lost (e.g. element unmounted).
      }
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
      window.removeEventListener('pointercancel', handleUp);
      stateRef.current = null;
    };

    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
    window.addEventListener('pointercancel', handleUp);
  }, [onStart, onMove, onEnd]);

  return { onPointerDown: handlePointerDown };
}
