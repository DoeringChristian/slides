import { ColorPicker } from '../toolbar/ColorPicker';
import { withPaintAlpha, withPaintRgb } from '../../utils/paintColor';
import type { CurrentChange } from '../../store/currentMutation';
import { ScrubInput } from '../controls/ScrubInput';
import { ScrubPair } from '../controls/ScrubPair';
import { SliderWithReadout } from '../controls/SliderWithReadout';
import { useScrubCommit } from '../controls/useScrubCommit';
import { getNested, setNestedPartial } from './Property';
import type { ScrubSpec } from '../../utils/scrub';

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
 * Discrete edits (typed values, arrow keys) use `commitDiscrete`. Changes
 * are lazy callbacks: the row resolves their current element only after
 * cancelling another scrub, or inside this gesture's owned write scope.
 *
 * (They live in their own file, not Property.tsx, so react-refresh sees a
 * components-only module.)
 */

interface ScrubEditorBaseProps<T extends object> {
  element: T;
  update: (changes: CurrentChange<T>) => void;
  syncFields: string[];
}

export function ColorEditor<T extends object>({ element, update, syncFields, field, label, allowTransparent }: ScrubEditorBaseProps<T> & {
  field: string; label: string; allowTransparent?: boolean;
}) {
  const scrub = useScrubCommit({ element, update, syncFields });
  const alpha = (v: number): CurrentChange<T> => current => setNestedPartial(current, field, withPaintAlpha(getNested(current, field) as string, v / 100));
  return <ColorPicker color={getNested(element, field) as string} label={label} allowTransparent={allowTransparent} palette={field === 'fill' ? 'fill' : 'stroke'}
    onChange={v => scrub.commitDiscrete(current => setNestedPartial(current, field, v))}
    onRgbChange={v => scrub.commitDiscrete(current => setNestedPartial(current, field, withPaintRgb(getNested(current, field) as string, v)))}
    alphaControl={{ onScrubStart: scrub.begin, onPreview: v => scrub.preview(alpha(v)),
      onCommit: v => scrub.end(alpha(v)), onEditCommit: v => scrub.commitDiscrete(alpha(v)), onScrubCancel: scrub.cancel }} />;
}

export function NumberEditor<T extends object>({
  element, update, syncFields, value, changesFor, spec, unit, disabled,
}: ScrubEditorBaseProps<T> & {
  value: number;
  changesFor: (el: T, v: number) => Partial<T>;
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
      onPreview={(v) => scrub.preview(current => changesFor(current, v))}
      onCommit={(v) => scrub.end(current => changesFor(current, v))}
      onEditCommit={(v) => scrub.commitDiscrete(current => changesFor(current, v))}
      onScrubCancel={scrub.cancel}
    />
  );
}

export function PairEditor<T extends object>({
  element, update, syncFields, keys, labels, spec, disabled,
}: ScrubEditorBaseProps<T> & {
  keys: [string, string];
  labels: [string, string];
  spec: ScrubSpec;
  disabled?: boolean;
}) {
  // One session covers both axes (they share syncFields, so the snapshot
  // restores both); only one axis scrubs at a time.
  const scrub = useScrubCommit({ element, update, syncFields });
  const changesFor = (current: T, i: 0 | 1, v: number) => setNestedPartial(current, keys[i], v);
  return (
    <ScrubPair
      values={[
        getNested(element, keys[0]) as number,
        getNested(element, keys[1]) as number,
      ]}
      labels={labels}
      specs={[spec, spec]}
      onScrubStart={() => scrub.begin()}
      onPreview={(i, v) => scrub.preview(current => changesFor(current, i, v))}
      onCommit={(i, v) => scrub.end(current => changesFor(current, i, v))}
      onEditCommit={(i, v) => scrub.commitDiscrete(current => changesFor(current, i, v))}
      onScrubCancel={() => scrub.cancel()}
      compact
      disabled={disabled}
    />
  );
}

export function RangeEditor<T extends object>({
  element, update, syncFields, value, changesFor, min, max, scale, disabled,
}: ScrubEditorBaseProps<T> & {
  value: number;
  changesFor: (el: T, v: number) => Partial<T>;
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
      onPreview={(v) => scrub.preview(current => changesFor(current, v))}
      onCommit={(v) => scrub.end(current => changesFor(current, v))}
      onEditCommit={(v) => scrub.commitDiscrete(current => changesFor(current, v))}
      onScrubCancel={scrub.cancel}
    />
  );
}
