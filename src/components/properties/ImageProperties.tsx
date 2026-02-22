import React, { useState, useRef } from 'react';
import { Play, Pause, Repeat, VolumeX, Volume2 } from 'lucide-react';
import { useEditorStore } from '../../store/editorStore';
import { usePresentationStore } from '../../store/presentationStore';
import { ResourcePicker } from './ResourcePicker';
import { computeResourceUpdate } from '../../utils/imageUtils';
import type { ImageElement } from '../../types/presentation';

interface Props {
  element: ImageElement;
}

export const ImageProperties: React.FC<Props> = ({ element }) => {
  const activeSlideId = useEditorStore((s) => s.activeSlideId);
  const updateElement = usePresentationStore((s) => s.updateElement);
  const resources = usePresentationStore((s) => s.presentation.resources);
  const resource = element.resourceId ? resources[element.resourceId] : undefined;

  const [pickerOpen, setPickerOpen] = useState(false);
  const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  const isVideo = resource?.type === 'video';

  const handleOpenPicker = () => {
    if (buttonRef.current) {
      setAnchorRect(buttonRef.current.getBoundingClientRect());
    }
    setPickerOpen(true);
  };

  const handleSelectResource = (resourceId: string | null) => {
    // Get resources directly from store to avoid stale closure after addResource
    const currentResources = usePresentationStore.getState().presentation.resources;
    const newResource = resourceId ? currentResources[resourceId] : undefined;
    const updates = computeResourceUpdate(resourceId, newResource, element);
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
          {isVideo ? 'Video' : 'Original'}: {resource.originalWidth} x {resource.originalHeight}
          {isVideo && resource.duration && (
            <span className="ml-2">({Math.round(resource.duration)}s)</span>
          )}
        </div>
      )}

      {/* Video controls */}
      {isVideo && (
        <div className="space-y-2 pt-2 border-t border-gray-100">
          <label className="text-xs text-gray-500 block">Video Playback</label>
          <div className="flex gap-2">
            <button
              onClick={() => updateElement(activeSlideId, element.id, { playing: !(element.playing ?? true) })}
              className={`flex items-center gap-1 px-2 py-1 rounded text-xs border ${
                (element.playing ?? true)
                  ? 'bg-blue-50 border-blue-300 text-blue-700'
                  : 'border-gray-300 text-gray-600 hover:bg-gray-50'
              }`}
              title={element.playing ?? true ? 'Pause' : 'Play'}
            >
              {(element.playing ?? true) ? <Pause size={12} /> : <Play size={12} />}
              {(element.playing ?? true) ? 'Playing' : 'Paused'}
            </button>

            <button
              onClick={() => updateElement(activeSlideId, element.id, { loop: !element.loop })}
              className={`flex items-center gap-1 px-2 py-1 rounded text-xs border ${
                element.loop
                  ? 'bg-blue-50 border-blue-300 text-blue-700'
                  : 'border-gray-300 text-gray-600 hover:bg-gray-50'
              }`}
              title={element.loop ? 'Disable loop' : 'Enable loop'}
            >
              <Repeat size={12} />
              Loop
            </button>

            <button
              onClick={() => updateElement(activeSlideId, element.id, { muted: !element.muted })}
              className={`flex items-center gap-1 px-2 py-1 rounded text-xs border ${
                element.muted
                  ? 'bg-orange-50 border-orange-300 text-orange-700'
                  : 'border-gray-300 text-gray-600 hover:bg-gray-50'
              }`}
              title={element.muted ? 'Unmute' : 'Mute'}
            >
              {element.muted ? <VolumeX size={12} /> : <Volume2 size={12} />}
            </button>
          </div>
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
