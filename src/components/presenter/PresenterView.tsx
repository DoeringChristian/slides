import React, { useEffect, useCallback, useRef, useState, useMemo } from 'react';
import { useEditorStore } from '../../store/editorStore';
import { usePresentationStore } from '../../store/presentationStore';
import { SLIDE_WIDTH, SLIDE_HEIGHT } from '../../utils/constants';
import { interpolateWithVisibility, lerpColor } from '../../utils/interpolation';
import { getSlideBackground, mergeElementOrders, renderPresenterElement } from './presenterUtils';
import type { SlideElement } from '../../types/presentation';

export const PresenterView: React.FC = () => {
  const isPresenting = useEditorStore((s) => s.isPresenting);
  const isPresenterMode = useEditorStore((s) => s.isPresenterMode);
  const showSlideNumbers = useEditorStore((s) => s.showSlideNumbers);
  const setShowSlideNumbers = useEditorStore((s) => s.setShowSlideNumbers);
  const presentingSlideIndex = useEditorStore((s) => s.presentingSlideIndex);
  const setPresentingSlideIndex = useEditorStore((s) => s.setPresentingSlideIndex);
  const setPresenting = useEditorStore((s) => s.setPresenting);
  const standaloneMode = useEditorStore((s) => s.standaloneMode);
  const standaloneEditorOrigin = useEditorStore((s) => s.standaloneEditorOrigin);
  const slideOrder = usePresentationStore((s) => s.presentation.slideOrder);
  const slides = usePresentationStore((s) => s.presentation.slides);
  const resources = usePresentationStore((s) => s.presentation.resources);
  const containerRef = useRef<HTMLDivElement>(null);

  const [currentIndex, setCurrentIndex] = useState(0);
  const [isAnimating, setIsAnimating] = useState(false);
  const [animProgress, setAnimProgress] = useState(0);
  const [autoAdvanceEnabled, setAutoAdvanceEnabled] = useState(true);
  // Standalone modes auto-play on page load, but browsers refuse requestFullscreen
  // without a user gesture. Until the user's first interaction, swallow advance
  // keys/clicks and use that gesture to enter fullscreen instead.
  const [hasBootstrapped, setHasBootstrapped] = useState(standaloneMode === 'off');
  const targetIndexRef = useRef(0);
  const rafRef = useRef<number>(0);
  const startTimeRef = useRef(0);

  const totalSlides = slideOrder.length;

  // Indices of non-hidden slides for navigation
  const visibleIndices = useMemo(
    () => slideOrder.map((id, i) => ({ id, i })).filter(({ id }) => !slides[id]?.hidden).map(({ i }) => i),
    [slideOrder, slides],
  );

  // Sync external presentingSlideIndex -> internal
  useEffect(() => {
    setCurrentIndex(presentingSlideIndex);
  }, [presentingSlideIndex]);

  const startAnimation = useCallback((targetIdx: number) => {
    if (isAnimating) return;
    // When going forward, use the target slide's transition duration.
    // When going backward, use the current slide's duration (we're reversing its entry).
    const goingForward = targetIdx > currentIndex;
    const transitionSlide = goingForward ? slides[slideOrder[targetIdx]] : slides[slideOrder[currentIndex]];
    const duration = transitionSlide?.transition.duration || 300;

    targetIndexRef.current = targetIdx;
    setIsAnimating(true);
    setAnimProgress(0);
    startTimeRef.current = performance.now();

    const animate = (now: number) => {
      const elapsed = now - startTimeRef.current;
      const t = Math.min(elapsed / duration, 1);
      setAnimProgress(t);

      if (t < 1) {
        rafRef.current = requestAnimationFrame(animate);
      } else {
        // Animation complete
        setCurrentIndex(targetIndexRef.current);
        setPresentingSlideIndex(targetIndexRef.current);
        setIsAnimating(false);
        setAnimProgress(0);
      }
    };

    rafRef.current = requestAnimationFrame(animate);
  }, [isAnimating, slides, slideOrder, setPresentingSlideIndex]);

  // Cleanup RAF on unmount
  useEffect(() => {
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  // Auto-advance timer
  const autoAdvanceTimerRef = useRef<number | null>(null);

  useEffect(() => {
    // Clear any existing timer
    if (autoAdvanceTimerRef.current) {
      clearTimeout(autoAdvanceTimerRef.current);
      autoAdvanceTimerRef.current = null;
    }

    // Don't auto-advance if not presenting, animating, in presenter mode, or auto-advance disabled (went backwards)
    if (!isPresenting || isAnimating || isPresenterMode || !autoAdvanceEnabled) return;

    const currentSlide = slides[slideOrder[currentIndex]];
    if (!currentSlide?.autoAdvance) return;

    const delay = (currentSlide.autoAdvanceDelay ?? 0) * 1000;

    // Check if there's a next slide
    const pos = visibleIndices.indexOf(currentIndex);
    const hasNext = pos !== -1 && pos < visibleIndices.length - 1;
    if (!hasNext) return;

    autoAdvanceTimerRef.current = window.setTimeout(() => {
      const nextPos = visibleIndices[pos + 1];
      if (nextPos !== undefined) {
        startAnimation(nextPos);
      }
    }, delay);

    return () => {
      if (autoAdvanceTimerRef.current) {
        clearTimeout(autoAdvanceTimerRef.current);
      }
    };
  }, [isPresenting, isPresenterMode, isAnimating, currentIndex, slides, slideOrder, visibleIndices, startAnimation, autoAdvanceEnabled]);

  const goNext = useCallback(() => {
    if (isAnimating) return;
    const pos = visibleIndices.indexOf(currentIndex);
    const nextPos = pos === -1 ? visibleIndices.find((i) => i > currentIndex) : visibleIndices[pos + 1];
    if (nextPos !== undefined) {
      setAutoAdvanceEnabled(true); // Re-enable auto-advance when going forward
      startAnimation(nextPos);
    }
  }, [currentIndex, visibleIndices, isAnimating, startAnimation]);

  const goPrev = useCallback(() => {
    if (isAnimating) return;
    const pos = visibleIndices.indexOf(currentIndex);
    const prevPos = pos === -1 ? [...visibleIndices].reverse().find((i) => i < currentIndex) : visibleIndices[pos - 1];
    if (prevPos !== undefined) {
      // Disable auto-advance when going back
      setAutoAdvanceEnabled(false);
      startAnimation(prevPos);
    }
  }, [currentIndex, visibleIndices, isAnimating, startAnimation]);

  const exitPresentation = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    setIsAnimating(false);
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    }
    // Viewer-only standalone: no editor to fall back into. Send the user to the editor link.
    if (standaloneMode === 'viewer' && standaloneEditorOrigin) {
      window.open(standaloneEditorOrigin, '_blank', 'noopener');
      return;
    }
    setPresenting(false);
  }, [setPresenting, standaloneMode, standaloneEditorOrigin]);

  useEffect(() => {
    if (isPresenting && containerRef.current) {
      containerRef.current.requestFullscreen?.().catch(() => {});
    }
  }, [isPresenting]);

  useEffect(() => {
    if (!isPresenting) return;

    const requestFs = () =>
      (containerRef.current ?? document.documentElement).requestFullscreen?.().catch(() => {});

    const isAdvanceKey = (key: string) =>
      key === 'Enter' || key === ' ' || key === 'ArrowRight' || key === 'ArrowDown';

    const handleKey = (e: KeyboardEvent) => {
      // Bootstrap: in standalone modes, the first advance key is consumed to
      // enter fullscreen (it's a valid user gesture). Subsequent presses advance
      // slides normally. Esc and other keys behave as usual.
      if (!hasBootstrapped && isAdvanceKey(e.key)) {
        e.preventDefault();
        requestFs();
        setHasBootstrapped(true);
        return;
      }
      switch (e.key) {
        case 'ArrowRight':
        case 'ArrowDown':
        case ' ':
        case 'Enter':
          e.preventDefault();
          goNext();
          break;
        case 'ArrowLeft':
        case 'ArrowUp':
          e.preventDefault();
          goPrev();
          break;
        case 'Escape':
          exitPresentation();
          break;
        case 'Home':
          if (!isAnimating) {
            setCurrentIndex(0);
            setPresentingSlideIndex(0);
          }
          break;
        case 'End':
          if (!isAnimating) {
            setCurrentIndex(totalSlides - 1);
            setPresentingSlideIndex(totalSlides - 1);
          }
          break;
        case 'n':
        case 'N':
          setShowSlideNumbers(!showSlideNumbers);
          break;
      }
    };

    const handleFullscreenChange = () => {
      // First fullscreen entry counts as bootstrapping (e.g. user pressed F).
      if (document.fullscreenElement) {
        setHasBootstrapped(true);
        return;
      }
      // In the regular editor flow, exiting fullscreen also exits present mode.
      // In standalone modes there's nowhere to fall back to (viewer has no
      // editor UI; editor-standalone uses Esc explicitly), so leave isPresenting alone.
      if (isPresenting && standaloneMode === 'off') {
        setPresenting(false);
      }
    };

    window.addEventListener('keydown', handleKey);
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => {
      window.removeEventListener('keydown', handleKey);
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
    };
  }, [isPresenting, goNext, goPrev, exitPresentation, setPresentingSlideIndex, totalSlides, setPresenting, isAnimating, showSlideNumbers, setShowSlideNumbers, hasBootstrapped, standaloneMode]);

  // Don't render when in presenter mode (PresenterControlPanel handles that)
  // This view is only for simple fullscreen presentation
  if (!isPresenting || isPresenterMode) return null;

  const currentSlide = slides[slideOrder[currentIndex]] || null;
  if (!currentSlide) return null;

  const viewportW = window.innerWidth;
  const viewportH = window.innerHeight;
  const scale = Math.min(viewportW / SLIDE_WIDTH, viewportH / SLIDE_HEIGHT);
  const stageW = SLIDE_WIDTH * scale;
  const stageH = SLIDE_HEIGHT * scale;

  // Compute elements to render
  let renderedElements: SlideElement[];
  let bgColor: string;

  if (isAnimating) {
    const targetIndex = targetIndexRef.current;
    const slideA = currentSlide;
    const slideB = slides[slideOrder[targetIndex]] || null;
    const isForward = targetIndex > currentIndex;

    // Interpolate background
    const bgA = getSlideBackground(slideA);
    const bgB = slideB ? getSlideBackground(slideB) : bgA;
    bgColor = lerpColor(bgA, bgB, animProgress);

    // Interpolate each element, preserving correct z-order based on direction
    const orderedIds = mergeElementOrders(slideA, slideB, isForward);
    renderedElements = [];
    for (const id of orderedIds) {
      const elA = slideA.elements[id];
      const elB = slideB?.elements[id];
      const interpolated = interpolateWithVisibility(elA, elB, animProgress, isForward);
      if (interpolated) {
        renderedElements.push(interpolated);
      }
    }
  } else {
    bgColor = getSlideBackground(currentSlide);
    renderedElements = currentSlide.elementOrder
      .map((id) => currentSlide.elements[id])
      .filter(Boolean);
  }

  return (
    <div ref={containerRef} className="fixed inset-0 bg-black z-[9999] flex items-center justify-center cursor-none"
      // onPointerDown fires before onClick — important on iOS Safari where
      // click is gated by the 300 ms double-tap heuristic. Initiating the
      // fullscreen request from pointerdown makes the bootstrap feel instant
      // on touch, while the click handler below covers mouse + non-touch
      // platforms uniformly.
      onPointerDown={(e) => {
        if (e.pointerType !== 'mouse' && !hasBootstrapped) {
          (containerRef.current ?? document.documentElement).requestFullscreen?.().catch(() => {});
          setHasBootstrapped(true);
        }
      }}
      onClick={(e) => {
        // First click in standalone mode bootstraps fullscreen rather than advancing.
        if (!hasBootstrapped) {
          (containerRef.current ?? document.documentElement).requestFullscreen?.().catch(() => {});
          setHasBootstrapped(true);
          return;
        }
        const rect = (e.target as HTMLElement).getBoundingClientRect();
        if (e.clientX > rect.width / 2) goNext();
        else goPrev();
      }}
    >
      <div className="relative" style={{ width: stageW, height: stageH, background: bgColor }}>
        {/* Render all elements in z-order */}
        {renderedElements.map((el, index) => renderPresenterElement(el, index, scale, stageW, stageH, resources))}

        {/* Slide number overlay on the slide */}
        {showSlideNumbers && (
          <div
            style={{
              position: 'absolute',
              bottom: 12 * scale,
              right: 16 * scale,
              fontSize: 16 * scale,
              color: 'rgba(100, 100, 100, 0.8)',
              textShadow: '0 0 4px rgba(255,255,255,0.9), 0 0 2px rgba(255,255,255,1)',
              zIndex: 9999,
              pointerEvents: 'none',
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {(isAnimating ? targetIndexRef.current : currentIndex) + 1}
          </div>
        )}
      </div>

      {/* Slide counter */}
      <div className="absolute bottom-4 right-4 text-white text-sm opacity-50">
        {(isAnimating ? targetIndexRef.current : currentIndex) + 1} / {totalSlides}
      </div>

      {/* Bootstrap overlay: only shown until the user's first interaction triggers
          fullscreen. Identical in viewer-only and editor-included flavors. */}
      {!hasBootstrapped && (
        <div className="absolute inset-x-0 bottom-12 flex flex-col items-center gap-2 pointer-events-none">
          <div className="text-white/85 bg-black/40 backdrop-blur px-4 py-2 rounded text-sm">
            Press <kbd className="font-mono">Enter</kbd> to start the presentation in fullscreen
          </div>
          <div className="text-white/70 bg-black/40 backdrop-blur px-4 py-1.5 rounded text-xs">
            Press <kbd className="font-mono">Esc</kbd> to edit
          </div>
        </div>
      )}
    </div>
  );
};
