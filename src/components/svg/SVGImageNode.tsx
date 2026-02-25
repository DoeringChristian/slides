import React, { useRef, useCallback, useState } from 'react';
import { usePresentationStore } from '../../store/presentationStore';
import { RenderImage } from './ElementRenderer';
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

  const interactionStyle: React.CSSProperties = {
    cursor: disableInteraction ? 'default' : (element.locked ? 'default' : 'move'),
    pointerEvents: disableInteraction ? 'none' : 'auto',
  };

  // Video resource - keep editor-specific video with play/pause overlay
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
          style={interactionStyle}
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

  // Image (or no resource / loading state) - use RenderImage for visual, add hit area on top
  return (
    <g data-element-id={element.id}>
      <RenderImage element={element} resource={resource} clipIdPrefix="editor" />
      {/* Transparent hit area for interaction */}
      <g transform={transform}>
        <rect
          x={element.x}
          y={element.y}
          width={element.width}
          height={element.height}
          fill="transparent"
          style={interactionStyle}
          {...(disableInteraction ? {} : {
            onMouseDown,
            onMouseEnter,
            onMouseLeave,
          })}
        />
      </g>
    </g>
  );
};
