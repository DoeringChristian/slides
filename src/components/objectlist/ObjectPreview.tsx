import React from 'react';
import { Type, Square, Image, Film } from 'lucide-react';
import { usePresentationStore } from '../../store/presentationStore';
import { SVGTextPaths } from '../svg/SVGTextPaths';
import { RenderShape } from '../svg/ElementRenderer';
import { useVideoPoster } from '../svg/mediaSources';
import { useMediaSource } from '../../media/useMediaSource';
import type { SlideElement, ObjectMeta, TextElement, ShapeElement } from '../../types/presentation';

interface Props {
  element: SlideElement | undefined;
  objectType: ObjectMeta['type'];
}

const FALLBACK_ICONS: Record<string, React.FC<{ size: number; className?: string }>> = {
  text: Type,
  shape: Square,
  image: Image,
};

export const ObjectPreview: React.FC<Props> = ({ element, objectType }) => {
  const resources = usePresentationStore((s) => s.presentation.resources);

  const resource = element?.type === 'image' && element.resourceId
    ? resources[element.resourceId]
    : undefined;
  const isVideo = resource?.type === 'video';
  // The shared poster frame (cached per file) and image source.
  const videoThumb = useVideoPoster(isVideo ? resource?.hash : undefined) ?? null;
  const { url: imageUrl } = useMediaSource(!isVideo ? resource : undefined);

  if (!element) {
    const Icon = FALLBACK_ICONS[objectType] || Square;
    return (
      <div className="w-full h-full flex items-center justify-center bg-gray-50">
        <Icon size={24} className="text-gray-300" />
      </div>
    );
  }

  if (element.type === 'text') {
    // Render through the production SVG path renderer so markdown + LaTeX
    // appear formatted exactly the way the slide will show them. The svg
    // viewBox matches the element's slide-unit dimensions and the browser
    // auto-scales to the tile.
    const textElement = element as TextElement;
    if (!textElement.text || !textElement.text.trim()) {
      return (
        <div className="w-full h-full flex items-center justify-center bg-gray-50">
          <Type size={24} className="text-gray-300" />
        </div>
      );
    }
    const localElement: TextElement = { ...textElement, x: 0, y: 0, rotation: 0 };
    return (
      <div className="w-full h-full bg-gray-50 overflow-hidden">
        <svg
          width="100%"
          height="100%"
          viewBox={`0 0 ${textElement.width} ${textElement.height}`}
          preserveAspectRatio="xMidYMid meet"
        >
          <SVGTextPaths element={localElement} clipIdPrefix="object-preview-text-clip" />
        </svg>
      </div>
    );
  }

  if (element.type === 'shape') {
    // Same renderer as the canvas (`RenderShape`). We just zero the element's
    // (x, y, rotation) so the SVG viewBox can scale-to-fit the tile.
    const shapeElement = element as ShapeElement;
    const localElement: ShapeElement = { ...shapeElement, x: 0, y: 0, rotation: 0 };
    return (
      <div className="w-full h-full bg-gray-50 overflow-hidden">
        <svg
          width="100%"
          height="100%"
          viewBox={`0 0 ${shapeElement.width} ${shapeElement.height}`}
          preserveAspectRatio="xMidYMid meet"
        >
          <RenderShape element={localElement} />
        </svg>
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
          src={imageUrl}
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
