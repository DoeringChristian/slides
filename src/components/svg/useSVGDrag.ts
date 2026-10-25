import { readGestureSlide, useCanvasGestureGuard } from './useCanvasGestureGuard';
import { useState, useCallback, useEffect, useRef } from 'react';
import { DRAG_SLOP_MOUSE, DRAG_SLOP_TOUCH } from '../../utils/constants';

interface DragState {
  phase: 'idle' | 'armed' | 'dragging';
  elementId: string | null;
  startX: number;
  startY: number;
  startElementX: number;
  startElementY: number;
  slop: number;
}

const IDLE: DragState = {
  phase: 'idle',
  elementId: null,
  startX: 0,
  startY: 0,
  startElementX: 0,
  startElementY: 0,
  slop: 0,
};

interface UseSVGDragOptions {
  zoom: number;
  onDragStart?: (id: string) => void;
  onDragMove?: (id: string, x: number, y: number) => void;
  onDragEnd?: (id: string, x: number, y: number) => void;
  /** Pointer released before the slop threshold was crossed: a plain click.
   *  Fired instead of onDragStart/Move/End (not in addition to them). */
  onDragCancel?: () => void;
  onClick?: (id: string) => void;
}

// Element drag hook — pointer-event based so it works for mouse, touch, and stylus.
// Preserves Shift-axis-constrain behavior. Uses setPointerCapture so the drag keeps
// flowing even if the pointer leaves the element bounds.
export function useSVGDrag(options: UseSVGDragOptions) {
  const { zoom, onDragStart, onDragMove, onDragEnd, onClick, onDragCancel } = options;

  const [dragState, setDragState] = useState<DragState>(IDLE);

  const { start: startGuard, finish: finishGuard } = useCanvasGestureGuard();
  const lastPointer = useRef<PointerEvent | null>(null);
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
    const current = readGestureSlide()?.elements[id];
    if (!current || current.x !== elementX || current.y !== elementY) return;
    if (!startGuard(() => { pointerIdRef.current = null; setDragState(IDLE); onDragCancel?.(); })) return;
    pointerIdRef.current = e.pointerId;
    // Capture on the originating element so subsequent moves/up reach us
    // regardless of where the pointer goes (e.g. outside the SVG).
    try {
      (e.currentTarget as Element).setPointerCapture(e.pointerId);
    } catch {
      // Capture can fail in rare cases; window listeners still cover us.
    }
    // Armed, not dragging: onDragStart fires once the slop is crossed.
    setDragState({
      phase: 'armed',
      elementId: id,
      startX: e.clientX,
      startY: e.clientY,
      startElementX: elementX,
      startElementY: elementY,
      slop: e.pointerType === 'touch' ? DRAG_SLOP_TOUCH : DRAG_SLOP_MOUSE,
    });
  }, [startGuard, onDragCancel]);

  useEffect(() => {
    if (dragState.phase === 'idle') return;

    const handlePointerMove = (e: PointerEvent) => {
      if (e.pointerId !== pointerIdRef.current) return;
      e.preventDefault();
      lastPointer.current = e;
      const screenDx = e.clientX - dragState.startX;
      const screenDy = e.clientY - dragState.startY;

      if (dragState.phase === 'armed') {
        if (Math.hypot(screenDx, screenDy) < dragState.slop) return;
        // Slop crossed: the drag starts now, and the element catches up with
        // the full delta from the original down point — the dead zone decides
        // WHEN a drag starts, never where the element ends up.
        if (dragState.elementId) onDragStart?.(dragState.elementId);
        setDragState((prev) => ({ ...prev, phase: 'dragging' }));
      }

      const dx = screenDx / zoom;
      const dy = screenDy / zoom;

      let newX = dragState.startElementX + dx;
      let newY = dragState.startElementY + dy;

      // Shift-constrain: lock to horizontal or vertical axis
      if (e.shiftKey) {
        if (Math.abs(dx) >= Math.abs(dy)) {
          newY = dragState.startElementY;
        } else {
          newX = dragState.startElementX;
        }
      }

      if (dragState.elementId) {
        onDragMove?.(dragState.elementId, newX, newY);
      }
    };

    const handlePointerUp = (e: PointerEvent) => {
      if (e.pointerId !== pointerIdRef.current) return;

      finishGuard();
      if (dragState.phase === 'armed') {
        // Never crossed the slop: a click, not a drag. A pointercancel
        // (scroll takeover, alt-tab) is neither.
        if (e.type === 'pointerup' && dragState.elementId) {
          onClick?.(dragState.elementId);
        }
      } else if (dragState.elementId) {
        const dx = (e.clientX - dragState.startX) / zoom;
        const dy = (e.clientY - dragState.startY) / zoom;

        let finalX = dragState.startElementX + dx;
        let finalY = dragState.startElementY + dy;

        if (e.shiftKey) {
          if (Math.abs(dx) >= Math.abs(dy)) {
            finalY = dragState.startElementY;
          } else {
            finalX = dragState.startElementX;
          }
        }

        onDragEnd?.(dragState.elementId, finalX, finalY);
      }

      pointerIdRef.current = null;
      setDragState(IDLE);
    };

    const cancel = () => { finishGuard(); pointerIdRef.current = null; setDragState(IDLE); onDragCancel?.(); };
    const lostCapture = (e: PointerEvent) => { if (e.pointerId === pointerIdRef.current) cancel(); };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cancel(); }
      else if (['Shift','Control','Meta'].includes(e.key) && lastPointer.current && dragState.phase === 'dragging') {
        const p = lastPointer.current;
        handlePointerMove(new PointerEvent('pointermove', { clientX: p.clientX, clientY: p.clientY, pointerId: p.pointerId, shiftKey: e.shiftKey, ctrlKey: e.ctrlKey, metaKey: e.metaKey }));
      }
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKey);
    window.addEventListener('blur', cancel);
    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    // pointercancel fires on iOS gestures, alt-tab, etc. — treat like up so we
    // don't leak drag state.
    window.addEventListener('pointercancel', cancel);
    window.addEventListener('lostpointercapture', lostCapture);

    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', cancel);
      window.removeEventListener('lostpointercapture', lostCapture);
      window.removeEventListener('keydown', onKey); window.removeEventListener('keyup', onKey); window.removeEventListener('blur', cancel);
    };
  }, [dragState, zoom, onDragStart, onDragMove, onDragEnd, onClick, onDragCancel, finishGuard]);

  return { handlePointerDown };
}
