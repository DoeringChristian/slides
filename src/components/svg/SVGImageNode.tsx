import React, { useRef, useEffect, useState } from 'react';
import { usePresentationStore } from '../../store/presentationStore';
import type { ImageElement } from '../../types/presentation';

interface Props {
  element: ImageElement;
  disableInteraction?: boolean;
  onMouseDown?: (e: React.MouseEvent) => void;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
}

export const SVGImageNode: React.FC<Props> = ({
  element,
  disableInteraction,
  onMouseDown,
  onMouseEnter,
  onMouseLeave,
}) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [videoReady, setVideoReady] = useState(false);
  const [, forceUpdate] = useState(0);

  const resource = usePresentationStore((s) =>
    element.resourceId ? s.presentation.resources[element.resourceId] : undefined
  );

  const isVideo = resource?.type === 'video';

  // Create and manage video element
  useEffect(() => {
    if (!isVideo || !resource?.src) {
      setVideoReady(false);
      if (videoRef.current) {
        videoRef.current.pause();
        videoRef.current.src = '';
        videoRef.current = null;
      }
      return;
    }

    const video = document.createElement('video');
    video.src = resource.src;
    video.loop = element.loop ?? false;
    video.muted = element.muted ?? false;
    video.playsInline = true;
    video.preload = 'auto';

    video.onloadeddata = () => {
      videoRef.current = video;
      if ((element.startTime ?? 0) > 0) {
        video.currentTime = element.startTime ?? 0;
      }
      setVideoReady(true);
    };

    video.onerror = () => {
      setVideoReady(false);
    };

    return () => {
      video.pause();
      video.src = '';
      videoRef.current = null;
    };
  }, [isVideo, resource?.src]);

  // Handle loop/muted changes for video
  useEffect(() => {
    if (videoRef.current && isVideo) {
      videoRef.current.loop = element.loop ?? false;
      videoRef.current.muted = element.muted ?? false;
    }
  }, [isVideo, element.loop, element.muted]);

  // Handle play/pause based on element.playing and visibility
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !videoReady || !isVideo) return;

    if ((element.playing ?? true) && element.visible) {
      video.play().catch(() => {
        video.muted = true;
        video.play().catch(() => {});
      });
    } else {
      video.pause();
    }
  }, [isVideo, element.playing, element.visible, videoReady]);

  // Animation loop for video - trigger re-render to update foreignObject
  useEffect(() => {
    if (!isVideo || !videoReady || !videoRef.current) return;

    let animationId: number;
    const updateFrame = () => {
      forceUpdate((n) => n + 1);
      animationId = requestAnimationFrame(updateFrame);
    };
    animationId = requestAnimationFrame(updateFrame);

    return () => cancelAnimationFrame(animationId);
  }, [isVideo, videoReady]);

  // Rotate around the center of the element
  const cx = element.x + element.width / 2;
  const cy = element.y + element.height / 2;
  const transform = element.rotation ? `rotate(${element.rotation}, ${cx}, ${cy})` : undefined;

  const commonStyle: React.CSSProperties = {
    cursor: disableInteraction ? 'default' : (element.locked ? 'default' : 'move'),
    pointerEvents: disableInteraction ? 'none' : 'auto',
  };

  // No resource: render placeholder
  if (!resource) {
    return (
      <g transform={transform} data-element-id={element.id}>
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
          style={commonStyle}
          onMouseDown={disableInteraction ? undefined : onMouseDown}
          onMouseEnter={disableInteraction ? undefined : onMouseEnter}
          onMouseLeave={disableInteraction ? undefined : onMouseLeave}
        />
      </g>
    );
  }

  // Apply crop
  const hasCrop = element.cropWidth > 0 && element.cropHeight > 0;

  // Video resource
  if (isVideo && videoReady && videoRef.current) {
    // Use foreignObject to embed video
    return (
      <g transform={transform} data-element-id={element.id}>
        <foreignObject
          x={element.x}
          y={element.y}
          width={element.width}
          height={element.height}
          opacity={element.opacity}
          style={commonStyle}
          onMouseDown={disableInteraction ? undefined : onMouseDown}
          onMouseEnter={disableInteraction ? undefined : onMouseEnter}
          onMouseLeave={disableInteraction ? undefined : onMouseLeave}
        >
          <video
            ref={(el) => {
              if (el && videoRef.current && el !== videoRef.current) {
                el.srcObject = null;
              }
            }}
            src={resource.src}
            style={{
              width: '100%',
              height: '100%',
              objectFit: 'cover',
              pointerEvents: 'none',
            }}
            muted={element.muted ?? false}
            loop={element.loop ?? false}
            playsInline
            autoPlay={element.playing ?? true}
          />
        </foreignObject>
      </g>
    );
  }

  // Image resource
  if (resource.type === 'image' && resource.src) {
    if (hasCrop) {
      // Use clipPath for cropping
      const clipId = `clip-${element.id}`;
      const scaleX = element.width / element.cropWidth;
      const scaleY = element.height / element.cropHeight;

      return (
        <g transform={transform} data-element-id={element.id}>
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
              style={commonStyle}
              onMouseDown={disableInteraction ? undefined : onMouseDown}
              onMouseEnter={disableInteraction ? undefined : onMouseEnter}
              onMouseLeave={disableInteraction ? undefined : onMouseLeave}
            />
          </g>
        </g>
      );
    }

    return (
      <g transform={transform} data-element-id={element.id}>
        <image
          href={resource.src}
          x={element.x}
          y={element.y}
          width={element.width}
          height={element.height}
          opacity={element.opacity}
          preserveAspectRatio="none"
          style={commonStyle}
          onMouseDown={disableInteraction ? undefined : onMouseDown}
          onMouseEnter={disableInteraction ? undefined : onMouseEnter}
          onMouseLeave={disableInteraction ? undefined : onMouseLeave}
        />
      </g>
    );
  }

  // Loading/error state
  return (
    <g transform={transform} data-element-id={element.id}>
      <rect
        x={element.x}
        y={element.y}
        width={element.width}
        height={element.height}
        fill="#1f2937"
        stroke="#6b7280"
        strokeWidth={2}
        strokeDasharray="8 4"
        opacity={element.opacity}
        style={commonStyle}
        onMouseDown={disableInteraction ? undefined : onMouseDown}
        onMouseEnter={disableInteraction ? undefined : onMouseEnter}
        onMouseLeave={disableInteraction ? undefined : onMouseLeave}
      />
    </g>
  );
};
