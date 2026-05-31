import { useCallback, useRef } from 'react';

// Tracks up to two active pointers on the target. When two pointers are down,
// emits a per-frame `onGesture` with translation, scale delta, rotation delta,
// and midpoint — all relative to the previous frame. Callers compose this
// into pinch-to-zoom or two-finger element transforms.
//
// Single-pointer paths are not handled here (use the normal pointerdown drag
// handlers for those). This hook only kicks in once a second pointer arrives.

export interface GestureFrame {
  translation: { dx: number; dy: number };
  scaleDelta: number; // ratio: 1 = no change
  rotationDelta: number; // degrees
  midpoint: { x: number; y: number };
}

export interface UsePointerGestureOptions {
  onGestureStart?: () => void;
  onGesture?: (frame: GestureFrame) => void;
  onGestureEnd?: () => void;
}

interface PointerInfo {
  x: number;
  y: number;
}

interface GestureState {
  centroid: { x: number; y: number };
  distance: number;
  angle: number;
}

function computeState(p1: PointerInfo, p2: PointerInfo): GestureState {
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  return {
    centroid: { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 },
    distance: Math.hypot(dx, dy),
    angle: (Math.atan2(dy, dx) * 180) / Math.PI,
  };
}

export function usePointerGesture(options: UsePointerGestureOptions) {
  const { onGestureStart, onGesture, onGestureEnd } = options;
  const pointersRef = useRef<Map<number, PointerInfo>>(new Map());
  const lastStateRef = useRef<GestureState | null>(null);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    try {
      (e.currentTarget as Element).setPointerCapture(e.pointerId);
    } catch { /* ignore */ }
    if (pointersRef.current.size === 2) {
      const [p1, p2] = Array.from(pointersRef.current.values());
      lastStateRef.current = computeState(p1, p2);
      onGestureStart?.();
    }
  }, [onGestureStart]);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!pointersRef.current.has(e.pointerId)) return;
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointersRef.current.size !== 2 || !lastStateRef.current) return;
    const [p1, p2] = Array.from(pointersRef.current.values());
    const cur = computeState(p1, p2);
    const prev = lastStateRef.current;
    const frame: GestureFrame = {
      translation: {
        dx: cur.centroid.x - prev.centroid.x,
        dy: cur.centroid.y - prev.centroid.y,
      },
      scaleDelta: prev.distance > 0 ? cur.distance / prev.distance : 1,
      rotationDelta: cur.angle - prev.angle,
      midpoint: cur.centroid,
    };
    lastStateRef.current = cur;
    onGesture?.(frame);
  }, [onGesture]);

  const end = useCallback((e: React.PointerEvent) => {
    if (!pointersRef.current.has(e.pointerId)) return;
    pointersRef.current.delete(e.pointerId);
    if (pointersRef.current.size < 2 && lastStateRef.current) {
      lastStateRef.current = null;
      onGestureEnd?.();
    }
    // If we still have 2 pointers left after losing one (3-finger case),
    // recompute baseline so the next move doesn't jump.
    if (pointersRef.current.size === 2) {
      const [p1, p2] = Array.from(pointersRef.current.values());
      lastStateRef.current = computeState(p1, p2);
    }
  }, [onGestureEnd]);

  return {
    onPointerDown,
    onPointerMove,
    onPointerUp: end,
    onPointerCancel: end,
  };
}
