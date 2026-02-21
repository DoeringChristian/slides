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
  isSelected: boolean;
}

export const ImagePlaceholderOverlay: React.FC<Props> = ({ element, zoom, isSelected }) => {
  const updateElement = usePresentationStore((s) => s.updateElement);
  const activeSlideId = useEditorStore((s) => s.activeSlideId);
  const resources = usePresentationStore((s) => s.presentation.resources);

  const [pickerOpen, setPickerOpen] = useState(false);
  const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  // Calculate position based on element position and zoom
  const left = (element.x + CANVAS_PADDING) * zoom;
  const top = (element.y + CANVAS_PADDING) * zoom;
  const width = element.width * zoom;
  const height = element.height * zoom;

  // Only show when selected
  if (!isSelected) return null;

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
        className="absolute"
        style={{
          left,
          top,
          width,
          height,
          transform: `rotate(${element.rotation}deg)`,
          transformOrigin: 'top left',
          pointerEvents: 'none',
        }}
      >
        {/* Floating button bar - positioned below element on the left */}
        <div
          className="absolute left-0 flex items-center"
          style={{
            pointerEvents: 'none',
            top: '100%',
            marginTop: 8,
          }}
        >
          <div
            className="flex items-center gap-1 bg-white/90 backdrop-blur-sm border border-gray-200 rounded-full shadow-md px-1.5 py-1"
            style={{ pointerEvents: 'auto' }}
          >
            <button
              ref={buttonRef}
              data-resource-trigger
              onClick={handleClick}
              className="p-1.5 rounded-full hover:bg-blue-100 text-gray-400 hover:text-blue-600 transition-colors"
              title="Change image"
            >
              <ImagePlus size={18} />
            </button>
          </div>
        </div>
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
