import React, { useEffect, useRef, useState } from 'react';
import { Stage, Layer, Rect, Ellipse, Image as KonvaImage, Line, Arrow, Star, RegularPolygon } from 'react-konva';
import useImage from 'use-image';
import { usePresentationStore } from '../../store/presentationStore';
import { useAudienceReceiver } from '../../hooks/usePresenterMode';
import { MarkdownRenderer } from '../canvas/MarkdownRenderer';
import { SLIDE_WIDTH, SLIDE_HEIGHT } from '../../utils/constants';
import { interpolateWithVisibility, lerpColor } from '../../utils/interpolation';
import type { SlideElement, TextElement, ShapeElement, ImageElement, Slide, Resource } from '../../types/presentation';

const AudienceImageElement: React.FC<{ element: ImageElement; resources: Record<string, Resource> }> = ({ element, resources }) => {
  const resource = element.resourceId ? resources[element.resourceId] : undefined;
  const [image] = useImage(resource?.type === 'image' ? (resource?.src || '') : '');

  if (!resource) return null;
  if (resource.type === 'video') return null;

  const crop = {
    x: element.cropX,
    y: element.cropY,
    width: element.cropWidth,
    height: element.cropHeight,
  };

  return (
    <KonvaImage
      image={image}
      x={element.x}
      y={element.y}
      width={element.width}
      height={element.height}
      rotation={element.rotation}
      opacity={element.opacity}
      crop={crop}
      listening={false}
    />
  );
};

const AudienceSlideElement: React.FC<{ element: SlideElement; resources: Record<string, Resource> }> = ({ element, resources }) => {
  if (!element.visible) return null;

  if (element.type === 'text') return null;

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

  if (element.type === 'image') {
    return <AudienceImageElement element={element as ImageElement} resources={resources} />;
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

  const textElements = renderedElements.filter(
    (el): el is TextElement => el.type === 'text' && el.visible
  );

  const videoElements = renderedElements.filter((el): el is ImageElement => {
    if (el.type !== 'image' || !el.visible) return false;
    const resource = (el as ImageElement).resourceId ? resources[(el as ImageElement).resourceId!] : undefined;
    return resource?.type === 'video';
  });

  return (
    <div ref={containerRef} className="fixed inset-0 bg-black flex items-center justify-center cursor-none">
      <div className="relative" style={{ width: stageW, height: stageH }}>
        <Stage width={stageW} height={stageH} scaleX={scale} scaleY={scale} listening={false}>
          <Layer listening={false}>
            <Rect x={0} y={0} width={SLIDE_WIDTH} height={SLIDE_HEIGHT} fill={bgColor} listening={false} />
            {renderedElements.map((el) => <AudienceSlideElement key={el.id} element={el} resources={resources} />)}
          </Layer>
        </Stage>

        {/* Video overlay */}
        <div className="absolute inset-0 pointer-events-none overflow-hidden">
          {videoElements.map((element) => {
            const resource = element.resourceId ? resources[element.resourceId] : undefined;
            if (!resource) return null;

            const hasCrop = element.cropWidth > 0 && element.cropHeight > 0;

            if (hasCrop) {
              const scaleX = resource.originalWidth / element.cropWidth;
              const scaleY = resource.originalHeight / element.cropHeight;

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
                  }}
                >
                  <video
                    src={resource.src}
                    autoPlay={element.playing ?? true}
                    loop={element.loop ?? false}
                    muted={element.muted ?? false}
                    playsInline
                    style={{
                      width: `${element.width * scale * scaleX}px`,
                      height: `${element.height * scale * scaleY}px`,
                      marginLeft: `${-element.cropX * (element.width / element.cropWidth) * scale}px`,
                      marginTop: `${-element.cropY * (element.height / element.cropHeight) * scale}px`,
                    }}
                  />
                </div>
              );
            }

            return (
              <video
                key={element.id}
                src={resource.src}
                autoPlay={element.playing ?? true}
                loop={element.loop ?? false}
                muted={element.muted ?? false}
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
                }}
              />
            );
          })}
        </div>

        {/* Markdown text overlay */}
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
              <div style={{ width: '100%' }}>
                <MarkdownRenderer
                  text={element.text}
                  style={element.style}
                  zoom={scale}
                />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Slide counter */}
      <div className="absolute bottom-4 right-4 text-white text-sm opacity-50">
        {slideIndex + 1} / {totalSlides}
      </div>
    </div>
  );
};
