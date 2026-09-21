import { ScrubInput } from '../controls/ScrubInput';
import { ScrubPair } from '../controls/ScrubPair';
import { SliderWithReadout } from '../controls/SliderWithReadout';
import { useScrubCommit } from '../controls/useScrubCommit';
import { getNested, setNestedPartial } from './Property';
import type { ScrubSpec } from '../../utils/scrub';
import type { SlideElement } from '../../types/presentation';

/**
 * Scrub-capable editor bodies for the Property classes.
 *
 * `Property.renderEditor` is a plain class method, so it can't call hooks
 * itself. The scrub-capable editors therefore return these small function
 * components, which PropertyRow mounts as ordinary children — making
 * `useScrubCommit` (a per-row hook) legal. Each maps the control's
 * live-preview protocol onto one shared session:
 *   onScrubStart → begin, onPreview → preview, onCommit → end,
 *   onScrubCancel → cancel.
 * Discrete edits (typed values, arrow keys) still land in `end`, which
 * degrades to a plain update when no scrub is in flight — those stay
 * individual undo entries by design.
 *
 * (They live in their own file, not Property.tsx, so react-refresh sees a
 * components-only module.)
 */

interface ScrubEditorBaseProps<E extends SlideElement> {
  element: E;
  update: (changes: Partial<E>) => void;
  syncFields: string[];
}

export function NumberEditor<E extends SlideElement>({
  element, update, syncFields, value, changesFor, spec, unit, disabled,
}: ScrubEditorBaseProps<E> & {
  value: number;
  changesFor: (el: E, v: number) => Partial<E>;
  spec: ScrubSpec;
  unit?: string;
  disabled?: boolean;
}) {
  const scrub = useScrubCommit({ element, update, syncFields });
  return (
    <ScrubInput
      value={value}
      spec={spec}
      unit={unit}
      disabled={disabled}
      onScrubStart={scrub.begin}
      onPreview={(v) => scrub.preview(changesFor(element, v))}
      onCommit={(v) => scrub.end(changesFor(element, v))}
      onScrubCancel={scrub.cancel}
    />
  );
}

export function PairEditor<E extends SlideElement>({
  element, update, syncFields, keys, labels, spec, disabled,
}: ScrubEditorBaseProps<E> & {
  keys: [string, string];
  labels: [string, string];
  spec: ScrubSpec;
  disabled?: boolean;
}) {
  // One session covers both axes (they share syncFields, so the snapshot
  // restores both); only one axis scrubs at a time.
  const scrub = useScrubCommit({ element, update, syncFields });
  const changesFor = (i: 0 | 1, v: number) => setNestedPartial(element, keys[i], v);
  return (
    <ScrubPair
      values={[
        getNested(element, keys[0]) as number,
        getNested(element, keys[1]) as number,
      ]}
      labels={labels}
      specs={[spec, spec]}
      onScrubStart={() => scrub.begin()}
      onPreview={(i, v) => scrub.preview(changesFor(i, v))}
      onCommit={(i, v) => scrub.end(changesFor(i, v))}
      onScrubCancel={() => scrub.cancel()}
      compact
      disabled={disabled}
    />
  );
}

export function RangeEditor<E extends SlideElement>({
  element, update, syncFields, value, changesFor, min, max, scale, disabled,
}: ScrubEditorBaseProps<E> & {
  value: number;
  changesFor: (el: E, v: number) => Partial<E>;
  min: number;
  max: number;
  scale?: number;
  disabled?: boolean;
}) {
  const scrub = useScrubCommit({ element, update, syncFields });
  return (
    <SliderWithReadout
      value={value}
      min={min}
      max={max}
      scale={scale}
      disabled={disabled}
      onScrubStart={scrub.begin}
      onPreview={(v) => scrub.preview(changesFor(element, v))}
      onCommit={(v) => scrub.end(changesFor(element, v))}
      onScrubCancel={scrub.cancel}
    />
  );
}
