import React from 'react';
import { CustomMarkdownRenderer } from '../canvas/CustomMarkdownRenderer';
import { RenderShape, RenderImage } from '../svg/ElementRenderer';
import { SLIDE_WIDTH, SLIDE_HEIGHT, TEXT_BOX_PADDING } from '../../utils/constants';
import type { SlideElement, TextElement, ShapeElement, ImageElement, Slide, Resource } from '../../types/presentation';
import type { CrossfadeSource } from '../../utils/interpolation';

// Extended ImageElement type that may include dissolve source during transitions
type ImageElementWithDissolve = ImageElement & { _dissolveSource?: CrossfadeSource };

// Get slide background color
export function getSlideBackground(slide: Slide): string {
  return slide.background.type === 'solid' ? slide.background.color : '#ffffff';
}

// Merge element orders from two slides for animation
// isForward: true = navigating to next slide, false = navigating to previous slide
//
// For forward animation: use target's order, fading-out elements at end
//   - Elements appearing (in target) are at their correct z-position
//   - Elements disappearing (source-only) fade out on top
//
// For backward animation: use source's order, fading-in elements at end
//   - Elements disappearing (source-only) stay at their original z-position
//   - Elements appearing (target-only) fade in from below
export function mergeElementOrders(sourceSlide: Slide | null, targetSlide: Slide | null, isForward: boolean = true): string[] {
  if (!targetSlide && !sourceSlide) return [];
  if (!targetSlide) return sourceSlide!.elementOrder;
  if (!sourceSlide) return targetSlide.elementOrder;

  if (isForward) {
    // Use target's order as base, add source-only elements at end
    const baseOrder = [...targetSlide.elementOrder];
    const baseSet = new Set(baseOrder);

    for (const id of sourceSlide.elementOrder) {
      if (!baseSet.has(id)) {
        baseOrder.push(id);
      }
    }

    return baseOrder;
  } else {
    // Use source's order as base, add target-only elements at end
    const baseOrder = [...sourceSlide.elementOrder];
    const baseSet = new Set(baseOrder);

    for (const id of targetSlide.elementOrder) {
      if (!baseSet.has(id)) {
        baseOrder.push(id);
      }
    }

    return baseOrder;
  }
}

// SVG Element renderer (dispatches to shared shape/image renderers)
const PresenterSlideElement: React.FC<{ element: SlideElement; resources: Record<string, Resource> }> = ({ element, resources }) => {
  if (!element.visible) return null;

  // Text is rendered as HTML overlay for markdown support
  if (element.type === 'text') return null;

  if (element.type === 'shape') {
    return <RenderShape element={element as ShapeElement} />;
  }

  if (element.type === 'image') {
    const imgEl = element as ImageElement;
    const resource = imgEl.resourceId ? resources[imgEl.resourceId] : undefined;
    // Skip videos - they're rendered as HTML overlay
    if (resource?.type === 'video') return null;
    return <RenderImage element={imgEl} resource={resource} clipIdPrefix={`presenter-${element.id}`} />;
  }

  return null;
};

