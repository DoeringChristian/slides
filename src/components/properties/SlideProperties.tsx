import React from 'react';
import { Link2, Ungroup } from 'lucide-react';
import { useEditorStore } from '../../store/editorStore';
import { usePresentationStore } from '../../store/presentationStore';
import { useGroupRuns } from '../../store/selectors';
import { findRunAt } from '../../utils/presenterAdvance';
import { ColorPicker } from '../toolbar/ColorPicker';
import { SlidePropertyRow } from './SlidePropertyRow';
import {
  Property,
  NumberProperty,
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

// --- Slide-group (timed chain) section --------------------------------------
// Replaces the old per-slide auto-advance UI: grouping slides in the slide
// panel makes them auto-play as a chain; this section shows the slide's
// position in its group and the per-slide hold before the chain advances.

const HOLD_PROPERTY = new NumberProperty<Slide>({
  key: 'autoAdvanceDelay', label: 'Hold before next',
  min: 0, max: 300, step: 0.1, unit: 's', defaultValue: 0,
});

interface Props {
  slide: Slide;
}

export const SlideProperties: React.FC<Props> = ({ slide }) => {
  const activeSlideId = useEditorStore((s) => s.activeSlideId);
  const updateSlideBackground = usePresentationStore((s) => s.updateSlideBackground);
  const updateSlideTransition = usePresentationStore((s) => s.updateSlideTransition);
  const updateSlideAutoAdvanceDelay = usePresentationStore((s) => s.updateSlideAutoAdvanceDelay);
  const ungroupSlides = usePresentationStore((s) => s.ungroupSlides);
  const slideOrder = usePresentationStore((s) => s.presentation.slideOrder);

  const runs = useGroupRuns();
  const slideIndex = slideOrder.indexOf(slide.id);
  const run = findRunAt(runs, slideIndex);
  const posInRun = run ? slideIndex - run.start + 1 : 0;
  const isLastInRun = run ? slideIndex === run.start + run.slideIds.length - 1 : false;

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
    if (changes.autoAdvanceDelay !== undefined) {
      updateSlideAutoAdvanceDelay(activeSlideId, changes.autoAdvanceDelay);
    }
  };

  return (
    <div className="space-y-3">
      {SLIDE_PROPERTIES.map((p) => (
        <SlidePropertyRow key={p.key} property={p} element={slide} update={update} />
      ))}
      <div className="border-t border-gray-200 pt-3 space-y-3">
        <div className="flex items-center gap-2">
          <Link2 size={14} className="text-gray-500" />
          <span className="text-xs text-gray-500">Slide Group</span>
        </div>
        {run ? (
          <>
            <div className="text-xs text-gray-600">
              Group (slide {posInRun} of {run.slideIds.length})
            </div>
            {/* The run's last slide has no next group member to hold before. */}
            {!isLastInRun && (
              <SlidePropertyRow property={HOLD_PROPERTY} element={slide} update={update} />
            )}
            {/* Legacy shim runs (collab docs still on autoAdvance flags) have
                no groupId on the slide — nothing to ungroup. */}
            {slide.groupId && (
              <button
                onClick={() => ungroupSlides([slide.id])}
                className="flex items-center gap-1.5 px-2 py-1 rounded border border-gray-200 text-xs text-gray-600 hover:bg-gray-50"
              >
                <Ungroup size={12} />
                Ungroup
              </button>
            )}
          </>
        ) : (
          <p className="text-xs text-gray-400">
            Select multiple slides and press Group to auto-play them.
          </p>
        )}
      </div>
    </div>
  );
};
