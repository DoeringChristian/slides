import React, { useEffect, useCallback, useRef } from 'react';
import { Stage, Layer, Rect, Text, Ellipse, Line, Arrow, Star, RegularPolygon, Image as KonvaImage } from 'react-konva';
import { AnimatePresence, motion } from 'framer-motion';
import { useEditorStore } from '../../store/editorStore';
import { usePresentationStore } from '../../store/presentationStore';
import { SLIDE_WIDTH, SLIDE_HEIGHT } from '../../utils/constants';
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
      case 'line': return <Line {...common} points={el.points ?? [0, 0, el.width, 0]} stroke={el.stroke || el.fill} />;
      case 'arrow': return <Arrow {...common} points={el.points ?? [0, 0, el.width, 0]} stroke={el.stroke || el.fill} fill={el.stroke || el.fill} pointerLength={10} pointerWidth={10} />;
      default: return null;
    }
  }

  return null;
};

const transitionVariants: Record<string, any> = {
  none: { initial: {}, animate: {}, exit: {} },
  fade: { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 } },
  'slide-left': { initial: { x: '100%' }, animate: { x: 0 }, exit: { x: '-100%' } },
  'slide-right': { initial: { x: '-100%' }, animate: { x: 0 }, exit: { x: '100%' } },
  'slide-up': { initial: { y: '100%' }, animate: { y: 0 }, exit: { y: '-100%' } },
  zoom: { initial: { scale: 0, opacity: 0 }, animate: { scale: 1, opacity: 1 }, exit: { scale: 2, opacity: 0 } },
};

export const PresenterView: React.FC = () => {
  const isPresenting = useEditorStore((s) => s.isPresenting);
  const presentingSlideIndex = useEditorStore((s) => s.presentingSlideIndex);
  const setPresentingSlideIndex = useEditorStore((s) => s.setPresentingSlideIndex);
  const setPresenting = useEditorStore((s) => s.setPresenting);
  const slideOrder = usePresentationStore((s) => s.presentation.slideOrder);
  const slides = usePresentationStore((s) => s.presentation.slides);
  const containerRef = useRef<HTMLDivElement>(null);

  const currentSlideId = slideOrder[presentingSlideIndex];
  const currentSlide = currentSlideId ? slides[currentSlideId] : null;

  const totalSlides = slideOrder.length;

  const goNext = useCallback(() => {
    if (presentingSlideIndex < totalSlides - 1) {
      setPresentingSlideIndex(presentingSlideIndex + 1);
    }
  }, [presentingSlideIndex, totalSlides, setPresentingSlideIndex]);

  const goPrev = useCallback(() => {
    if (presentingSlideIndex > 0) {
      setPresentingSlideIndex(presentingSlideIndex - 1);
    }
  }, [presentingSlideIndex, setPresentingSlideIndex]);

  const exitPresentation = useCallback(() => {
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
          setPresentingSlideIndex(0);
          break;
        case 'End':
          setPresentingSlideIndex(totalSlides - 1);
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
  }, [isPresenting, goNext, goPrev, exitPresentation, setPresentingSlideIndex, totalSlides, setPresenting]);

  if (!isPresenting || !currentSlide) return null;

  const viewportW = window.innerWidth;
  const viewportH = window.innerHeight;
  const scale = Math.min(viewportW / SLIDE_WIDTH, viewportH / SLIDE_HEIGHT);
  const stageW = SLIDE_WIDTH * scale;
  const stageH = SLIDE_HEIGHT * scale;

  const bgColor = currentSlide.background.type === 'solid' ? currentSlide.background.color : '#ffffff';
  const elements = currentSlide.elementOrder.map((id) => currentSlide.elements[id]).filter(Boolean);
  const transition = currentSlide.transition.type || 'none';
  const duration = (currentSlide.transition.duration || 300) / 1000;
  const variants = transitionVariants[transition] || transitionVariants.none;

  return (
    <div ref={containerRef} className="fixed inset-0 bg-black z-[9999] flex items-center justify-center cursor-none"
      onClick={(e) => {
        const rect = (e.target as HTMLElement).getBoundingClientRect();
        if (e.clientX > rect.width / 2) goNext();
        else goPrev();
      }}
    >
      <AnimatePresence mode="wait">
        <motion.div
          key={currentSlideId}
          initial={variants.initial}
          animate={variants.animate}
          exit={variants.exit}
          transition={{ duration }}
        >
          <Stage width={stageW} height={stageH} scaleX={scale} scaleY={scale} listening={false}>
            <Layer listening={false}>
              <Rect x={0} y={0} width={SLIDE_WIDTH} height={SLIDE_HEIGHT} fill={bgColor} listening={false} />
              {elements.map((el) => <PresentationSlideElement key={el.id} element={el} />)}
            </Layer>
          </Stage>
        </motion.div>
      </AnimatePresence>

      {/* Slide counter */}
      <div className="absolute bottom-4 right-4 text-white text-sm opacity-50">
        {presentingSlideIndex + 1} / {totalSlides}
      </div>
    </div>
  );
};
