import React, { useEffect, useState } from 'react';
import { Type, Square, Image, Film } from 'lucide-react';
import { usePresentationStore } from '../../store/presentationStore';
import type { SlideElement, ObjectMeta } from '../../types/presentation';

interface Props {
  element: SlideElement | undefined;
  objectType: ObjectMeta['type'];
}

const FALLBACK_ICONS: Record<string, React.FC<{ size: number; className?: string }>> = {
  text: Type,
  shape: Square,
  image: Image,
};

const SHAPE_CLIP_PATHS: Record<string, string> = {
  triangle: 'polygon(50% 0%, 0% 100%, 100% 100%)',
  star: 'polygon(50% 0%, 61% 35%, 98% 35%, 68% 57%, 79% 91%, 50% 70%, 21% 91%, 32% 57%, 2% 35%, 39% 35%)',
};

// Cache for video first frames
const videoFrameCache: Record<string, string> = {};

export const ObjectPreview: React.FC<Props> = ({ element, objectType }) => {
  const resources = usePresentationStore((s) => s.presentation.resources);
  const [videoThumb, setVideoThumb] = useState<string | null>(null);

  // Handle video thumbnail extraction
  const resource = element?.type === 'image' && element.resourceId
    ? resources[element.resourceId]
    : undefined;
  const isVideo = resource?.type === 'video';

  useEffect(() => {
    if (!isVideo || !resource) {
      setVideoThumb(null);
      return;
    }

    // Check cache first
    if (videoFrameCache[resource.id]) {
      setVideoThumb(videoFrameCache[resource.id]);
      return;
    }

    // Extract first frame
    const video = document.createElement('video');
    video.src = resource.src;
    video.muted = true;
    video.preload = 'metadata';

    video.onloadeddata = () => {
      video.currentTime = 0;
    };

    video.onseeked = () => {
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(video, 0, 0);
        const dataUrl = canvas.toDataURL('image/png');
        videoFrameCache[resource.id] = dataUrl;
        setVideoThumb(dataUrl);
      }
      video.src = '';
    };

    return () => {
      video.src = '';
    };
  }, [isVideo, resource?.id, resource?.src]);

  if (!element) {
    const Icon = FALLBACK_ICONS[objectType] || Square;
    return (
      <div className="w-full h-full flex items-center justify-center bg-gray-50">
        <Icon size={24} className="text-gray-300" />
      </div>
    );
  }

  if (element.type === 'text') {
    return (
      <div
        className="w-full h-full flex items-center justify-center p-1 overflow-hidden bg-gray-50"
        style={{
          fontFamily: element.style.fontFamily,
          color: element.style.color,
          fontSize: Math.min(element.style.fontSize * 0.3, 14),
          fontWeight: element.style.fontWeight,
          fontStyle: element.style.fontStyle,
          textAlign: element.style.align,
          lineHeight: 1.2,
        }}
      >
        <span className="line-clamp-3 break-words w-full text-center">
          {element.text || 'Text'}
        </span>
      </div>
    );
  }

  if (element.type === 'shape') {
    const { shapeType, fill, stroke, strokeWidth } = element;

    if (shapeType === 'line' || shapeType === 'arrow') {
      return (
        <div className="w-full h-full flex items-center justify-center bg-gray-50 p-2">
          <div
            className="w-full"
            style={{
              height: Math.max(strokeWidth, 2),
              backgroundColor: stroke || fill || '#666',
            }}
          />
        </div>
      );
    }

    const clipPath = SHAPE_CLIP_PATHS[shapeType];
    const borderRadius = shapeType === 'ellipse' ? '50%' : (shapeType === 'rect' ? element.cornerRadius : 0);

    return (
      <div className="w-full h-full flex items-center justify-center bg-gray-50 p-2">
        <div
          className="w-3/4 aspect-square"
          style={{
            backgroundColor: fill || '#ccc',
            border: strokeWidth > 0 ? `${Math.max(strokeWidth * 0.3, 1)}px solid ${stroke}` : undefined,
            borderRadius: clipPath ? undefined : borderRadius,
            clipPath: clipPath || undefined,
          }}
        />
      </div>
    );
  }

  if (element.type === 'image') {
    // Show fallback icon if no resource
    if (!resource) {
      return (
        <div className="w-full h-full flex items-center justify-center bg-gray-50">
          <Image size={24} className="text-gray-300" />
        </div>
      );
    }

    // Handle video resource
    if (isVideo) {
      const thumbSrc = videoThumb;
      return (
        <div className="w-full h-full bg-gray-900 relative">
          {thumbSrc ? (
            <img
              src={thumbSrc}
              className="w-full h-full object-cover"
              draggable={false}
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center">
              <Film size={24} className="text-gray-500" />
            </div>
          )}
          <div className="absolute bottom-0 left-0 right-0 bg-black/60 text-white text-[8px] text-center py-0.5">
            VIDEO
          </div>
        </div>
      );
    }

    // Handle image resource
    return (
      <div className="w-full h-full bg-gray-50">
        <img
          src={resource.src}
          className="w-full h-full object-cover"
          draggable={false}
        />
      </div>
    );
  }

  // Fallback for group or unknown types
  const Icon = FALLBACK_ICONS[objectType] || Square;
  return (
    <div className="w-full h-full flex items-center justify-center bg-gray-50">
      <Icon size={24} className="text-gray-300" />
    </div>
  );
};
