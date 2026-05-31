import { useCallback, useRef } from 'react';

// Long-press detector backed by pointer events. 500 ms hold without movement
// fires `onLongPress`; any pointermove > 8 px or pointerup before 500 ms
// cancels and treats as a normal click. Intended to replace `onContextMenu`
// for slide thumbnails and canvas elements on touch (and to work on desktop
// too — desktop's onContextMenu still fires for right-click).

export interface UseLongPressOptions {
  onLongPress: (e: React.PointerEvent) => void;
  durationMs?: number;
  moveThresholdPx?: number;
}

export function useLongPress(options: UseLongPressOptions) {
  const { onLongPress, durationMs = 500, moveThresholdPx = 8 } = options;
  const timerRef = useRef<number | null>(null);
  const startRef = useRef<{ x: number; y: number; pointerId: number } | null>(null);

  const cleanup = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    startRef.current = null;
  }, []);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    // Only the primary mouse button or the first touch counts.
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    startRef.current = { x: e.clientX, y: e.clientY, pointerId: e.pointerId };
    // Capture the event so handlers can call e.persist() equivalents later.
    const persisted = e;
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      if (startRef.current) onLongPress(persisted);
    }, durationMs);
  }, [onLongPress, durationMs]);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!startRef.current || startRef.current.pointerId !== e.pointerId) return;
    const dx = e.clientX - startRef.current.x;
    const dy = e.clientY - startRef.current.y;
    if (Math.hypot(dx, dy) > moveThresholdPx) cleanup();
  }, [moveThresholdPx, cleanup]);

  const onPointerUp = useCallback((e: React.PointerEvent) => {
    if (startRef.current && startRef.current.pointerId !== e.pointerId) return;
    cleanup();
  }, [cleanup]);

  const onPointerCancel = useCallback(() => cleanup(), [cleanup]);

  return { onPointerDown, onPointerMove, onPointerUp, onPointerCancel };
}
