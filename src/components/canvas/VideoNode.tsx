import React, { useRef, useEffect, useState } from 'react';
import { Image, Rect } from 'react-konva';
import { usePresentationStore } from '../../store/presentationStore';
import type { VideoElement } from '../../types/presentation';
import type Konva from 'konva';

interface Props {
  element: VideoElement;
  isSelected: boolean;
  disableInteraction?: boolean;
  onSelect: (id: string, e: Konva.KonvaEventObject<MouseEvent>) => void;
  onDragEnd: (id: string, x: number, y: number) => void;
  onDragMove?: (id: string, x: number, y: number, node: Konva.Node) => void;
  onTransformEnd: (id: string, attrs: Record<string, number>) => void;
}

export const VideoNode: React.FC<Props> = ({
  element,
  disableInteraction,
  onSelect,
  onDragEnd,
  onDragMove,
  onTransformEnd,
}) => {
  const imgRef = useRef<Konva.Image>(null);
  const rectRef = useRef<Konva.Rect>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const animationRef = useRef<number | null>(null);
  const [videoReady, setVideoReady] = useState(false);

  const resource = usePresentationStore((s) =>
    element.resourceId ? s.presentation.resources[element.resourceId] : undefined
  );

  // Create and manage video element
  useEffect(() => {
    if (!resource?.src) {
      setVideoReady(false);
      return;
    }

    const video = document.createElement('video');
    video.src = resource.src;
    video.loop = element.loop;
    video.muted = element.muted;
    video.playsInline = true;
    video.preload = 'auto';

    video.onloadeddata = () => {
      videoRef.current = video;
      if (element.startTime > 0) {
        video.currentTime = element.startTime;
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
  }, [resource?.src]);

  // Handle loop/muted changes
  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.loop = element.loop;
      videoRef.current.muted = element.muted;
    }
  }, [element.loop, element.muted]);

  // Handle play/pause based on element.playing and visibility
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !videoReady) return;

    if (element.playing && element.visible) {
      video.play().catch(() => {
        // Autoplay might be blocked, mute and try again
        video.muted = true;
        video.play().catch(() => {});
      });
    } else {
      video.pause();
    }
  }, [element.playing, element.visible, videoReady]);

  // Animation loop to update Konva image
  useEffect(() => {
    if (!videoReady || !videoRef.current) return;

    const updateFrame = () => {
      if (imgRef.current && videoRef.current) {
        imgRef.current.getLayer()?.batchDraw();
      }
      animationRef.current = requestAnimationFrame(updateFrame);
    };

    animationRef.current = requestAnimationFrame(updateFrame);

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [videoReady]);

  const commonProps = {
    id: element.id,
    x: element.x,
    y: element.y,
    width: element.width,
    height: element.height,
    rotation: element.rotation,
    opacity: element.opacity,
    draggable: !element.locked && !disableInteraction,
    listening: !disableInteraction,
    onClick: (e: Konva.KonvaEventObject<MouseEvent>) => onSelect(element.id, e),
    onTap: (e: any) => onSelect(element.id, e),
    onDragMove: (e: Konva.KonvaEventObject<DragEvent>) => {
      onDragMove?.(element.id, e.target.x(), e.target.y(), e.target);
    },
    onDragEnd: (e: Konva.KonvaEventObject<DragEvent>) => {
      onDragEnd(element.id, e.target.x(), e.target.y());
    },
  };

  const handleTransformEnd = () => {
    const node = imgRef.current || rectRef.current;
    if (!node) return;
    const scaleX = node.scaleX();
    const scaleY = node.scaleY();
    node.scaleX(1);
    node.scaleY(1);
    onTransformEnd(element.id, {
      x: node.x(),
      y: node.y(),
      width: Math.max(5, node.width() * scaleX),
      height: Math.max(5, node.height() * scaleY),
      rotation: node.rotation(),
    });
  };

  // No resource or video not ready: render placeholder
  if (!resource || !videoReady || !videoRef.current) {
    return (
      <Rect
        ref={rectRef}
        {...commonProps}
        fill="#1f2937"
        stroke="#6b7280"
        strokeWidth={2}
        dash={[8, 4]}
        onTransformEnd={handleTransformEnd}
      />
    );
  }

  return (
    <Image
      ref={imgRef}
      {...commonProps}
      image={videoRef.current}
      onTransformEnd={handleTransformEnd}
      perfectDrawEnabled={false}
    />
  );
};
