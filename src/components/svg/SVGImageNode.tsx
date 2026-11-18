import { GroupCrop } from './GroupCrop';
import React, { useEffect, useRef } from 'react';
import { usePresentationStore } from '../../store/presentationStore';
import { RenderImage, RenderShape } from './ElementRenderer';
import { segmentOf } from '../../utils/animation/mediaPlayback';
import { imageTintShape } from '../../utils/paint/imageTint';
import { useEditorStore } from '../../store/editorStore';
import type { ImageElement } from '../../types/presentation';
import { useMediaUrl } from './mediaSources';

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
  const zoom = useEditorStore(s => s.zoom);

  const resource = usePresentationStore((s) =>
    element.resourceId ? s.presentation.resources[element.resourceId] : undefined
  );

  const isVideo = resource?.type === 'video';
  // One shared blob URL per source, not a parse of the inline data per player.
  const videoUrl = useMediaUrl(isVideo ? resource?.src : undefined);
  // The editor's video player is HTML; its tint is the shared shape fill.
  const tint = isVideo ? imageTintShape(element) : null;

  // The editor shows a still: the frame this keyframe's playback starts on
  // (From). Playing it is the presenter's job.
  const startFrame = segmentOf(element, resource?.duration).from;
  const videoRef = useRef<HTMLVideoElement | null>(null);
  useEffect(() => {
    const video = videoRef.current;
    if (video && Math.abs(video.currentTime - startFrame) > 1e-3) video.currentTime = startFrame;
  }, [startFrame, videoUrl]);

  // Rotate around the center of the element
  const cx = element.x + element.width / 2;
  const cy = element.y + element.height / 2;
  const transform = element.rotation ? `rotate(${element.rotation}, ${cx}, ${cy})` : undefined;

  const interactionStyle: React.CSSProperties = {
    cursor: disableInteraction ? 'default' : (element.locked ? 'default' : 'move'),
    pointerEvents: disableInteraction ? 'none' : 'auto',
    touchAction: 'none',
  };

  if (isVideo && resource.src) {
    // A small badge marks it as a video; it takes no clicks, so it never
    // gets in the way of moving the element.
    const badge = Math.min(22 / zoom, element.width * 0.3, element.height * 0.3);
    const pad = Math.min(6 / zoom, badge * 0.3);
    const bx = element.x + pad, by = element.y + pad;
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
            ref={videoRef}
            onLoadedMetadata={e => { if (startFrame > 0) e.currentTarget.currentTime = startFrame; }}
            src={videoUrl}
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
      {!disableInteraction && <GroupCrop element={element} scope={scope}><g transform={transform}>
        <rect data-element-id={element.id} x={element.x} y={element.y} width={element.width} height={element.height}
          fill="transparent" style={interactionStyle}
          onPointerDown={onPointerDown} onMouseEnter={onMouseEnter} onMouseLeave={onMouseLeave} onDoubleClick={onDoubleClick} />
        {badge > 0 && (
          <g data-video-badge pointerEvents="none">
            <rect x={bx} y={by} width={badge} height={badge} rx={badge * 0.22} fill="rgba(0, 0, 0, 0.55)" />
            <polygon points={`${bx + badge * 0.38},${by + badge * 0.28} ${bx + badge * 0.38},${by + badge * 0.72} ${bx + badge * 0.74},${by + badge * 0.5}`} fill="white" />
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
