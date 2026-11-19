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
 *  Keeping one implementation avoids RAF/timing drift between the two views.
 *
 *  A window the browser counts as hidden (the presenter's, covered by the
 *  audience window) gets no animation frames at all: a timer then completes
 *  the transition, so it never hangs and "next" never stays blocked. */
export function useSlideAnimation({ getDuration, onFrame, onComplete }: UseSlideAnimationOptions): UseSlideAnimationApi {
  const [isAnimating, setIsAnimating] = useState(false);
  const rafRef = useRef(0);
  const timerRef = useRef(0);
  const startTimeRef = useRef(0);
  const targetIndexRef = useRef(0);

  const start = useCallback((targetIndex: number, currentIndex: number) => {
    if (isAnimating) return;
    const duration = getDuration(targetIndex, currentIndex);

    targetIndexRef.current = targetIndex;
    setIsAnimating(true);
    startTimeRef.current = performance.now();

    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      cancelAnimationFrame(rafRef.current);
      clearTimeout(timerRef.current);
      onFrame?.(1, targetIndex);
      setIsAnimating(false);
      onComplete(targetIndex);
    };
    const animate = (now: number) => {
      const elapsed = now - startTimeRef.current;
      const t = Math.min(elapsed / duration, 1);
      if (t < 1) {
        onFrame?.(t, targetIndex);
        rafRef.current = requestAnimationFrame(animate);
      } else {
        finish();
      }
    };

    // The start goes out at once, not on the first frame (which a hidden
    // window never gets).
    onFrame?.(0, targetIndex);
    rafRef.current = requestAnimationFrame(animate);
    timerRef.current = window.setTimeout(finish, duration + 50);
  }, [isAnimating, getDuration, onFrame, onComplete]);

  const cancel = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    clearTimeout(timerRef.current);
    setIsAnimating(false);
  }, []);

  useEffect(() => () => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    clearTimeout(timerRef.current);
  }, []);

  return { isAnimating, targetIndexRef, start, cancel };
}
