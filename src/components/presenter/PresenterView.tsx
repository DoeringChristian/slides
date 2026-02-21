import React, { useEffect, useCallback, useRef, useState } from 'react';
import { Stage, Layer, Rect, Text, Ellipse, Line, Arrow, Star, RegularPolygon } from 'react-konva';
import { useEditorStore } from '../../store/editorStore';
import { usePresentationStore } from '../../store/presentationStore';
import { SLIDE_WIDTH, SLIDE_HEIGHT } from '../../utils/constants';
import { interpolateWithVisibility, lerpColor } from '../../utils/interpolation';
import type { SlideElement, TextElement, ShapeElement, Slide } from '../../types/presentation';

const PresentationSlideElement: React.FC<{ element: SlideElement }> = ({ element }) => {
  if (!element.visible) return null;

  if (element.type === 'text') {
    const el = element as TextElement;
    return (
      <Text
        x={el.x} y={el.y} width={el.width} height={el.height}
        text={el.text} fontSize={el.style.fontSize} fontFamily={el.style.fontFamily}
        fill={el.style.color} align={el.style.align} rotation={el.rotation}
        opacity={el.opacity} listening={false}
        fontStyle={`${el.style.fontWeight === 'bold' ? 'bold' : ''} ${el.style.fontStyle === 'italic' ? 'italic' : ''}`.trim() || 'normal'}
        textDecoration={el.style.textDecoration === 'none' ? '' : el.style.textDecoration}
        verticalAlign={el.style.verticalAlign}
        lineHeight={el.style.lineHeight}
      />
    );
  }

  if (element.type === 'shape') {
    const el = element as ShapeElement;
    const common = { x: el.x, y: el.y, rotation: el.rotation, opacity: el.opacity, fill: el.fill, stroke: el.stroke, strokeWidth: el.strokeWidth, listening: false };
    switch (el.shapeType) {
      case 'rect': return <Rect {...common} width={el.width} height={el.height} cornerRadius={el.cornerRadius} />;
      case 'ellipse': return <Ellipse {...common} x={el.x + el.width/2} y={el.y + el.height/2} radiusX={el.width/2} radiusY={el.height/2} />;
      case 'triangle': return <RegularPolygon {...common} x={el.x + el.width/2} y={el.y + el.height/2} sides={3} radius={Math.min(el.width, el.height)/2} />;
      case 'star': return <Star {...common} x={el.x + el.width/2} y={el.y + el.height/2} numPoints={5} innerRadius={Math.min(el.width, el.height)/4} outerRadius={Math.min(el.width, el.height)/2} />;
      case 'line': return <Line {...common} points={el.points ?? [0, 0, el.width, 0]} stroke={el.stroke || el.fill} strokeWidth={el.strokeWidth || 3} fill="" />;
      case 'arrow': return <Arrow {...common} points={el.points ?? [0, 0, el.width, 0]} stroke={el.stroke || el.fill} strokeWidth={el.strokeWidth || 3} fill={el.stroke || el.fill} pointerLength={10} pointerWidth={10} />;
      default: return null;
    }
  }

  return null;
};

function getSlideBackground(slide: Slide): string {
  return slide.background.type === 'solid' ? slide.background.color : '#ffffff';
}

function collectElementIds(slideA: Slide | null, slideB: Slide | null): string[] {
  const ids = new Set<string>();
  if (slideA) slideA.elementOrder.forEach((id) => ids.add(id));
  if (slideB) slideB.elementOrder.forEach((id) => ids.add(id));
  return Array.from(ids);
}

export const PresenterView: React.FC = () => {
  const isPresenting = useEditorStore((s) => s.isPresenting);
  const presentingSlideIndex = useEditorStore((s) => s.presentingSlideIndex);
  const setPresentingSlideIndex = useEditorStore((s) => s.setPresentingSlideIndex);
  const setPresenting = useEditorStore((s) => s.setPresenting);
  const slideOrder = usePresentationStore((s) => s.presentation.slideOrder);
  const slides = usePresentationStore((s) => s.presentation.slides);
  const containerRef = useRef<HTMLDivElement>(null);

  const [currentIndex, setCurrentIndex] = useState(0);
  const [isAnimating, setIsAnimating] = useState(false);
  const [animProgress, setAnimProgress] = useState(0);
  const targetIndexRef = useRef(0);
  const rafRef = useRef<number>(0);
  const startTimeRef = useRef(0);

  const totalSlides = slideOrder.length;

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

  const goNext = useCallback(() => {
    const nextIdx = currentIndex + 1;
    if (nextIdx < totalSlides) {
      if (isAnimating) return;
      startAnimation(nextIdx);
    }
  }, [currentIndex, totalSlides, isAnimating, startAnimation]);

  const goPrev = useCallback(() => {
    const prevIdx = currentIndex - 1;
    if (prevIdx >= 0) {
      if (isAnimating) return;
      startAnimation(prevIdx);
    }
  }, [currentIndex, isAnimating, startAnimation]);

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

  if (!isPresenting) return null;

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

    // Interpolate background
    const bgA = getSlideBackground(slideA);
    const bgB = slideB ? getSlideBackground(slideB) : bgA;
    bgColor = lerpColor(bgA, bgB, animProgress);

    // Interpolate each element
    const allIds = collectElementIds(slideA, slideB);
    renderedElements = [];
    for (const id of allIds) {
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
      <Stage width={stageW} height={stageH} scaleX={scale} scaleY={scale} listening={false}>
        <Layer listening={false}>
          <Rect x={0} y={0} width={SLIDE_WIDTH} height={SLIDE_HEIGHT} fill={bgColor} listening={false} />
          {renderedElements.map((el) => <PresentationSlideElement key={el.id} element={el} />)}
        </Layer>
      </Stage>

      {/* Slide counter */}
      <div className="absolute bottom-4 right-4 text-white text-sm opacity-50">
        {(isAnimating ? targetIndexRef.current : currentIndex) + 1} / {totalSlides}
      </div>
    </div>
  );
};
