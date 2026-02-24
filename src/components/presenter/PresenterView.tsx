import React, { useEffect, useCallback, useRef, useState, useMemo } from 'react';
import { useEditorStore } from '../../store/editorStore';
import { usePresentationStore } from '../../store/presentationStore';
import { CustomMarkdownRenderer } from '../canvas/CustomMarkdownRenderer';
import { SLIDE_WIDTH, SLIDE_HEIGHT, TEXT_BOX_PADDING } from '../../utils/constants';
import { interpolateWithVisibility, lerpColor } from '../../utils/interpolation';
import type { SlideElement, TextElement, ShapeElement, ImageElement, Slide, Resource } from '../../types/presentation';

// SVG Shape Element renderer
const SVGShapeElement: React.FC<{ element: ShapeElement }> = ({ element }) => {
  if (!element.visible) return null;

  const { x, y, width, height, rotation, opacity, fill, stroke, strokeWidth, shapeType, cornerRadius, points } = element;

  const cx = x + width / 2;
  const cy = y + height / 2;
  const transform = rotation ? `rotate(${rotation}, ${cx}, ${cy})` : undefined;

  const fillAttr = fill || 'transparent';
  const strokeAttr = stroke || 'none';
  const strokeWidthAttr = strokeWidth || 0;

  switch (shapeType) {
    case 'rect':
      return (
        <g transform={transform}>
          <rect
            x={x}
            y={y}
            width={width}
            height={height}
            rx={cornerRadius || 0}
            ry={cornerRadius || 0}
            fill={fillAttr}
            stroke={strokeAttr}
            strokeWidth={strokeWidthAttr}
            opacity={opacity}
          />
        </g>
      );

    case 'ellipse':
      return (
        <g transform={transform}>
          <ellipse
            cx={x + width / 2}
            cy={y + height / 2}
            rx={width / 2}
            ry={height / 2}
            fill={fillAttr}
            stroke={strokeAttr}
            strokeWidth={strokeWidthAttr}
            opacity={opacity}
          />
        </g>
      );

    case 'triangle': {
      const tcx = x + width / 2;
      const tcy = y + height / 2;
      const r = Math.min(width, height) / 2;
      const pts = [
        [tcx, tcy - r],
        [tcx - r * Math.cos(Math.PI / 6), tcy + r * Math.sin(Math.PI / 6)],
        [tcx + r * Math.cos(Math.PI / 6), tcy + r * Math.sin(Math.PI / 6)],
      ];
      const d = `M ${pts[0][0]} ${pts[0][1]} L ${pts[1][0]} ${pts[1][1]} L ${pts[2][0]} ${pts[2][1]} Z`;
      return (
        <g transform={transform}>
          <path d={d} fill={fillAttr} stroke={strokeAttr} strokeWidth={strokeWidthAttr} opacity={opacity} />
        </g>
      );
    }

    case 'star': {
      const scx = x + width / 2;
      const scy = y + height / 2;
      const outerR = Math.min(width, height) / 2;
      const innerR = outerR / 2;
      const starPoints: string[] = [];
      for (let i = 0; i < 10; i++) {
        const r = i % 2 === 0 ? outerR : innerR;
        const angle = (i * Math.PI) / 5 - Math.PI / 2;
        starPoints.push(`${scx + r * Math.cos(angle)},${scy + r * Math.sin(angle)}`);
      }
      return (
        <g transform={transform}>
          <polygon points={starPoints.join(' ')} fill={fillAttr} stroke={strokeAttr} strokeWidth={strokeWidthAttr} opacity={opacity} />
        </g>
      );
    }

    case 'line': {
      const pts = points ?? [0, 0, width, 0];
      const lineStroke = stroke || fill || '#000';
      const lineWidth = strokeWidth || 3;
      return (
        <g transform={transform}>
          <line
            x1={x + pts[0]}
            y1={y + pts[1]}
            x2={x + pts[2]}
            y2={y + pts[3]}
            stroke={lineStroke}
            strokeWidth={lineWidth}
            strokeLinecap="round"
            opacity={opacity}
          />
        </g>
      );
    }

    case 'arrow': {
      const pts = points ?? [0, 0, width, 0];
      const arrowStroke = stroke || fill || '#000';
      const arrowWidth = strokeWidth || 3;
      const dx = pts[2] - pts[0];
      const dy = pts[3] - pts[1];
      const angle = Math.atan2(dy, dx);
      const headLength = 10;
      const headWidth = 10;
      const tip = { x: x + pts[2], y: y + pts[3] };
      const left = {
        x: tip.x - headLength * Math.cos(angle) + headWidth / 2 * Math.sin(angle),
        y: tip.y - headLength * Math.sin(angle) - headWidth / 2 * Math.cos(angle),
      };
      const right = {
        x: tip.x - headLength * Math.cos(angle) - headWidth / 2 * Math.sin(angle),
        y: tip.y - headLength * Math.sin(angle) + headWidth / 2 * Math.cos(angle),
      };
      return (
        <g transform={transform}>
          <line
            x1={x + pts[0]}
            y1={y + pts[1]}
            x2={x + pts[2]}
            y2={y + pts[3]}
            stroke={arrowStroke}
            strokeWidth={arrowWidth}
            strokeLinecap="round"
            opacity={opacity}
          />
          <polygon
            points={`${tip.x},${tip.y} ${left.x},${left.y} ${right.x},${right.y}`}
            fill={arrowStroke}
            opacity={opacity}
          />
        </g>
      );
    }

    default:
      return (
        <g transform={transform}>
          <rect x={x} y={y} width={width} height={height} fill={fillAttr} stroke={strokeAttr} strokeWidth={strokeWidthAttr} opacity={opacity} />
        </g>
      );
  }
};

