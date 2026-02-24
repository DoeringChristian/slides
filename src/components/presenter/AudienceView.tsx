import React, { useEffect, useRef, useState } from 'react';
import { usePresentationStore } from '../../store/presentationStore';
import { useAudienceReceiver } from '../../hooks/usePresenterMode';
import { CustomMarkdownRenderer } from '../canvas/CustomMarkdownRenderer';
import { SLIDE_WIDTH, SLIDE_HEIGHT, TEXT_BOX_PADDING } from '../../utils/constants';
import { interpolateWithVisibility, lerpColor } from '../../utils/interpolation';
import type { SlideElement, TextElement, ShapeElement, ImageElement, Slide, Resource } from '../../types/presentation';

const AudienceShapeElement: React.FC<{ element: ShapeElement }> = ({ element }) => {
  if (!element.visible) return null;

  // Rotate around the center of the element
  const cx = element.x + element.width / 2;
  const cy = element.y + element.height / 2;
  const transform = element.rotation ? `rotate(${element.rotation}, ${cx}, ${cy})` : undefined;

  const commonProps = {
    opacity: element.opacity,
    fill: element.fill || 'transparent',
    stroke: element.stroke || 'none',
    strokeWidth: element.strokeWidth || 0,
    style: { pointerEvents: 'none' as const },
  };

  switch (element.shapeType) {
    case 'rect':
      return (
        <g transform={transform}>
          <rect
            x={element.x}
            y={element.y}
            width={element.width}
            height={element.height}
            rx={element.cornerRadius || 0}
            ry={element.cornerRadius || 0}
            {...commonProps}
          />
        </g>
      );

    case 'ellipse':
      return (
        <g transform={transform}>
          <ellipse
            cx={element.x + element.width / 2}
            cy={element.y + element.height / 2}
            rx={element.width / 2}
            ry={element.height / 2}
            {...commonProps}
          />
        </g>
      );

    case 'triangle': {
      const tcx = element.x + element.width / 2;
      const tcy = element.y + element.height / 2;
      const r = Math.min(element.width, element.height) / 2;
      const points = [
        [tcx, tcy - r],
        [tcx - r * Math.cos(Math.PI / 6), tcy + r * Math.sin(Math.PI / 6)],
        [tcx + r * Math.cos(Math.PI / 6), tcy + r * Math.sin(Math.PI / 6)],
      ];
      const d = `M ${points[0][0]} ${points[0][1]} L ${points[1][0]} ${points[1][1]} L ${points[2][0]} ${points[2][1]} Z`;
      return (
        <g transform={transform}>
          <path d={d} {...commonProps} />
        </g>
      );
    }

    case 'star': {
      const scx = element.x + element.width / 2;
      const scy = element.y + element.height / 2;
      const outerR = Math.min(element.width, element.height) / 2;
      const innerR = outerR / 2;
      const starPoints: string[] = [];
      for (let i = 0; i < 10; i++) {
        const r = i % 2 === 0 ? outerR : innerR;
        const angle = (i * Math.PI) / 5 - Math.PI / 2;
        starPoints.push(`${scx + r * Math.cos(angle)},${scy + r * Math.sin(angle)}`);
      }
      return (
        <g transform={transform}>
          <polygon points={starPoints.join(' ')} {...commonProps} />
        </g>
      );
    }

    case 'line': {
      const pts = element.points ?? [0, 0, element.width, 0];
      return (
        <g transform={transform}>
          <line
            x1={element.x + pts[0]}
            y1={element.y + pts[1]}
            x2={element.x + pts[2]}
            y2={element.y + pts[3]}
            stroke={element.stroke || element.fill || '#000'}
            strokeWidth={element.strokeWidth || 3}
            strokeLinecap="round"
            opacity={element.opacity}
            style={{ pointerEvents: 'none' }}
          />
        </g>
      );
    }

    case 'arrow': {
      const pts = element.points ?? [0, 0, element.width, 0];
      const strokeColor = element.stroke || element.fill || '#000';
      const strokeW = element.strokeWidth || 3;
      const dx = pts[2] - pts[0];
      const dy = pts[3] - pts[1];
      const angle = Math.atan2(dy, dx);
      const headLength = 10;
      const headWidth = 10;
      const tip = { x: element.x + pts[2], y: element.y + pts[3] };
      const left = {
        x: tip.x - headLength * Math.cos(angle) + headWidth / 2 * Math.sin(angle),
        y: tip.y - headLength * Math.sin(angle) - headWidth / 2 * Math.cos(angle),
      };
      const right = {
        x: tip.x - headLength * Math.cos(angle) - headWidth / 2 * Math.sin(angle),
        y: tip.y - headLength * Math.sin(angle) + headWidth / 2 * Math.cos(angle),
      };
      return (
        <g transform={transform} style={{ pointerEvents: 'none' }}>
          <line
            x1={element.x + pts[0]}
            y1={element.y + pts[1]}
            x2={element.x + pts[2]}
            y2={element.y + pts[3]}
            stroke={strokeColor}
            strokeWidth={strokeW}
            strokeLinecap="round"
            opacity={element.opacity}
          />
          <polygon
            points={`${tip.x},${tip.y} ${left.x},${left.y} ${right.x},${right.y}`}
            fill={strokeColor}
            opacity={element.opacity}
          />
        </g>
      );
    }

    default:
      return null;
  }
};

