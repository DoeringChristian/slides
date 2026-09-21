import React, { useState, useRef } from 'react';
import { Play, Pause, Repeat, VolumeX, Volume2 } from 'lucide-react';
import { useEditorStore } from '../../store/editorStore';
import { usePresentationStore } from '../../store/presentationStore';
import { useMultiSlideUpdate } from '../../store/selectors';
import { ResourcePicker } from './ResourcePicker';
import { PropertyList } from './PropertyList';
import { PanelHeader } from './PanelHeader';
import { IconButtonRow } from '../controls/IconButtonRow';
import { Property, RangeProperty, ReadoutProperty } from './Property';
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
  // Header-only crop row: the rect is edited on the canvas (crop mode), but
  // the header supplies the previously missing crop transition / sync /
  // keyframe buttons. Crop coords are in SOURCE-IMAGE pixels (a full image
  // is 0,0 originalWidth×originalHeight — see computeResourceUpdate and the
  // width/cropWidth scaling in RenderImage).
  new ReadoutProperty<ImageElement>({
    key: 'cropX', label: 'Crop',
    transitionGroup: 'crop',
    syncFields: ['cropX', 'cropY', 'cropWidth', 'cropHeight'],
    readout: (el) =>
      `${Math.round(el.cropX)},${Math.round(el.cropY)} ${Math.round(el.cropWidth)}×${Math.round(el.cropHeight)}px`,
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

      <PropertyList properties={IMAGE_PROPERTIES} element={element} />

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
          <IconButtonRow
            items={[
              {
                icon: (element.playing ?? true) ? <Pause size={12} /> : <Play size={12} />,
                label: (element.playing ?? true) ? 'Playing' : 'Paused',
                active: element.playing ?? true,
                title: (element.playing ?? true) ? 'Pause' : 'Play',
                onClick: () => update({ playing: !(element.playing ?? true) }),
              },
              {
                icon: <Repeat size={12} />,
                label: 'Loop',
                active: !!element.loop,
                title: element.loop ? 'Disable loop' : 'Enable loop',
                onClick: () => update({ loop: !element.loop }),
              },
              {
                icon: element.muted ? <VolumeX size={12} /> : <Volume2 size={12} />,
                active: !!element.muted,
                activeTone: 'orange',
                title: element.muted ? 'Unmute' : 'Mute',
                onClick: () => update({ muted: !element.muted }),
              },
            ]}
          />
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