// SVG Image Element renderer
const SVGImageElement: React.FC<{ element: ImageElement; resources: Record<string, Resource> }> = ({ element, resources }) => {
  const resource = element.resourceId ? resources[element.resourceId] : undefined;

  if (!element.visible) return null;

  // Skip videos - they're rendered as HTML overlay
  if (resource?.type === 'video') return null;

  // No resource - render placeholder
  if (!resource) {
    const cx = element.x + element.width / 2;
    const cy = element.y + element.height / 2;
    const transform = element.rotation ? `rotate(${element.rotation}, ${cx}, ${cy})` : undefined;

    return (
      <g transform={transform}>
        <rect
          x={element.x}
          y={element.y}
          width={element.width}
          height={element.height}
          fill="#f3f4f6"
          stroke="#9ca3af"
          strokeWidth={2}
          strokeDasharray="8 4"
          opacity={element.opacity}
        />
      </g>
    );
  }

  const { x, y, width, height, rotation, opacity, cropX, cropY, cropWidth, cropHeight } = element;

  const cx = x + width / 2;
  const cy = y + height / 2;
  const transform = rotation ? `rotate(${rotation}, ${cx}, ${cy})` : undefined;

  const hasCrop = cropWidth > 0 && cropHeight > 0;

  if (hasCrop) {
    const clipId = `clip-presenter-${element.id}`;
    const scaleX = width / cropWidth;
    const scaleY = height / cropHeight;

    return (
      <g transform={transform}>
        <defs>
          <clipPath id={clipId}>
            <rect x={x} y={y} width={width} height={height} />
          </clipPath>
        </defs>
        <g clipPath={`url(#${clipId})`}>
          <image
            href={resource.src}
            x={x - cropX * scaleX}
            y={y - cropY * scaleY}
            width={resource.originalWidth * scaleX}
            height={resource.originalHeight * scaleY}
            opacity={opacity}
            preserveAspectRatio="none"
          />
        </g>
      </g>
    );
  }

  return (
    <g transform={transform}>
      <image
        href={resource.src}
        x={x}
        y={y}
        width={width}
        height={height}
        opacity={opacity}
        preserveAspectRatio="none"
      />
    </g>
  );
};

// Element renderer
const PresentationSlideElement: React.FC<{ element: SlideElement; resources: Record<string, Resource> }> = ({ element, resources }) => {
  if (!element.visible) return null;

  // Text is rendered as HTML overlay for markdown support
  if (element.type === 'text') return null;

  if (element.type === 'shape') {
    return <SVGShapeElement element={element as ShapeElement} />;
  }

  if (element.type === 'image') {
    return <SVGImageElement element={element as ImageElement} resources={resources} />;
  }

  return null;
};

