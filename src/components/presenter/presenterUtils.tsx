import React, { useRef, useState, useCallback, useEffect } from 'react';
import { Play, Pause } from 'lucide-react';
import { CustomMarkdownRenderer } from '../canvas/CustomMarkdownRenderer';
import { RenderShape, RenderImage } from '../svg/ElementRenderer';
import { SLIDE_WIDTH, SLIDE_HEIGHT, TEXT_BOX_PADDING } from '../../utils/constants';
import type { SlideElement, TextElement, ShapeElement, ImageElement, Slide, Resource } from '../../types/presentation';
import type { CrossfadeSource, TextDissolveSource } from '../../utils/interpolation';

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

// ============================================================================
// PresenterTextElement - Shared text renderer for presenter views and control panel
// ============================================================================

interface PresenterTextElementProps {
  element: TextElement;
  scale: number;
  zIndex: number;
  dissolveText?: TextDissolveSource;
}

export const PresenterTextElement: React.FC<PresenterTextElementProps> = ({ element, scale, zIndex, dissolveText }) => {
  const textContainerStyle = (opacity: number): React.CSSProperties => ({
    position: 'absolute',
    left: `${element.x * scale}px`,
    top: `${element.y * scale}px`,
    width: `${element.width * scale}px`,
    height: `${element.height * scale}px`,
    transform: `rotate(${element.rotation}deg)`,
    transformOrigin: 'center center',
    opacity,
    overflow: 'visible',
    display: 'flex',
    alignItems: element.style.verticalAlign === 'middle' ? 'center' :
               element.style.verticalAlign === 'bottom' ? 'flex-end' : 'flex-start',
    zIndex,
    userSelect: 'none',
  });

  if (dissolveText) {
    return (
      <React.Fragment>
        <div style={textContainerStyle(dissolveText.opacity)}>
          <div style={{ width: '100%', padding: `${TEXT_BOX_PADDING * scale}px` }}>
            <CustomMarkdownRenderer
              text={dissolveText.text}
              style={element.style}
              zoom={scale}
            />
          </div>
        </div>
        <div style={textContainerStyle(element.opacity)}>
          <div style={{ width: '100%', padding: `${TEXT_BOX_PADDING * scale}px` }}>
            <CustomMarkdownRenderer
              text={element.text}
              style={element.style}
              zoom={scale}
            />
          </div>
        </div>
      </React.Fragment>
    );
  }

  return (
    <div style={textContainerStyle(element.opacity)}>
      <div style={{ width: '100%', padding: `${TEXT_BOX_PADDING * scale}px` }}>
        <CustomMarkdownRenderer
          text={element.text}
          style={element.style}
          zoom={scale}
        />
      </div>
    </div>
  );
};

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
    const textEl = element as (TextElement & { _dissolveText?: TextDissolveSource });
    return (
      <PresenterTextElement
        key={element.id}
        element={textEl}
        scale={scale}
        zIndex={index}
        dissolveText={textEl._dissolveText}
      />
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
// VideoWithControls - Video element with play/pause button and progress bar
// ============================================================================

interface VideoWithControlsProps {
  src: string;
  autoPlay: boolean;
  loop: boolean;
  muted: boolean;
  videoStyle: React.CSSProperties;
  containerStyle?: React.CSSProperties;
  /** If true, wrap video in a container div (for cropped videos) */
  cropped?: boolean;
  /** Callback to send video commands to audience view */
  onVideoCommand?: (action: 'play' | 'pause' | 'seek', currentTime?: number) => void;
}

const VideoWithControls: React.FC<VideoWithControlsProps> = ({
  src,
  autoPlay,
  loop,
  muted,
  videoStyle,
  containerStyle,
  cropped,
  onVideoCommand,
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isPlaying, setIsPlaying] = useState(autoPlay);
  const [progress, setProgress] = useState(0);
  const [isHovered, setIsHovered] = useState(false);
  const rafRef = useRef<number>(0);

  // Update progress via rAF
  useEffect(() => {
    const update = () => {
      const v = videoRef.current;
      if (v && v.duration) {
        setProgress(v.currentTime / v.duration);
      }
      rafRef.current = requestAnimationFrame(update);
    };
    rafRef.current = requestAnimationFrame(update);
    return () => cancelAnimationFrame(rafRef.current);
  }, []);

  // Sync play state with video events
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);
    const onEnded = () => { if (!loop) setIsPlaying(false); };
    v.addEventListener('play', onPlay);
    v.addEventListener('pause', onPause);
    v.addEventListener('ended', onEnded);
    return () => {
      v.removeEventListener('play', onPlay);
      v.removeEventListener('pause', onPause);
      v.removeEventListener('ended', onEnded);
    };
  }, [loop]);

  const togglePlayPause = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    const v = videoRef.current;
    if (!v) return;
    if (v.paused || v.ended) {
      v.play().catch(() => {
        v.muted = true;
        v.play().catch(() => {});
      });
      onVideoCommand?.('play', v.currentTime);
    } else {
      v.pause();
      onVideoCommand?.('pause', v.currentTime);
    }
  }, [onVideoCommand]);

  const handleSeek = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    e.stopPropagation();
    const v = videoRef.current;
    if (!v || !v.duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    v.currentTime = ratio * v.duration;
    setProgress(ratio);
    onVideoCommand?.('seek', v.currentTime);
  }, [onVideoCommand]);

  // Outer wrapper uses containerStyle positioning (absolute pos, z-index, etc.)
  const outerStyle: React.CSSProperties = containerStyle || videoStyle;

  return (
    <div
      style={{
        ...outerStyle,
        position: outerStyle.position || 'absolute',
      }}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <video
        ref={videoRef}
        src={src}
        autoPlay={autoPlay}
        loop={loop}
        muted={muted}
        playsInline
        preload="metadata"
        style={cropped ? videoStyle : {
          width: '100%',
          height: '100%',
          objectFit: (videoStyle.objectFit as React.CSSProperties['objectFit']) || 'cover',
        }}
      />

      {/* Controls overlay */}
      {isHovered && (
        <>
          {/* Play/Pause button */}
          <button
            onClick={togglePlayPause}
            style={{
              position: 'absolute',
              top: '50%',
              left: '50%',
              transform: 'translate(-50%, -50%)',
              background: 'rgba(0,0,0,0.5)',
              border: 'none',
              borderRadius: '50%',
              width: 32,
              height: 32,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              color: 'white',
              zIndex: 10,
            }}
          >
            {isPlaying ? <Pause size={16} /> : <Play size={16} />}
          </button>

          {/* Progress bar */}
          <div
            onClick={handleSeek}
            style={{
              position: 'absolute',
              bottom: 0,
              left: 0,
              right: 0,
              height: 6,
              background: 'rgba(255,255,255,0.3)',
              cursor: 'pointer',
              zIndex: 10,
            }}
          >
            <div
              style={{
                height: '100%',
                width: `${progress * 100}%`,
                background: 'rgba(59,130,246,0.9)',
              }}
            />
          </div>
        </>
      )}
    </div>
  );
};

