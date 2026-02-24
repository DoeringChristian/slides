import React, { useRef, useCallback, useState } from 'react';
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
  // Editor preview starts paused - user clicks play button to preview
  const [isPlaying, setIsPlaying] = useState(false);
  const [isHovered, setIsHovered] = useState(false);

  const resource = usePresentationStore((s) =>
    element.resourceId ? s.presentation.resources[element.resourceId] : undefined
  );

  const isVideo = resource?.type === 'video';

  // Callback ref for video element - handles initial setup only
  const setVideoRef = useCallback((video: HTMLVideoElement | null) => {
    if (video) {
      videoRef.current = video;

      // Set initial time if specified
      if ((element.startTime ?? 0) > 0) {
        video.currentTime = element.startTime ?? 0;
      }

      // Reset playing state when video ends (if not looping)
      video.onended = () => {
        if (!video.loop) {
          setIsPlaying(false);
        }
      };
    }
  }, [element.startTime]);

  // Toggle play/pause
  const handlePlayPause = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();

    const video = videoRef.current;
    if (!video) return;

    if (isPlaying) {
      video.pause();
      setIsPlaying(false);
    } else {
      video.play().catch(() => {
        video.muted = true;
        video.play().catch(() => {});
      });
      setIsPlaying(true);
    }
  }, [isPlaying]);

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

  // Video resource - render with play button overlay on hover
  if (isVideo && resource.src) {
    // Play button size scales with element but has min/max bounds
    const buttonSize = Math.max(24, Math.min(48, Math.min(element.width, element.height) * 0.15));
    const iconSize = buttonSize * 0.5;

    const handleVideoMouseEnter = () => {
      setIsHovered(true);
      onMouseEnter?.();
    };

    const handleVideoMouseLeave = () => {
      setIsHovered(false);
      onMouseLeave?.();
    };

    return (
      <g
        transform={transform}
        data-element-id={element.id}
        onMouseEnter={disableInteraction ? undefined : handleVideoMouseEnter}
        onMouseLeave={disableInteraction ? undefined : handleVideoMouseLeave}
      >
        <foreignObject
          x={element.x}
          y={element.y}
          width={element.width}
          height={element.height}
          opacity={element.opacity}
          style={commonStyle}
          onMouseDown={disableInteraction ? undefined : onMouseDown}
        >
          <video
            ref={setVideoRef}
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
            preload="metadata"
          />
        </foreignObject>
        {/* Play/Pause button overlay - only show on hover */}
        {!disableInteraction && isHovered && (
          <g
            onClick={handlePlayPause}
            style={{ cursor: 'pointer' }}
          >
            <circle
              cx={element.x + element.width / 2}
              cy={element.y + element.height / 2}
              r={buttonSize}
              fill="rgba(0, 0, 0, 0.5)"
              stroke="white"
              strokeWidth={2}
            />
            {isPlaying ? (
              // Pause icon (two vertical bars)
              <>
                <rect
                  x={element.x + element.width / 2 - iconSize * 0.5}
                  y={element.y + element.height / 2 - iconSize * 0.6}
                  width={iconSize * 0.3}
                  height={iconSize * 1.2}
                  fill="white"
                />
                <rect
                  x={element.x + element.width / 2 + iconSize * 0.2}
                  y={element.y + element.height / 2 - iconSize * 0.6}
                  width={iconSize * 0.3}
                  height={iconSize * 1.2}
                  fill="white"
                />
              </>
            ) : (
              // Play icon (triangle)
              <polygon
                points={`
                  ${element.x + element.width / 2 - iconSize * 0.4},${element.y + element.height / 2 - iconSize * 0.6}
                  ${element.x + element.width / 2 - iconSize * 0.4},${element.y + element.height / 2 + iconSize * 0.6}
                  ${element.x + element.width / 2 + iconSize * 0.6},${element.y + element.height / 2}
                `}
                fill="white"
              />
            )}
          </g>
        )}
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
