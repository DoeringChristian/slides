import React, { useRef, useEffect, useState } from 'react';
import { Image, Rect } from 'react-konva';
import useImage from 'use-image';
import { usePresentationStore } from '../../store/presentationStore';
import type { ImageElement } from '../../types/presentation';
import type Konva from 'konva';

interface Props {
  element: ImageElement;
  isSelected: boolean;
  disableInteraction?: boolean;
  onSelect: (id: string, e: Konva.KonvaEventObject<MouseEvent>) => void;
  onDragEnd: (id: string, x: number, y: number) => void;
  onDragMove?: (id: string, x: number, y: number, node: Konva.Node) => void;
  onTransformEnd: (id: string, attrs: Record<string, number>) => void;
  onMouseEnter?: (id: string) => void;
  onMouseLeave?: (id: string) => void;
}

export const ImageNode: React.FC<Props> = ({ element, isSelected: _isSelected, disableInteraction, onSelect, onDragEnd, onDragMove, onTransformEnd, onMouseEnter, onMouseLeave }) => {
  const imgRef = useRef<Konva.Image>(null);
  const rectRef = useRef<Konva.Rect>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const animationRef = useRef<number | null>(null);
  const [videoReady, setVideoReady] = useState(false);

  const resource = usePresentationStore((s) =>
    element.resourceId ? s.presentation.resources[element.resourceId] : undefined
  );
  const [image] = useImage(resource?.type === 'image' ? (resource?.src || '') : '');

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
        // Autoplay might be blocked, mute and try again
        video.muted = true;
        video.play().catch(() => {});
      });
    } else {
      video.pause();
    }
  }, [isVideo, element.playing, element.visible, videoReady]);

  // Animation loop to update Konva image for video
  useEffect(() => {
    if (!isVideo || !videoReady || !videoRef.current) {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
        animationRef.current = null;
      }
      return;
    }

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
  }, [isVideo, videoReady]);

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
    onMouseEnter: () => onMouseEnter?.(element.id),
    onMouseLeave: () => onMouseLeave?.(element.id),
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

  // No resource: render placeholder
  if (!resource) {
    return (
      <Rect
        ref={rectRef}
        {...commonProps}
        fill="#f3f4f6"
        stroke="#9ca3af"
        strokeWidth={2}
        dash={[8, 4]}
        onTransformEnd={handleTransformEnd}
      />
    );
  }

  // Apply crop from element properties (only if valid crop values exist)
  const hasCrop = element.cropWidth > 0 && element.cropHeight > 0;
  const crop = hasCrop ? {
    x: element.cropX,
    y: element.cropY,
    width: element.cropWidth,
    height: element.cropHeight,
  } : undefined;

  // Video resource
  if (isVideo) {
    if (!videoReady || !videoRef.current) {
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
        crop={crop}
        onTransformEnd={handleTransformEnd}
        perfectDrawEnabled={false}
      />
    );
  }

  return (
    <Image
      ref={imgRef}
      {...commonProps}
      image={image}
      crop={crop}
      onTransformEnd={handleTransformEnd}
      perfectDrawEnabled={false}
    />
  );
};
