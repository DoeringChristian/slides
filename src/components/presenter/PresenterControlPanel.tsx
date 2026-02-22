import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Stage, Layer, Rect } from 'react-konva';
import { X, ChevronLeft, ChevronRight, RotateCcw, Monitor } from 'lucide-react';
import { useEditorStore } from '../../store/editorStore';
import { usePresentationStore } from '../../store/presentationStore';
import { usePresenterMode } from '../../hooks/usePresenterMode';
import { ThumbnailElement } from '../sidebar/SlideThumbnail';
import { CustomMarkdownRenderer } from '../canvas/CustomMarkdownRenderer';
import { SLIDE_WIDTH, SLIDE_HEIGHT, TEXT_BOX_PADDING } from '../../utils/constants';
import type { Slide, TextElement } from '../../types/presentation';

function formatTime(seconds: number): string {
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  if (hrs > 0) {
    return `${hrs}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

interface SlidePreviewProps {
  slide: Slide | null;
  scale: number;
  label: string;
  onClick?: () => void;
}

const SlidePreview: React.FC<SlidePreviewProps> = ({ slide, scale, label, onClick }) => {
  if (!slide) {
    return (
      <div className="flex flex-col">
        <span className="text-xs text-gray-400 mb-1">{label}</span>
        <div
          className="bg-gray-800 rounded flex items-center justify-center text-gray-500"
          style={{ width: SLIDE_WIDTH * scale, height: SLIDE_HEIGHT * scale }}
        >
          No slide
        </div>
      </div>
    );
  }

  const bgColor = slide.background.type === 'solid' ? slide.background.color : '#ffffff';
  const elements = slide.elementOrder.map((id) => slide.elements[id]).filter(Boolean);
  const textElements = elements.filter((el): el is TextElement => el.type === 'text' && el.visible);

  return (
    <div className="flex flex-col">
      <span className="text-xs text-gray-400 mb-1">{label}</span>
      <div
        className={`relative rounded overflow-hidden border-2 border-gray-700 ${onClick ? 'cursor-pointer hover:border-gray-500' : ''}`}
        onClick={onClick}
      >
        <Stage
          width={SLIDE_WIDTH * scale}
          height={SLIDE_HEIGHT * scale}
          scaleX={scale}
          scaleY={scale}
          listening={false}
        >
          <Layer listening={false}>
            <Rect x={0} y={0} width={SLIDE_WIDTH} height={SLIDE_HEIGHT} fill={bgColor} listening={false} />
            {elements.map((el) => (
              <ThumbnailElement key={el.id} element={el} />
            ))}
          </Layer>
        </Stage>
        {/* Text overlay for markdown rendering */}
        <div className="absolute inset-0 pointer-events-none overflow-hidden">
          {textElements.map((element) => (
            <div
              key={element.id}
              style={{
                position: 'absolute',
                left: `${element.x * scale}px`,
                top: `${element.y * scale}px`,
                width: `${element.width * scale}px`,
                height: `${element.height * scale}px`,
                transform: `rotate(${element.rotation}deg)`,
                transformOrigin: 'top left',
                opacity: element.opacity,
                overflow: 'hidden',
                display: 'flex',
                alignItems: element.style.verticalAlign === 'middle' ? 'center' :
                           element.style.verticalAlign === 'bottom' ? 'flex-end' : 'flex-start',
              }}
            >
              <div style={{ width: '100%', padding: `${TEXT_BOX_PADDING * scale}px` }}>
                <CustomMarkdownRenderer
                  text={element.text}
                  style={element.style}
                  zoom={scale}
                />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export const PresenterControlPanel: React.FC = () => {
  const {
    isPresenterMode,
    exitPresenterMode,
    goToSlide,
    sendAnimationState,
    resetTimer,
  } = usePresenterMode();

  const presentingSlideIndex = useEditorStore((s) => s.presentingSlideIndex);
  const presenterStartTime = useEditorStore((s) => s.presenterStartTime);
  const slideOrder = usePresentationStore((s) => s.presentation.slideOrder);
  const slides = usePresentationStore((s) => s.presentation.slides);

  const [isAnimating, setIsAnimating] = useState(false);
  const [, setTick] = useState(0); // For timer updates
  const rafRef = useRef<number>(0);
  const startTimeRef = useRef(0);
  const targetIndexRef = useRef(0);

  // Update timer every second
  useEffect(() => {
    if (!isPresenterMode) return;
    const interval = setInterval(() => setTick(t => t + 1), 1000);
    return () => clearInterval(interval);
  }, [isPresenterMode]);

  // Calculate elapsed time
  const elapsedTime = presenterStartTime > 0 ? Math.floor((Date.now() - presenterStartTime) / 1000) : 0;

  const totalSlides = slideOrder.length;

  // Indices of non-hidden slides for navigation
  const visibleIndices = React.useMemo(
    () => slideOrder.map((id, i) => ({ id, i })).filter(({ id }) => !slides[id]?.hidden).map(({ i }) => i),
    [slideOrder, slides],
  );

  const currentSlide = slides[slideOrder[presentingSlideIndex]] || null;
  const nextSlideIndex = visibleIndices[visibleIndices.indexOf(presentingSlideIndex) + 1];
  const nextSlide = nextSlideIndex !== undefined ? slides[slideOrder[nextSlideIndex]] : null;

  const startAnimation = useCallback((targetIdx: number) => {
    if (isAnimating) return;
    const targetSlide = slides[slideOrder[targetIdx]];
    const duration = targetSlide?.transition.duration || 300;

    targetIndexRef.current = targetIdx;
    setIsAnimating(true);
    startTimeRef.current = performance.now();

    const animate = (now: number) => {
      const elapsed = now - startTimeRef.current;
      const t = Math.min(elapsed / duration, 1);

      sendAnimationState(true, t, targetIdx);

      if (t < 1) {
        rafRef.current = requestAnimationFrame(animate);
      } else {
        setIsAnimating(false);
        goToSlide(targetIdx);
        sendAnimationState(false, 1, targetIdx);
      }
    };

    rafRef.current = requestAnimationFrame(animate);
  }, [isAnimating, slides, slideOrder, goToSlide, sendAnimationState]);

  const goNext = useCallback(() => {
    if (isAnimating) return;
    const pos = visibleIndices.indexOf(presentingSlideIndex);
    const nextPos = pos === -1 ? visibleIndices.find((i) => i > presentingSlideIndex) : visibleIndices[pos + 1];
    if (nextPos !== undefined) startAnimation(nextPos);
  }, [presentingSlideIndex, visibleIndices, isAnimating, startAnimation]);

  const goPrev = useCallback(() => {
    if (isAnimating) return;
    const pos = visibleIndices.indexOf(presentingSlideIndex);
    const prevPos = pos === -1 ? [...visibleIndices].reverse().find((i) => i < presentingSlideIndex) : visibleIndices[pos - 1];
    if (prevPos !== undefined) startAnimation(prevPos);
  }, [presentingSlideIndex, visibleIndices, isAnimating, startAnimation]);

  // Keyboard navigation
  useEffect(() => {
    if (!isPresenterMode) return;

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
          exitPresenterMode();
          break;
        case 'Home':
          if (!isAnimating && visibleIndices.length > 0) {
            goToSlide(visibleIndices[0]);
          }
          break;
        case 'End':
          if (!isAnimating && visibleIndices.length > 0) {
            goToSlide(visibleIndices[visibleIndices.length - 1]);
          }
          break;
      }
    };

    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [isPresenterMode, goNext, goPrev, exitPresenterMode, goToSlide, isAnimating, visibleIndices]);

  // Cleanup RAF on unmount
  useEffect(() => {
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  if (!isPresenterMode) return null;

  // Calculate preview scales - make them fit better
  const currentScale = 0.45;
  const nextScale = 0.3;

  return (
    <div className="fixed inset-0 bg-gray-900 z-[9998] flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 bg-gray-800 border-b border-gray-700">
        <div className="flex items-center gap-3">
          <Monitor size={20} className="text-blue-400" />
          <span className="text-white font-medium">Presenter View</span>
        </div>
        <div className="flex items-center gap-4">
          {/* Navigation buttons */}
          <div className="flex items-center gap-2">
            <button
              onClick={goPrev}
              disabled={isAnimating || visibleIndices.indexOf(presentingSlideIndex) <= 0}
              className="p-2 rounded-lg bg-gray-700 hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed text-white"
              title="Previous slide (←)"
            >
              <ChevronLeft size={20} />
            </button>
            <span className="text-white font-medium min-w-[60px] text-center">
              {presentingSlideIndex + 1} / {totalSlides}
            </span>
            <button
              onClick={goNext}
              disabled={isAnimating || visibleIndices.indexOf(presentingSlideIndex) >= visibleIndices.length - 1}
              className="p-2 rounded-lg bg-gray-700 hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed text-white"
              title="Next slide (→)"
            >
              <ChevronRight size={20} />
            </button>
          </div>
          <div className="w-px h-6 bg-gray-600" />
          {/* Timer */}
          <div className="flex items-center gap-2">
            <span className="text-2xl font-mono text-white">{formatTime(elapsedTime)}</span>
            <button
              onClick={resetTimer}
              className="p-1.5 rounded hover:bg-gray-700 text-gray-400 hover:text-white"
              title="Reset timer"
            >
              <RotateCcw size={16} />
            </button>
          </div>
          <button
            onClick={exitPresenterMode}
            className="p-1.5 rounded hover:bg-gray-700 text-gray-400 hover:text-white"
            title="Exit presenter mode (Esc)"
          >
            <X size={20} />
          </button>
        </div>
      </div>

      {/* Main content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Slides area - Current and Next side by side */}
        <div className="flex-1 flex p-4 gap-6 overflow-auto">
          {/* Current slide - larger */}
          <div className="flex-[2] flex flex-col items-center justify-center">
            <SlidePreview
              slide={currentSlide}
              scale={currentScale}
              label="Current Slide"
            />
          </div>

          {/* Next slide - smaller */}
          <div className="flex-1 flex flex-col items-center justify-center">
            <SlidePreview
              slide={nextSlide}
              scale={nextScale}
              label="Next Slide"
              onClick={nextSlide ? goNext : undefined}
            />
          </div>
        </div>

        {/* Right: Speaker notes */}
        <div className="w-80 bg-gray-800 border-l border-gray-700 flex flex-col">
          <div className="px-4 py-2 border-b border-gray-700">
            <span className="text-sm font-medium text-gray-300">Speaker Notes</span>
          </div>
          <div className="flex-1 p-4 overflow-auto">
            {currentSlide?.notes ? (
              <p className="text-gray-200 whitespace-pre-wrap text-sm leading-relaxed">
                {currentSlide.notes}
              </p>
            ) : (
              <p className="text-gray-500 italic text-sm">No speaker notes for this slide</p>
            )}
          </div>
        </div>
      </div>

      {/* Footer: Slide thumbnails */}
      <div className="h-24 bg-gray-800 border-t border-gray-700 flex items-center px-4 gap-2 overflow-x-auto">
        {slideOrder.map((slideId, index) => {
          const slide = slides[slideId];
          if (!slide || slide.hidden) return null;
          const isActive = index === presentingSlideIndex;
          const thumbScale = 0.08;
          const bgColor = slide.background.type === 'solid' ? slide.background.color : '#ffffff';
          const elements = slide.elementOrder.map((id) => slide.elements[id]).filter(Boolean);
          const textEls = elements.filter((el): el is TextElement => el.type === 'text' && el.visible);

          return (
            <div
              key={slideId}
              onClick={() => !isAnimating && goToSlide(index)}
              className={`relative shrink-0 cursor-pointer rounded overflow-hidden border-2 transition-colors ${
                isActive ? 'border-blue-500' : 'border-gray-600 hover:border-gray-400'
              }`}
            >
              <Stage
                width={SLIDE_WIDTH * thumbScale}
                height={SLIDE_HEIGHT * thumbScale}
                scaleX={thumbScale}
                scaleY={thumbScale}
                listening={false}
              >
                <Layer listening={false}>
                  <Rect x={0} y={0} width={SLIDE_WIDTH} height={SLIDE_HEIGHT} fill={bgColor} listening={false} />
                  {elements.map((el) => (
                    <ThumbnailElement key={el.id} element={el} />
                  ))}
                </Layer>
              </Stage>
              {/* Text overlay */}
              <div className="absolute inset-0 pointer-events-none overflow-hidden">
                {textEls.map((element) => (
                  <div
                    key={element.id}
                    style={{
                      position: 'absolute',
                      left: `${element.x * thumbScale}px`,
                      top: `${element.y * thumbScale}px`,
                      width: `${element.width * thumbScale}px`,
                      height: `${element.height * thumbScale}px`,
                      transform: `rotate(${element.rotation}deg)`,
                      transformOrigin: 'top left',
                      opacity: element.opacity,
                      overflow: 'hidden',
                      display: 'flex',
                      alignItems: element.style.verticalAlign === 'middle' ? 'center' :
                                 element.style.verticalAlign === 'bottom' ? 'flex-end' : 'flex-start',
                    }}
                  >
                    <div style={{ width: '100%', padding: `${TEXT_BOX_PADDING * thumbScale}px` }}>
                      <CustomMarkdownRenderer
                        text={element.text}
                        style={element.style}
                        zoom={thumbScale}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
