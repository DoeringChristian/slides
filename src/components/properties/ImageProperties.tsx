import React, { useState, useRef } from 'react';
import { Play, Pause, Repeat, VolumeX, Volume2 } from 'lucide-react';
import { useEditorStore } from '../../store/editorStore';
import { usePresentationStore } from '../../store/presentationStore';
import { useMultiSlideUpdate } from '../../store/selectors';
import { ResourcePicker } from './ResourcePicker';
import { PropertyRow } from './PropertyRow';
import { PanelHeader } from './PanelHeader';
import { Property, RangeProperty } from './Property';
import { computeResourceUpdate } from '../../utils/imageUtils';
import type { ImageElement } from '../../types/presentation';

/**
 * Property for the image/video resource. Custom subclass because copying a
 * resource between slides isn't a verbatim field copy — `computeResourceUpdate`
 * also reshapes the bounding box for the new resource's aspect ratio. The
 * editor body is null; the actual picker button lives outside the row.
 *
 * The `resource` transition (content-change: dissolve / fadeinout) has been
 * hoisted next to the IMAGE / VIDEO type label — see the header block below —
 * so `transitionGroup` is intentionally omitted here.
 */
class ResourceProperty extends Property<ImageElement> {
  readonly key = 'resourceId';
  readonly label = 'Resource';
  override get syncFields(): string[] { return ['resourceId']; }
  override copyFromKeyframe(target: ImageElement, current: ImageElement): Partial<ImageElement> {
    const resources = usePresentationStore.getState().presentation.resources;
    const targetResource = target.resourceId ? resources[target.resourceId] : undefined;
    return computeResourceUpdate(target.resourceId ?? null, targetResource, current);
  }
  renderEditor() { return null; }
}

const IMAGE_PROPERTIES: Property<ImageElement>[] = [
  new RangeProperty<ImageElement>({
    key: 'opacity', label: 'Opacity',
    transitionGroup: 'opacity', min: 0, max: 100, scale: 100,
  }),
  new ResourceProperty(),
];

interface Props {
  element: ImageElement;
}

export const ImageProperties: React.FC<Props> = ({ element }) => {
  const activeSlideId = useEditorStore((s) => s.activeSlideId);
  const updateElement = usePresentationStore((s) => s.updateElement);
  const update = useMultiSlideUpdate(element.id);
  const resources = usePresentationStore((s) => s.presentation.resources);
  const resource = element.resourceId ? resources[element.resourceId] : undefined;

  const [pickerOpen, setPickerOpen] = useState(false);
  const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  const isVideo = resource?.type === 'video';

  const handleOpenPicker = () => {
    if (buttonRef.current) setAnchorRect(buttonRef.current.getBoundingClientRect());
    setPickerOpen(true);
  };

  const handleSelectResource = (resourceId: string | null) => {
    // Read fresh — addResource may have just landed.
    const currentResources = usePresentationStore.getState().presentation.resources;
    const newResource = resourceId ? currentResources[resourceId] : undefined;
    updateElement(activeSlideId, element.id, computeResourceUpdate(resourceId, newResource, element));
  };

  return (
    <div className="space-y-3">
      <PanelHeader
        label={isVideo ? 'Video' : 'Image'}
        elementId={element.id}
        groups={['visibility', 'resource']}
      />

      {IMAGE_PROPERTIES.map((p) => (
        <PropertyRow key={p.key} property={p} element={element} />
      ))}

      {resource && (
        <div className="text-xs text-gray-400">
          {isVideo ? 'Video' : 'Original'}: {resource.originalWidth} x {resource.originalHeight}
          {isVideo && resource.duration && (
            <span className="ml-2">({Math.round(resource.duration)}s)</span>
          )}
        </div>
      )}

      {/* Video playback toggles — verbs, not animatable values, so kept
          outside the PropertyRow flow. */}
      {isVideo && (
        <div className="space-y-2 pt-2 border-t border-gray-100">
          <label className="text-xs text-gray-500 block">Video Playback</label>
          <div className="flex gap-2">
            <button
              onClick={() => update({ playing: !(element.playing ?? true) })}
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
              onClick={() => update({ loop: !element.loop })}
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
              onClick={() => update({ muted: !element.muted })}
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
