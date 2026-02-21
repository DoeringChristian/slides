import React, { useState, useRef } from 'react';
import { ImagePlus, Lock, Unlock, Crop } from 'lucide-react';
import { usePresentationStore } from '../../store/presentationStore';
import { useEditorStore } from '../../store/editorStore';
import { ResourcePicker } from '../properties/ResourcePicker';
import { CANVAS_PADDING } from '../../utils/constants';
import type { SlideElement, ImageElement } from '../../types/presentation';

interface Props {
  element: SlideElement;
  zoom: number;
  isSelected: boolean;
}

export const SelectionActionBar: React.FC<Props> = ({ element, zoom, isSelected }) => {
  const updateElement = usePresentationStore((s) => s.updateElement);
  const activeSlideId = useEditorStore((s) => s.activeSlideId);
  const setCroppingElementId = useEditorStore((s) => s.setCroppingElementId);
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

  const isImage = element.type === 'image';

  const handleResourceClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (buttonRef.current) {
      setAnchorRect(buttonRef.current.getBoundingClientRect());
    }
    setPickerOpen(true);
  };

  const handleLockToggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    updateElement(activeSlideId, element.id, { locked: !element.locked });
  };

  const handleCropClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    setCroppingElementId(element.id);
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
            {/* Lock/Unlock button - shown for all elements */}
            <button
              onClick={handleLockToggle}
              className={`p-1.5 rounded-full transition-colors ${
                element.locked
                  ? 'bg-amber-100 text-amber-600 hover:bg-amber-200'
                  : 'text-gray-400 hover:bg-gray-100 hover:text-gray-600'
              }`}
              title={element.locked ? 'Unlock' : 'Lock'}
            >
              {element.locked ? <Lock size={18} /> : <Unlock size={18} />}
            </button>

            {/* Crop button - only for images */}
            {isImage && (
              <button
                onClick={handleCropClick}
                className="p-1.5 rounded-full hover:bg-green-100 text-gray-400 hover:text-green-600 transition-colors"
                title="Crop"
              >
                <Crop size={18} />
              </button>
            )}

            {/* Resource picker button - only for images */}
            {isImage && (
              <button
                ref={buttonRef}
                data-resource-trigger
                onClick={handleResourceClick}
                className="p-1.5 rounded-full hover:bg-blue-100 text-gray-400 hover:text-blue-600 transition-colors"
                title="Change image"
              >
                <ImagePlus size={18} />
              </button>
            )}
          </div>
        </div>
      </div>
      {isImage && (
        <ResourcePicker
          open={pickerOpen}
          onClose={() => setPickerOpen(false)}
          currentResourceId={(element as ImageElement).resourceId}
          onSelect={handleSelectResource}
          anchorRect={anchorRect}
        />
      )}
    </>
  );
};
