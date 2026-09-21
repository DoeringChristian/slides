import { useState, useCallback, useEffect, useRef } from 'react';
import { isCtrlHeld } from '../../utils/keyboard';

// Google Slides–style drag slop: pointer-down only ARMS a drag; nothing moves
// until the pointer travels this many *screen* pixels (zoom-independent) from
// the down point. Below the threshold, release is a plain click and no move is
// ever committed — which is what keeps a click from nudging (or grid-snapping)
// the element. Touch gets a wider slop to absorb finger jitter, matching the
// 8px long-press cancel radius used elsewhere.
const DRAG_SLOP_MOUSE = 4;
const DRAG_SLOP_TOUCH = 8;

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
  onClick?: (id: string) => void;
}

// Element drag hook — pointer-event based so it works for mouse, touch, and stylus.
// Preserves Ctrl-axis-constrain behavior. Uses setPointerCapture so the drag keeps
// flowing even if the pointer leaves the element bounds.
export function useSVGDrag(options: UseSVGDragOptions) {
  const { zoom, onDragStart, onDragMove, onDragEnd, onClick } = options;

  const [dragState, setDragState] = useState<DragState>(IDLE);

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
  }, []);

  useEffect(() => {
    if (dragState.phase === 'idle') return;

    const handlePointerMove = (e: PointerEvent) => {
      if (pointerIdRef.current !== null && e.pointerId !== pointerIdRef.current) return;
      e.preventDefault();
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

      // Ctrl-constrain: lock to horizontal or vertical axis
      if (isCtrlHeld()) {
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
      if (pointerIdRef.current !== null && e.pointerId !== pointerIdRef.current) return;

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

        if (isCtrlHeld()) {
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
  }, [dragState, zoom, onDragStart, onDragMove, onDragEnd, onClick]);

  return { handlePointerDown };
}
