import React, { useState, useRef } from 'react';
import { useEditorStore } from '../../store/editorStore';
import { usePresentationStore } from '../../store/presentationStore';
import { ResourcePicker } from './ResourcePicker';
import type { ImageElement } from '../../types/presentation';

interface Props {
  element: ImageElement;
}

export const ImageProperties: React.FC<Props> = ({ element }) => {
  const activeSlideId = useEditorStore((s) => s.activeSlideId);
  const updateElement = usePresentationStore((s) => s.updateElement);
  const resource = usePresentationStore((s) =>
    element.resourceId ? s.presentation.resources[element.resourceId] : undefined
  );

  const [pickerOpen, setPickerOpen] = useState(false);
  const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  const handleOpenPicker = () => {
    if (buttonRef.current) {
      setAnchorRect(buttonRef.current.getBoundingClientRect());
    }
    setPickerOpen(true);
  };

  const handleSelectResource = (resourceId: string | null) => {
    // Get the new resource for resetting crop
    const resources = usePresentationStore.getState().presentation.resources;
    const newResource = resourceId ? resources[resourceId] : undefined;

    const updates: Partial<ImageElement> = { resourceId };

    // Reset crop to full resource dimensions when changing resource
    if (newResource) {
      updates.cropX = 0;
      updates.cropY = 0;
      updates.cropWidth = newResource.originalWidth;
      updates.cropHeight = newResource.originalHeight;
    }

    updateElement(activeSlideId, element.id, updates);
  };

  return (
    <div className="space-y-3">
      <div>
        <label className="text-xs text-gray-500 block mb-1">Opacity</label>
        <input
          type="range"
          value={element.opacity * 100}
          onChange={(e) => updateElement(activeSlideId, element.id, { opacity: Number(e.target.value) / 100 })}
          min={0} max={100}
          className="w-full accent-blue-500"
        />
      </div>
      {resource && (
        <div className="text-xs text-gray-400">
          Original: {resource.originalWidth} x {resource.originalHeight}
        </div>
      )}
      <button
        ref={buttonRef}
        data-resource-trigger
        onClick={handleOpenPicker}
        className="w-full h-8 text-sm border border-gray-300 rounded hover:bg-gray-50"
      >
        {resource ? 'Change Resource' : 'Pick Resource'}
      </button>
      <ResourcePicker
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        currentResourceId={element.resourceId}
        onSelect={handleSelectResource}
        anchorRect={anchorRect}
      />
    </div>
  );
};
