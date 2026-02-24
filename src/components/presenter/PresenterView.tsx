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
  const presentingSlideIndex = useEditorStore((s) => s.presentingSlideIndex);
  const setPresentingSlideIndex = useEditorStore((s) => s.setPresentingSlideIndex);
  const setPresenting = useEditorStore((s) => s.setPresenting);
  const slideOrder = usePresentationStore((s) => s.presentation.slideOrder);
  const slides = usePresentationStore((s) => s.presentation.slides);
  const resources = usePresentationStore((s) => s.presentation.resources);
  const containerRef = useRef<HTMLDivElement>(null);

  const [currentIndex, setCurrentIndex] = useState(0);
  const [isAnimating, setIsAnimating] = useState(false);
  const [animProgress, setAnimProgress] = useState(0);
  const [autoAdvanceEnabled, setAutoAdvanceEnabled] = useState(true);
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
    const targetSlide = slides[slideOrder[targetIdx]];
    const duration = targetSlide?.transition.duration || 300;

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
    setPresenting(false);
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    }
  }, [setPresenting]);

  useEffect(() => {
    if (isPresenting && containerRef.current) {
      containerRef.current.requestFullscreen?.().catch(() => {});
    }
  }, [isPresenting]);

  useEffect(() => {
    if (!isPresenting) return;

    const handleKey = (e: KeyboardEvent) => {
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
      }
    };

    const handleFullscreenChange = () => {
      if (!document.fullscreenElement && isPresenting) {
        setPresenting(false);
      }
    };

    window.addEventListener('keydown', handleKey);
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => {
      window.removeEventListener('keydown', handleKey);
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
    };
  }, [isPresenting, goNext, goPrev, exitPresentation, setPresentingSlideIndex, totalSlides, setPresenting, isAnimating]);

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
      const interpolated = interpolateWithVisibility(elA, elB, animProgress);
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
      onClick={(e) => {
        const rect = (e.target as HTMLElement).getBoundingClientRect();
        if (e.clientX > rect.width / 2) goNext();
        else goPrev();
      }}
    >
      <div className="relative" style={{ width: stageW, height: stageH, background: bgColor }}>
        {/* Render all elements in z-order */}
        {renderedElements.map((el, index) => renderPresenterElement(el, index, scale, stageW, stageH, resources))}
      </div>

      {/* Slide counter */}
      <div className="absolute bottom-4 right-4 text-white text-sm opacity-50">
        {(isAnimating ? targetIndexRef.current : currentIndex) + 1} / {totalSlides}
      </div>
    </div>
  );
};