// Render a single element with correct positioning and z-order
export function renderPresenterElement(
  element: SlideElement,
  index: number,
  scale: number,
  stageW: number,
  stageH: number,
  resources: Record<string, Resource>
): React.ReactNode {
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
          transformOrigin: 'center center',
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

  // Check for dissolve source on image elements (for blending two images/videos)
  if (element.type === 'image') {
    const imgEl = element as ImageElementWithDissolve;
    const dissolveSource = imgEl._dissolveSource;
    const targetResource = imgEl.resourceId ? resources[imgEl.resourceId] : undefined;
    const sourceResource = dissolveSource?.resourceId ? resources[dissolveSource.resourceId] : undefined;

    // Helper to render an image/video element
    const renderMedia = (
      resourceToRender: typeof targetResource,
      opacity: number,
      cropX: number,
      cropY: number,
      cropWidth: number,
      cropHeight: number,
      zIdx: number,
      keySuffix: string,
      autoPlay: boolean = true
    ) => {
      if (!resourceToRender) return null;

      const hasCrop = cropWidth > 0 && cropHeight > 0;

      if (resourceToRender.type === 'video') {
        if (hasCrop) {
          const scaleX = resourceToRender.originalWidth / cropWidth;
          const scaleY = resourceToRender.originalHeight / cropHeight;
          return (
            <div
              key={`${element.id}${keySuffix}`}
              style={{
                position: 'absolute',
                left: `${element.x * scale}px`,
                top: `${element.y * scale}px`,
                width: `${element.width * scale}px`,
                height: `${element.height * scale}px`,
                transform: `rotate(${element.rotation}deg)`,
                transformOrigin: 'center center',
                opacity,
                overflow: 'hidden',
                zIndex: zIdx,
              }}
            >
              <video
                src={resourceToRender.src}
                autoPlay={autoPlay && (imgEl.playing ?? true)}
                loop={imgEl.loop ?? false}
                muted={imgEl.muted ?? false}
                playsInline
                preload="metadata"
                style={{
                  width: `${element.width * scale * scaleX}px`,
                  height: `${element.height * scale * scaleY}px`,
                  marginLeft: `${-cropX * (element.width / cropWidth) * scale}px`,
                  marginTop: `${-cropY * (element.height / cropHeight) * scale}px`,
                }}
              />
            </div>
          );
        }
        return (
          <video
            key={`${element.id}${keySuffix}`}
            src={resourceToRender.src}
            autoPlay={autoPlay && (imgEl.playing ?? true)}
            loop={imgEl.loop ?? false}
            muted={imgEl.muted ?? false}
            playsInline
            preload="metadata"
            style={{
              position: 'absolute',
              left: `${element.x * scale}px`,
              top: `${element.y * scale}px`,
              width: `${element.width * scale}px`,
              height: `${element.height * scale}px`,
              transform: `rotate(${element.rotation}deg)`,
              transformOrigin: 'center center',
              opacity,
              objectFit: 'cover',
              zIndex: zIdx,
            }}
          />
        );
      }

      // Image
      const imgElement: ImageElement = {
        ...imgEl,
        resourceId: resourceToRender.id,
        opacity,
        cropX,
        cropY,
        cropWidth,
        cropHeight,
      };
      return (
        <svg
          key={`${element.id}${keySuffix}`}
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            width: stageW,
            height: stageH,
            pointerEvents: 'none',
            zIndex: zIdx,
          }}
          viewBox={`0 0 ${SLIDE_WIDTH} ${SLIDE_HEIGHT}`}
        >
          <RenderImage element={imgElement} resource={resourceToRender} clipIdPrefix={`presenter-${element.id}${keySuffix}`} />
        </svg>
      );
    };

    // If we have a dissolve source, render both (videos paused during transition)
    if (dissolveSource && sourceResource) {
      return (
        <React.Fragment key={element.id}>
          {renderMedia(sourceResource, dissolveSource.opacity, dissolveSource.cropX, dissolveSource.cropY, dissolveSource.cropWidth, dissolveSource.cropHeight, index, '-src', false)}
          {renderMedia(targetResource, element.opacity, imgEl.cropX, imgEl.cropY, imgEl.cropWidth, imgEl.cropHeight, index + 0.5, '-tgt', false)}
        </React.Fragment>
      );
    }

    // Single image/video - no dissolve
    if (targetResource?.type === 'video') {
      return renderMedia(targetResource, element.opacity, imgEl.cropX, imgEl.cropY, imgEl.cropWidth, imgEl.cropHeight, index, '');
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
      <PresenterSlideElement element={element} resources={resources} />
    </svg>
  );
}

// ============================================================================
// SlideRenderer - Reusable component for rendering slides with video support
// ============================================================================

interface SlideRendererProps {
  slide: Slide;
  width: number;
  height: number;
  resources: Record<string, Resource>;
  autoPlayVideos?: boolean;
}

export const SlideRenderer: React.FC<SlideRendererProps> = ({
  slide,
  width,
  height,
  resources,
  autoPlayVideos = false,
}) => {
  const scale = width / SLIDE_WIDTH;
  const bgColor = getSlideBackground(slide);
  const elements = slide.elementOrder.map((id) => slide.elements[id]).filter(Boolean);

  return (
    <div
      className="relative overflow-hidden"
      style={{ width, height, background: bgColor }}
    >
      {elements.map((element, index) => {
        if (!element.visible) return null;

        // Text elements
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
                transformOrigin: 'center center',
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

        // Image/Video elements
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
                    transformOrigin: 'center center',
                    opacity: element.opacity,
                    overflow: 'hidden',
                    zIndex: index,
                  }}
                >
                  <video
                    src={resource.src}
                    autoPlay={autoPlayVideos && (imgEl.playing ?? true)}
                    loop={imgEl.loop ?? false}
                    muted={imgEl.muted ?? true}
                    playsInline
                    preload="metadata"
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
                autoPlay={autoPlayVideos && (imgEl.playing ?? true)}
                loop={imgEl.loop ?? false}
                muted={imgEl.muted ?? true}
                playsInline
                preload="metadata"
                style={{
                  position: 'absolute',
                  left: `${element.x * scale}px`,
                  top: `${element.y * scale}px`,
                  width: `${element.width * scale}px`,
                  height: `${element.height * scale}px`,
                  transform: `rotate(${element.rotation}deg)`,
                  transformOrigin: 'center center',
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
              width,
              height,
              pointerEvents: 'none',
              zIndex: index,
            }}
            viewBox={`0 0 ${SLIDE_WIDTH} ${SLIDE_HEIGHT}`}
          >
            <PresenterSlideElement element={element} resources={resources} />
          </svg>
        );
      })}
    </div>
  );
};