function getSlideBackground(slide: Slide): string {
  return slide.background.type === 'solid' ? slide.background.color : '#ffffff';
}

// Merge element orders from two slides, preserving the target slide's order
// Elements only in source slide are placed at the end (they're fading out)
function mergeElementOrders(sourceSlide: Slide | null, targetSlide: Slide | null): string[] {
  if (!targetSlide && !sourceSlide) return [];
  if (!targetSlide) return sourceSlide!.elementOrder;
  if (!sourceSlide) return targetSlide.elementOrder;

  const targetOrder = [...targetSlide.elementOrder];
  const targetSet = new Set(targetOrder);

  // Add elements that are only in source (fading out) at the end
  for (const id of sourceSlide.elementOrder) {
    if (!targetSet.has(id)) {
      targetOrder.push(id);
    }
  }

  return targetOrder;
}

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

    // Interpolate background
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


  // Render a single element with correct positioning
  const renderElement = (element: SlideElement, index: number) => {
    if (!element.visible) return null;

    // Text elements use HTML for markdown support
    if (element.type === 'text') {
      const textEl = element as TextElement;
      return (
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
            alignItems: textEl.style.verticalAlign === 'middle' ? 'center' :
                       textEl.style.verticalAlign === 'bottom' ? 'flex-end' : 'flex-start',
            zIndex: index,
          }}
        >
          <div style={{ width: '100%', padding: `${TEXT_BOX_PADDING * scale}px` }}>
            <CustomMarkdownRenderer
              text={textEl.text}
              style={textEl.style}
              zoom={scale}
            />
          </div>
        </div>
      );
    }

    // Video elements use HTML video
    if (element.type === 'image') {
      const imgEl = element as ImageElement;
      const resource = imgEl.resourceId ? resources[imgEl.resourceId] : undefined;

      if (resource?.type === 'video') {
        const hasCrop = imgEl.cropWidth > 0 && imgEl.cropHeight > 0;

        if (hasCrop) {
          const scaleX = resource.originalWidth / imgEl.cropWidth;
          const scaleY = resource.originalHeight / imgEl.cropHeight;

          return (
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
                zIndex: index,
              }}
            >
              <video
                src={resource.src}
                autoPlay={imgEl.playing ?? true}
                loop={imgEl.loop ?? false}
                muted={imgEl.muted ?? false}
                playsInline
                style={{
                  width: `${element.width * scale * scaleX}px`,
                  height: `${element.height * scale * scaleY}px`,
                  marginLeft: `${-imgEl.cropX * (element.width / imgEl.cropWidth) * scale}px`,
                  marginTop: `${-imgEl.cropY * (element.height / imgEl.cropHeight) * scale}px`,
                }}
              />
            </div>
          );
        }

        return (
          <video
            key={element.id}
            src={resource.src}
            autoPlay={imgEl.playing ?? true}
            loop={imgEl.loop ?? false}
            muted={imgEl.muted ?? false}
            playsInline
            style={{
              position: 'absolute',
              left: `${element.x * scale}px`,
              top: `${element.y * scale}px`,
              width: `${element.width * scale}px`,
              height: `${element.height * scale}px`,
              transform: `rotate(${element.rotation}deg)`,
              transformOrigin: 'top left',
              opacity: element.opacity,
              objectFit: 'cover',
              zIndex: index,
            }}
          />
        );
      }
    }

    // Shapes and images use inline SVG
    return (
      <svg
        key={element.id}
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          width: stageW,
          height: stageH,
          pointerEvents: 'none',
          zIndex: index,
        }}
        viewBox={`0 0 ${SLIDE_WIDTH} ${SLIDE_HEIGHT}`}
      >
        <PresentationSlideElement element={element} resources={resources} />
      </svg>
    );
  };

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
        {renderedElements.map((el, index) => renderElement(el, index))}
      </div>

      {/* Slide counter */}
      <div className="absolute bottom-4 right-4 text-white text-sm opacity-50">
        {(isAnimating ? targetIndexRef.current : currentIndex) + 1} / {totalSlides}
      </div>
    </div>
  );
};
