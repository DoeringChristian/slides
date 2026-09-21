import React from 'react';
import { Timer } from 'lucide-react';
import { useEditorStore } from '../../store/editorStore';
import { usePresentationStore } from '../../store/presentationStore';
import { ColorPicker } from '../toolbar/ColorPicker';
import { SlidePropertyRow } from './SlidePropertyRow';
import {
  Property,
  NumberProperty,
  CheckboxProperty,
  type PropertyContext,
} from './Property';
import type { Slide } from '../../types/presentation';

/**
 * Slide panel, palette-style: Property instances over `Slide` rendered
 * through SlidePropertyRow (label + editor, no element-only buttons). The
 * per-row `update` receives ordinary `Partial<Slide>` change sets and a
 * dispatch adapter routes each top-level key to the EXISTING dual-path
 * store actions — no new store mutation. Scrub live-preview routes through
 * the same actions via useScrubCommit (zundo's pause is store-wide, so the
 * single-undo protocol works for slide fields too).
 */

/** Background color. Custom class (not ColorProperty) because
 *  SlideBackground is a discriminated union: reading needs the solid-color
 *  fallback and writing must replace the whole background variant. */
class SlideBackgroundProperty extends Property<Slide> {
  readonly key = 'background';
  readonly label = 'Background';
  renderEditor({ element, update }: PropertyContext<Slide>) {
    const color = element.background.type === 'solid' ? element.background.color : '#ffffff';
    return (
      <ColorPicker
        color={color}
        label="Background Color"
        onChange={(c) => update({ background: { type: 'solid', color: c } })}
      />
    );
  }
}

const SLIDE_PROPERTIES: Property<Slide>[] = [
  new SlideBackgroundProperty(),
  new NumberProperty<Slide>({
    key: 'transition.duration', label: 'Animation Duration',
    min: 100, max: 2000, step: 10, precision: 0, unit: 'ms',
  }),
];

// --- Auto-advance section --------------------------------------------------
// NOTE: a later workstream (slide groups, WS-4) replaces this UI with
// group-based timed chains — kept as a separate property list + block below
// so it can be swapped out wholesale.

const AUTO_ADVANCE_PROPERTIES: Property<Slide>[] = [
  new CheckboxProperty<Slide>({
    key: 'autoAdvance', label: 'Automatically advance to next slide',
  }),
  new NumberProperty<Slide>({
    key: 'autoAdvanceDelay', label: 'Delay',
    min: 0, max: 300, step: 0.1, unit: 's', defaultValue: 0,
    visibleFor: (s) => !!s.autoAdvance,
  }),
];

interface Props {
  slide: Slide;
}

export const SlideProperties: React.FC<Props> = ({ slide }) => {
  const activeSlideId = useEditorStore((s) => s.activeSlideId);
  const updateSlideBackground = usePresentationStore((s) => s.updateSlideBackground);
  const updateSlideTransition = usePresentationStore((s) => s.updateSlideTransition);
  const updateSlideAutoAdvance = usePresentationStore((s) => s.updateSlideAutoAdvance);

  // Dispatch adapter: Partial<Slide> → the existing dual-path actions.
  // Nested partials arrive with their siblings spread (setNestedPartial),
  // so `transition` / `background` are always complete objects here.
  const update = (changes: Partial<Slide>) => {
    if (changes.background !== undefined) {
      updateSlideBackground(activeSlideId, changes.background);
    }
    if (changes.transition !== undefined) {
      updateSlideTransition(activeSlideId, changes.transition);
    }
    if ('autoAdvance' in changes || 'autoAdvanceDelay' in changes) {
      updateSlideAutoAdvance(
        activeSlideId,
        changes.autoAdvance ?? slide.autoAdvance ?? false,
        changes.autoAdvanceDelay,
      );
    }
  };

  return (
    <div className="space-y-3">
      {SLIDE_PROPERTIES.map((p) => (
        <SlidePropertyRow key={p.key} property={p} element={slide} update={update} />
      ))}
      <div className="border-t border-gray-200 pt-3 space-y-3">
        <div className="flex items-center gap-2">
          <Timer size={14} className="text-gray-500" />
          <span className="text-xs text-gray-500">Auto-Advance</span>
        </div>
        {AUTO_ADVANCE_PROPERTIES.map((p) => (
          <SlidePropertyRow key={p.key} property={p} element={slide} update={update} />
        ))}
      </div>
    </div>
  );
};