const AudienceImageElement: React.FC<{ element: ImageElement; resources: Record<string, Resource> }> = ({ element, resources }) => {
  const resource = element.resourceId ? resources[element.resourceId] : undefined;

  if (!resource) return null;
  if (resource.type === 'video') return null;

  // Rotate around the center of the element
  const cx = element.x + element.width / 2;
  const cy = element.y + element.height / 2;
  const transform = element.rotation ? `rotate(${element.rotation}, ${cx}, ${cy})` : undefined;
  const hasCrop = element.cropWidth > 0 && element.cropHeight > 0;

  if (hasCrop) {
    const clipId = `clip-audience-${element.id}`;
    const scaleX = element.width / element.cropWidth;
    const scaleY = element.height / element.cropHeight;

    return (
      <g transform={transform}>
        <defs>
          <clipPath id={clipId}>
            <rect x={element.x} y={element.y} width={element.width} height={element.height} />
          </clipPath>
        </defs>
        <g clipPath={`url(#${clipId})`}>
          <image
            href={resource.src}
            x={element.x - element.cropX * scaleX}
            y={element.y - element.cropY * scaleY}
            width={resource.originalWidth * scaleX}
            height={resource.originalHeight * scaleY}
            opacity={element.opacity}
            preserveAspectRatio="none"
            style={{ pointerEvents: 'none' }}
          />
        </g>
      </g>
    );
  }

  return (
    <g transform={transform}>
      <image
        href={resource.src}
        x={element.x}
        y={element.y}
        width={element.width}
        height={element.height}
        opacity={element.opacity}
        preserveAspectRatio="none"
        style={{ pointerEvents: 'none' }}
      />
    </g>
  );
};

const AudienceSlideElement: React.FC<{ element: SlideElement; resources: Record<string, Resource> }> = ({ element, resources }) => {
  if (!element.visible) return null;

  if (element.type === 'text') return null;

  if (element.type === 'shape') {
    return <AudienceShapeElement element={element as ShapeElement} />;
  }

  if (element.type === 'image') {
    return <AudienceImageElement element={element as ImageElement} resources={resources} />;
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
        <AudienceSlideElement element={element} resources={resources} />
      </svg>
    );
  };

  return (
    <div ref={containerRef} className="fixed inset-0 bg-black flex items-center justify-center cursor-none">
      <div className="relative" style={{ width: stageW, height: stageH, background: bgColor }}>
        {/* Render all elements in z-order */}
        {renderedElements.map((el, index) => renderElement(el, index))}
      </div>

      {/* Slide counter */}
      <div className="absolute bottom-4 right-4 text-white text-sm opacity-50">
        {slideIndex + 1} / {totalSlides}
      </div>
    </div>
  );
};
