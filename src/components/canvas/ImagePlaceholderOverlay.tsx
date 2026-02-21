import React, { useState, useRef } from 'react';
import { ImagePlus } from 'lucide-react';
import { usePresentationStore } from '../../store/presentationStore';
import { useEditorStore } from '../../store/editorStore';
import { ResourcePicker } from '../properties/ResourcePicker';
import { CANVAS_PADDING } from '../../utils/constants';
import type { ImageElement } from '../../types/presentation';

interface Props {
  element: ImageElement;
  zoom: number;
  containerRef: React.RefObject<HTMLDivElement>;
}

export const ImagePlaceholderOverlay: React.FC<Props> = ({ element, zoom, containerRef }) => {
  const updateElement = usePresentationStore((s) => s.updateElement);
  const activeSlideId = useEditorStore((s) => s.activeSlideId);
  const resources = usePresentationStore((s) => s.presentation.resources);

  const [pickerOpen, setPickerOpen] = useState(false);
  const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  // Check if element has a resource
  const hasResource = element.resourceId && resources[element.resourceId];
  if (hasResource) return null;

  // Calculate position based on element position and zoom
  const left = (element.x + CANVAS_PADDING) * zoom;
  const top = (element.y + CANVAS_PADDING) * zoom;
  const width = element.width * zoom;
  const height = element.height * zoom;

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (buttonRef.current) {
      setAnchorRect(buttonRef.current.getBoundingClientRect());
    }
    setPickerOpen(true);
  };

  const handleSelectResource = (resourceId: string | null) => {
    const newResource = resourceId ? resources[resourceId] : undefined;
    const updates: Partial<ImageElement> = { resourceId };

    if (newResource) {
      updates.cropX = 0;
      updates.cropY = 0;
      updates.cropWidth = newResource.originalWidth;
      updates.cropHeight = newResource.originalHeight;
    }

    updateElement(activeSlideId, element.id, updates);
  };

  return (
    <>
      <div
        className="absolute flex items-center justify-center pointer-events-none"
        style={{
          left,
          top,
          width,
          height,
          transform: `rotate(${element.rotation}deg)`,
          transformOrigin: 'top left',
        }}
      >
        <button
          ref={buttonRef}
          data-resource-trigger
          onClick={handleClick}
          className="pointer-events-auto flex items-center gap-1.5 px-3 py-1.5 bg-white border border-gray-300 rounded-md shadow-sm text-sm text-gray-600 hover:bg-gray-50 hover:border-gray-400 transition-colors"
        >
          <ImagePlus size={16} />
          <span>Add Image</span>
        </button>
      </div>
      <ResourcePicker
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        currentResourceId={element.resourceId}
        onSelect={handleSelectResource}
        anchorRect={anchorRect}
      />
    </>
  );
};
