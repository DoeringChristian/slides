import React from 'react';
import { Type, Square, Image } from 'lucide-react';
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

export const ObjectPreview: React.FC<Props> = ({ element, objectType }) => {
  const resources = usePresentationStore((s) => s.presentation.resources);

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
    const resource = element.resourceId ? resources[element.resourceId] : undefined;

    // Show fallback icon if no resource
    if (!resource) {
      return (
        <div className="w-full h-full flex items-center justify-center bg-gray-50">
          <Image size={24} className="text-gray-300" />
        </div>
      );
    }

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