// ============================================================================
// SlideRenderer - Reusable component for rendering slides with video support
// ============================================================================

interface SlideRendererProps {
  slide: Slide;
  width: number;
  height: number;
  resources: Record<string, Resource>;
  autoPlayVideos?: boolean;
  onVideoCommand?: (action: 'play' | 'pause' | 'seek', currentTime?: number) => void;
}

export const SlideRenderer: React.FC<SlideRendererProps> = ({
  slide,
  width,
  height,
  resources,
  autoPlayVideos = false,
  onVideoCommand,
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
          return (
            <PresenterTextElement
              key={element.id}
              element={element as TextElement}
              scale={scale}
              zIndex={index}
            />
          );
        }

        // Image/Video elements
        if (element.type === 'image') {
          const imgEl = element as ImageElement;
          const resource = imgEl.resourceId ? resources[imgEl.resourceId] : undefined;

          if (resource?.type === 'video') {
            const hasCrop = imgEl.cropWidth > 0 && imgEl.cropHeight > 0;
            const shouldAutoPlay = autoPlayVideos && (imgEl.playing ?? true);

            if (hasCrop) {
              const scaleX = resource.originalWidth / imgEl.cropWidth;
              const scaleY = resource.originalHeight / imgEl.cropHeight;
              return (
                <VideoWithControls
                  key={element.id}
                  src={resource.src}
                  autoPlay={shouldAutoPlay}
                  loop={imgEl.loop ?? false}
                  muted={imgEl.muted ?? true}
                  cropped
                  onVideoCommand={onVideoCommand}
                  containerStyle={{
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
                  videoStyle={{
                    width: `${element.width * scale * scaleX}px`,
                    height: `${element.height * scale * scaleY}px`,
                    marginLeft: `${-imgEl.cropX * (element.width / imgEl.cropWidth) * scale}px`,
                    marginTop: `${-imgEl.cropY * (element.height / imgEl.cropHeight) * scale}px`,
                  }}
                />
              );
            }

            return (
              <VideoWithControls
                key={element.id}
                src={resource.src}
                autoPlay={shouldAutoPlay}
                loop={imgEl.loop ?? false}
                muted={imgEl.muted ?? true}
                onVideoCommand={onVideoCommand}
                videoStyle={{
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
