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
              transformOrigin: 'center center',
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
            transformOrigin: 'center center',
            opacity: element.opacity,
            objectFit: 'cover',
            zIndex: index,
          }}
        />
      );
    }
  }

  // Check for dissolve source on image elements (for blending two images)
  if (element.type === 'image') {
    const imgEl = element as ImageElementWithDissolve;
    const dissolveSource = imgEl._dissolveSource;

    if (dissolveSource && dissolveSource.resourceId) {
      // Create a temporary element for the dissolve source
      const sourceElement: ImageElement = {
        ...imgEl,
        id: `${imgEl.id}-dissolve-source`,
        resourceId: dissolveSource.resourceId,
        opacity: dissolveSource.opacity,
        cropX: dissolveSource.cropX,
        cropY: dissolveSource.cropY,
        cropWidth: dissolveSource.cropWidth,
        cropHeight: dissolveSource.cropHeight,
      };

      const sourceResource = dissolveSource.resourceId ? resources[dissolveSource.resourceId] : undefined;
      const targetResource = imgEl.resourceId ? resources[imgEl.resourceId] : undefined;

      // Render both source (underneath) and target (on top)
      return (
        <React.Fragment key={element.id}>
          <svg
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
            <RenderImage element={sourceElement} resource={sourceResource} clipIdPrefix={`presenter-${element.id}-src`} />
          </svg>
          <svg
            style={{
              position: 'absolute',
              left: 0,
              top: 0,
              width: stageW,
              height: stageH,
              pointerEvents: 'none',
              zIndex: index + 0.5,
            }}
            viewBox={`0 0 ${SLIDE_WIDTH} ${SLIDE_HEIGHT}`}
          >
            <RenderImage element={imgEl} resource={targetResource} clipIdPrefix={`presenter-${element.id}-tgt`} />
          </svg>
        </React.Fragment>
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
      <PresenterSlideElement element={element} resources={resources} />
    </svg>
  );
}
