import React, { useEffect, useRef, useState } from 'react';
import { usePresentationStore } from '../../store/presentationStore';
import { useAudienceReceiver } from '../../hooks/usePresenterMode';
import { SLIDE_WIDTH, SLIDE_HEIGHT } from '../../utils/constants';
import { interpolateWithVisibility, lerpColor } from '../../utils/interpolation';
import { getSlideBackground, mergeElementOrders, renderPresenterElement } from './presenterUtils';
import type { SlideElement } from '../../types/presentation';

export const AudienceView: React.FC = () => {
  const { slideIndex, isAnimating, animProgress, targetIndex, shouldExit } = useAudienceReceiver();
  const slideOrder = usePresentationStore((s) => s.presentation.slideOrder);
  const slides = usePresentationStore((s) => s.presentation.slides);
  const resources = usePresentationStore((s) => s.presentation.resources);
  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ width: window.innerWidth, height: window.innerHeight });

  // Handle window resize
  useEffect(() => {
    const handleResize = () => {
      setDimensions({ width: window.innerWidth, height: window.innerHeight });
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Request fullscreen on load
  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.requestFullscreen?.().catch(() => {});
    }
  }, []);

  // Close window when exit signal received
  useEffect(() => {
    if (shouldExit) {
      window.close();
    }
  }, [shouldExit]);

  const totalSlides = slideOrder.length;
  const currentSlide = slides[slideOrder[slideIndex]] || null;

  if (!currentSlide) {
    return (
      <div className="fixed inset-0 bg-black flex items-center justify-center text-white">
        Waiting for presentation...
      </div>
    );
  }

  const scale = Math.min(dimensions.width / SLIDE_WIDTH, dimensions.height / SLIDE_HEIGHT);
  const stageW = SLIDE_WIDTH * scale;
  const stageH = SLIDE_HEIGHT * scale;

  // Compute elements to render
  let renderedElements: SlideElement[];
  let bgColor: string;

  if (isAnimating && targetIndex !== slideIndex) {
    const slideA = currentSlide;
    const slideB = slides[slideOrder[targetIndex]] || null;

    const bgA = getSlideBackground(slideA);
    const bgB = slideB ? getSlideBackground(slideB) : bgA;
    bgColor = lerpColor(bgA, bgB, animProgress);

    // Interpolate each element, preserving target slide's z-order
    const orderedIds = mergeElementOrders(slideA, slideB);
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
    <div ref={containerRef} className="fixed inset-0 bg-black flex items-center justify-center cursor-none">
      <div className="relative" style={{ width: stageW, height: stageH, background: bgColor }}>
        {/* Render all elements in z-order */}
        {renderedElements.map((el, index) => renderPresenterElement(el, index, scale, stageW, stageH, resources))}
      </div>

      {/* Slide counter */}
      <div className="absolute bottom-4 right-4 text-white text-sm opacity-50">
        {slideIndex + 1} / {totalSlides}
      </div>
    </div>
  );
};
