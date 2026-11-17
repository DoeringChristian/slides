import { SelectionPropertiesContext } from './SelectionPropertiesContext';
import { commitSelectionProperties } from '../../store/selectionPropertyMutation';
import React, { useState, useRef, useContext } from 'react';
import { Play, Pause, Repeat, VolumeX, Volume2 } from 'lucide-react';
import { useEditorStore } from '../../store/editorStore';
import { usePresentationStore } from '../../store/presentationStore';
import { useMultiSlideUpdate } from '../../store/selectors';
import { ResourcePicker } from './ResourcePicker';
import { PropertyList } from './PropertyList';
import { PanelHeader } from './PanelHeader';
import { CropRow } from './CropRow';
import { IconButtonRow } from '../controls/IconButtonRow';
import { Property, NumberProperty, ColorProperty, PreviewSelectProperty } from './Property';
import { RenderShape } from '../svg/ElementRenderer';
import { createShapeElement } from '../../utils/model/slideFactory';
import { noPaint, withPaintAlpha } from '../../utils/paint/paintColor';
import { computeResourceUpdate } from '../../utils/editor/imageUtils';
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

/** Picking a gradient tint starts it as a fade-out of the tint colour,
 *  written explicitly so its end colour has a value to edit. */
class TintStyleProperty extends PreviewSelectProperty<ImageElement, NonNullable<ImageElement['tintStyle']>> {
  protected override set(el: ImageElement, v: NonNullable<ImageElement['tintStyle']>): Partial<ImageElement> {
    return v !== 'solid' && el.tintTo === undefined
      ? { tintStyle: v, tintTo: withPaintAlpha(noPaint(el.tint ?? '') ? '#000000' : el.tint!, 0) } : { tintStyle: v };
  }
}

const IMAGE_PROPERTIES: Property<ImageElement>[] = [
  new NumberProperty<ImageElement>({
    key: 'opacity', label: 'Opacity',
    transitionGroup: 'opacity', min: 0, max: 100, scale: 100,
    step: 1, scrubStep: 0.5, precision: 1,
  }),
  new ResourceProperty(),
  // Tint: a solid or gradient fill over the picture, part of the image (a
  // crop clips it too). Animates with the fill group, like a shape's fill.
  new ColorProperty<ImageElement>({ key: 'tint', label: 'Tint', transitionGroup: 'fill', alpha: true }),
  // The same icon picker as a shape's Fill Style, previewing each tint.
  new TintStyleProperty({
    key: 'tintStyle', label: 'Tint Style', iconOnly: true, defaultValue: 'solid', columns: 3, transitionGroup: 'fill',
    options: (['solid', 'linear', 'radial'] as const).map(value => ({ value,
      label: value === 'solid' ? 'Solid' : value === 'linear' ? 'Linear gradient' : 'Radial gradient',
      preview: () => <svg width={44} height={30} viewBox="0 0 44 30" aria-hidden="true">
        <RenderShape element={createShapeElement('rect', { id: `tint-preview-${value}`, x: 2, y: 2, width: 40, height: 26,
          cornerRadius: 4, fill: '#555555', fillStyle: value, stroke: '#333333', strokeWidth: 1 })} />
      </svg>,
    })),
    visibleFor: el => !!el.tint || !!el.tintTo,
  }),
  new ColorProperty<ImageElement>({
    key: 'tintTo', label: 'Gradient To', transitionGroup: 'fill', alpha: true,
    visibleFor: el => el.tintStyle === 'linear' || el.tintStyle === 'radial',
  }),
];

interface Props {
  element: ImageElement;
}

export const ImageProperties: React.FC<Props> = ({ element }) => {
  const activeSlideId = useEditorStore((s) => s.activeSlideId);
  const updateElement = usePresentationStore((s) => s.updateElement);
  const ids = useContext(SelectionPropertiesContext);
  const singleUpdate = useMultiSlideUpdate(element.id);
  const update = (changes: Partial<ImageElement>) => {
    if (ids) commitSelectionProperties(activeSlideId, ids, members => members.filter(el => el.type === 'image').map(el => ({ elementId: el.id, changes })));
    else singleUpdate(changes);
  };
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
    if (ids) commitSelectionProperties(activeSlideId, ids, members => members.flatMap(el => el.type === 'image' ? [{ elementId: el.id, changes: computeResourceUpdate(resourceId, newResource, el) }] : []));
    else updateElement(activeSlideId, element.id, computeResourceUpdate(resourceId, newResource, element));
  };

  return (
    <div className="space-y-3">
      <PanelHeader
        label={isVideo ? 'Video' : 'Image'}
        elementId={element.id}
      />

      <PropertyList properties={IMAGE_PROPERTIES} element={element} />

      {!ids && <CropRow />}

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
