import { useCallback, useEffect, useRef, useState } from 'react';

interface UseSlideAnimationOptions {
  /** Look up the transition duration (ms) for a given (target, current) pair. */
  getDuration: (targetIndex: number, currentIndex: number) => number;
  /** Called on every animation frame with progress in [0, 1]. */
  onFrame?: (progress: number, targetIndex: number) => void;
  /** Called once when progress hits 1. */
  onComplete: (targetIndex: number) => void;
}

interface UseSlideAnimationApi {
  isAnimating: boolean;
  targetIndexRef: React.RefObject<number>;
  start: (targetIndex: number, currentIndex: number) => void;
  cancel: () => void;
}

/** Single requestAnimationFrame loop for slide transitions. Two call sites use
 *  it: the fullscreen PresenterView (drives a local animProgress state) and the
 *  PresenterControlPanel (forwards progress to the audience over BroadcastChannel).
 *  Keeping one implementation avoids RAF/timing drift between the two views. */
export function useSlideAnimation({ getDuration, onFrame, onComplete }: UseSlideAnimationOptions): UseSlideAnimationApi {
  const [isAnimating, setIsAnimating] = useState(false);
  const rafRef = useRef(0);
  const startTimeRef = useRef(0);
  const targetIndexRef = useRef(0);

  const start = useCallback((targetIndex: number, currentIndex: number) => {
    if (isAnimating) return;
    const duration = getDuration(targetIndex, currentIndex);

    targetIndexRef.current = targetIndex;
    setIsAnimating(true);
    startTimeRef.current = performance.now();

    const animate = (now: number) => {
      const elapsed = now - startTimeRef.current;
      const t = Math.min(elapsed / duration, 1);
      onFrame?.(t, targetIndex);

      if (t < 1) {
        rafRef.current = requestAnimationFrame(animate);
      } else {
        setIsAnimating(false);
        onComplete(targetIndex);
      }
    };

    rafRef.current = requestAnimationFrame(animate);
  }, [isAnimating, getDuration, onFrame, onComplete]);

  const cancel = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    setIsAnimating(false);
  }, []);

  useEffect(() => () => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
  }, []);

  return { isAnimating, targetIndexRef, start, cancel };
}
