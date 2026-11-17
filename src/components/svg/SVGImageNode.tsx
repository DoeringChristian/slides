import { GroupCrop } from './GroupCrop';
import React, { useRef, useCallback, useState } from 'react';
import { usePresentationStore } from '../../store/presentationStore';
import { RenderImage, RenderShape } from './ElementRenderer';
import { segmentOf } from '../../utils/animation/mediaPlayback';
import { imageTintShape } from '../../utils/paint/imageTint';
import { useEditorStore } from '../../store/editorStore';
import type { ImageElement } from '../../types/presentation';

interface Props {
  element: ImageElement;
  disableInteraction?: boolean;
  onPointerDown?: (e: React.PointerEvent) => void;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
  onDoubleClick?: () => void;
}

export const SVGImageNode: React.FC<Props> = React.memo(({
  element,
  disableInteraction,
  onPointerDown,
  onMouseEnter,
  onMouseLeave,
  onDoubleClick,
}) => {
  const scope = useEditorStore(s => s.activeObjectGroupId);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  // Editor preview starts paused - user clicks play button to preview
  const [isPlaying, setIsPlaying] = useState(false);
  const [isHovered, setIsHovered] = useState(false);

  const resource = usePresentationStore((s) =>
    element.resourceId ? s.presentation.resources[element.resourceId] : undefined
  );

  const isVideo = resource?.type === 'video';
  // The editor's video player is HTML; its tint is the shared shape fill.
  const tint = isVideo ? imageTintShape(element) : null;

  // The editor preview opens on this keyframe's start frame (From) and
  // plays to its end (To).
  const segment = segmentOf(element, resource?.duration);
  const startFrame = segment.from;
  const trim = { end: segment.to };
  const setVideoRef = useCallback((video: HTMLVideoElement | null) => {
    if (video) {
      videoRef.current = video;
      if (startFrame > 0) video.currentTime = startFrame;
      video.ontimeupdate = () => {
        if (video.currentTime >= trim.end) { video.pause(); video.currentTime = trim.end; setIsPlaying(false); }
      };
      video.onended = () => setIsPlaying(false);
    }
  }, [startFrame, trim.end]);

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
    touchAction: 'none',
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
      <><GroupCrop element={element}><g
        transform={transform}
        data-element-id={element.id}
      >
        {/* The player takes no clicks: HTML in a foreignObject ignores the
            crop's clip and mask for hit-testing. The clipped hit area below
            takes them, as for images. */}
        <foreignObject
          x={element.x}
          y={element.y}
          width={element.width}
          height={element.height}
          opacity={element.opacity}
          style={{ pointerEvents: 'none' }}
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
            playsInline
            preload="metadata"
          />
        </foreignObject>
      </g>{tint && <RenderShape element={tint} />}</GroupCrop>
      {!disableInteraction && <GroupCrop element={element} scope={scope}><g transform={transform}
        onMouseEnter={handleVideoMouseEnter} onMouseLeave={handleVideoMouseLeave}>
        <rect data-element-id={element.id} x={element.x} y={element.y} width={element.width} height={element.height}
          fill="transparent" style={interactionStyle}
          onPointerDown={onPointerDown} onDoubleClick={onDoubleClick} />
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
      </g></GroupCrop>}
      </>
    );
  }

  // Image (or no resource / loading state) - use RenderImage for visual, add hit area on top
  return (
    <g data-element-id={element.id}>
      <RenderImage element={element} resource={resource} />
      {/* Transparent hit area for interaction, clipped like the picture:
          the cropped-away part is not there to click. */}
      <GroupCrop element={element} scope={scope}><g transform={transform}>
        <rect
          x={element.x}
          y={element.y}
          width={element.width}
          height={element.height}
          fill="transparent"
          style={interactionStyle}
          {...(disableInteraction ? {} : {
            onPointerDown,
            onMouseEnter,
            onMouseLeave,
            onDoubleClick,
          })}
        />
      </g></GroupCrop>
    </g>
  );
});
