import React, { useEffect, useRef, useState } from 'react';
import { usePresentationStore } from '../../store/presentationStore';
import { useAudienceReceiver } from '../../hooks/usePresenterMode';
import { SLIDE_WIDTH, SLIDE_HEIGHT } from '../../utils/constants';
import { composeSlideFrame, FrameElements } from './presenterUtils';
import { useMediaController } from './mediaController';

export const AudienceView: React.FC = () => {
  const { slideIndex, isAnimating, animProgress, targetIndex, shouldExit, videoCommand, showSlideNumbers } = useAudienceReceiver();
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

  // Videos play by keyframe (mediaController) — the keyframe being moved to
  // decides — and the presenter's manual play / pause / seek reach them.
  const mediaIndex = isAnimating ? targetIndex : slideIndex;
  useMediaController(containerRef, slides[slideOrder[mediaIndex]] ?? null, resources, videoCommand);

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

  const animatingBetweenSlides = isAnimating && targetIndex !== slideIndex;
  const { renderedElements, bgColor } = composeSlideFrame({
    slideA: currentSlide,
    slideB: animatingBetweenSlides ? slides[slideOrder[targetIndex]] || null : null,
    isForward: targetIndex > slideIndex,
    animProgress,
    isAnimating: animatingBetweenSlides,
  });

  return (
    <div ref={containerRef} className="fixed inset-0 bg-black flex items-center justify-center cursor-none">
      <div className="relative" style={{ width: stageW, height: stageH, background: bgColor }}>
        {/* Single SVG composition root — same pattern as PresenterView /
            SVGStaticSlide. */}
        <svg
          width={stageW}
          height={stageH}
          viewBox={`0 0 ${SLIDE_WIDTH} ${SLIDE_HEIGHT}`}
          style={{ display: 'block', position: 'absolute', inset: 0 }}
        >
          <FrameElements elements={renderedElements} resources={resources} background={bgColor} />
        </svg>

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
            {(isAnimating && targetIndex !== slideIndex ? targetIndex : slideIndex) + 1}
          </div>
        )}
      </div>

      {/* Slide counter */}
      <div className="absolute bottom-4 right-4 text-white text-sm opacity-50">
        {slideIndex + 1} / {totalSlides}
      </div>
    </div>
  );
};
