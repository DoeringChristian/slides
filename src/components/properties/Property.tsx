import React from 'react';
import { ColorPicker } from '../toolbar/ColorPicker';
import { Toggle } from '../controls/Toggle';
import { SelectControl } from '../controls/SelectControl';
import { PreviewSelect } from '../controls/PreviewSelect';
// Scrub-capable editor bodies (NumberEditor/PairEditor/RangeEditor) live in
// their own components-only module: renderEditor is a class method and
// can't call hooks, so the scrubbing classes return these components and
// PropertyRow mounts them as ordinary children (where useScrubCommit is
// legal). The import cycle scrubEditors ⇄ Property is benign: both sides
// only touch each other's bindings at call time.
import { NumberEditor, PairEditor, RangeEditor } from './scrubEditors';
import type { ScrubSpec } from '../../utils/scrub';
import type { SlideElement, TransitionGroup } from '../../types/presentation';

/**
 * Property-panel abstraction.
 *
 * Each editable / animatable thing on an element is a single Property
 * instance that owns:
 *   - the field(s) it edits (dot-notation paths, so `style.fontSize` works),
 *   - the animation hook-up (`transitionGroup`),
 *   - visibility (e.g. cornerRadius only on rects),
 *   - the editor widget itself.
 *
 * `PropertyRow` renders the uniform header — label, SlideSync, Transition
 * in/out, KeyframeButtons — driven entirely from this metadata, so a panel
 * is just a list of Property instances.
 *
 * The classes are generic over ANY plain object `T` (default: SlideElement),
 * so the same editors serve non-element panels too — SlideProperties reuses
 * them over `Slide` via SlidePropertyRow (label + editor only). The
 * element/keyframe metadata (`transitionGroup`, `differsFromKeyframe`,
 * `copyFromKeyframe`, …) is only consulted by the element-scoped
 * PropertyRow / KeyframeButtons / SlideSyncButton, which remain typed over
 * `E extends SlideElement`.
 *
 * The defaults on `BaseProperty` cover ~every existing property: a single
 * top-level field or nested path. For multi-field rows (Position, Size,
 * Control points → x/y/w/h/points) override `syncFields` to list all the
 * paths that should be diffed and copied together.
 */

// ---------------------------------------------------------------------------
// Dot-notation field accessors
// ---------------------------------------------------------------------------

export function getNested(obj: unknown, path: string): unknown {
  let cur: unknown = obj;
  for (const p of path.split('.')) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[p];
  }
  return cur;
}

/** Returns a `Partial<T>` that, when shallow-merged onto `el`, sets the
 *  value at `path`. For nested paths the intermediate objects are spread
 *  from the live element so sibling fields aren't lost. */
export function setNestedPartial<T>(el: T, path: string, value: unknown): Partial<T> {
  const parts = path.split('.');
  if (parts.length === 1) {
    return { [parts[0]]: value } as Partial<T>;
  }
  const root: Record<string, unknown> = {};
  let target = root;
  for (let i = 0; i < parts.length - 1; i++) {
    const existing = (parts.slice(0, i + 1).reduce<unknown>(
      (acc, p) => (acc == null ? undefined : (acc as Record<string, unknown>)[p]),
      el,
    ) as Record<string, unknown> | undefined) ?? {};
    target[parts[i]] = { ...existing };
    target = target[parts[i]] as Record<string, unknown>;
  }
  target[parts[parts.length - 1]] = value;
  return root as Partial<T>;
}

export function defaultEquals(a: unknown, b: unknown): boolean {
  if (typeof a === 'number' && typeof b === 'number') return Math.round(a * 100) === Math.round(b * 100);
  return JSON.stringify(a) === JSON.stringify(b);
}

// ---------------------------------------------------------------------------
// Abstract Property
// ---------------------------------------------------------------------------

export interface PropertyContext<T extends object> {
  element: T;
  update: (changes: Partial<T>) => void;
}

export abstract class Property<T extends object = SlideElement> {
  abstract readonly key: string;
  abstract readonly label: string;

  /** Field paths this property owns. Used by SlideSyncButton (multi-slide
   *  sync) and KeyframeButtons (diff + copy from prev/next). Defaults to
   *  `[key]` so single-field properties work without override. */
  get syncFields(): string[] { return [this.key]; }

  /** Transition group the in/out animation buttons drive. Undefined =
   *  the property is not animatable. */
  get transitionGroup(): TransitionGroup | undefined { return undefined; }

  /** Whether to render this row for the given element. Default: always. */
  visibleFor(_element: T): boolean { return true; }

  /** Whether to render this property's editor in a disabled state — the row
   *  still shows up, but the value can't be changed. Distinct from
   *  `visibleFor`: hidden vs. shown-but-greyed. */
  disabledFor(_element: T): boolean { return false; }

  /** If true, the containing panel packs this row side-by-side with the
   *  previous property (see `BaseOpts.groupWithPrevious`). */
  get groupWithPrevious(): boolean { return false; }

  /** Has any of `syncFields` got a different value on `kf` than on the
   *  current element? Drives whether KeyframeButtons shows an arrow. */
  differsFromKeyframe(kf: T, current: T): boolean {
    return this.syncFields.some((f) => !defaultEquals(getNested(kf, f), getNested(current, f)));
  }

  /** Build a `Partial<T>` that copies all `syncFields` from `target` into
   *  the current element. Handles dot-notation paths (nested style fields)
   *  by deep-spreading intermediate objects. */
  copyFromKeyframe(target: T, current: T): Partial<T> {
    let changes: Partial<T> = {};
    for (const f of this.syncFields) {
      const value = getNested(target, f);
      const slice = setNestedPartial(current, f, value);
      // Merge by spreading top-level keys; nested objects from setNested
      // already include their siblings spread.
      changes = { ...changes, ...slice };
    }
    return changes;
  }

  /** Editor body. PropertyRow renders the header (label + buttons) and
   *  delegates the value editing to this method. Return null for
   *  header-only properties (e.g. `Control points (N)` — vertices are
   *  edited on the canvas, not in the panel). */
  abstract renderEditor(ctx: PropertyContext<T>): React.ReactNode;
}

// ---------------------------------------------------------------------------
// Base implementation with field path + dot-notation read/write
// ---------------------------------------------------------------------------

interface BaseOpts<T extends object> {
  /** Dot-notation field path. Used both as the displayed `key` and as the
   *  default getter / setter path. */
  key: string;
  label: string;
  transitionGroup?: TransitionGroup;
  /** Defaults to `[key]`. */
  syncFields?: string[];
  visibleFor?: (el: T) => boolean;
  disabledFor?: (el: T) => boolean;
  /** Render this property's row on the same horizontal line as the previous
   *  property. Used to pack narrow editors (e.g. fill + stroke color swatches)
   *  into a single row instead of two half-empty rows. */
  groupWithPrevious?: boolean;
}

abstract class BaseProperty<T extends object, V> extends Property<T> {
  readonly key: string;
  readonly label: string;
  private readonly _transitionGroup?: TransitionGroup;
  private readonly _syncFields?: string[];
  private readonly _visibleFor?: (el: T) => boolean;
  private readonly _disabledFor?: (el: T) => boolean;
  private readonly _groupWithPrevious?: boolean;

  constructor(opts: BaseOpts<T>) {
    super();
    this.key = opts.key;
    this.label = opts.label;
    this._transitionGroup = opts.transitionGroup;
    this._syncFields = opts.syncFields;
    this._visibleFor = opts.visibleFor;
    this._disabledFor = opts.disabledFor;
    this._groupWithPrevious = opts.groupWithPrevious;
  }

  override get syncFields(): string[] { return this._syncFields ?? [this.key]; }
  override get transitionGroup(): TransitionGroup | undefined { return this._transitionGroup; }
  override visibleFor(el: T): boolean { return this._visibleFor ? this._visibleFor(el) : true; }
  override disabledFor(el: T): boolean { return this._disabledFor ? this._disabledFor(el) : false; }
  override get groupWithPrevious(): boolean { return this._groupWithPrevious ?? false; }

  protected get(el: T): V { return getNested(el, this.key) as V; }
  protected set(el: T, v: V): Partial<T> { return setNestedPartial(el, this.key, v); }
}

// ---------------------------------------------------------------------------
// Concrete property types
// ---------------------------------------------------------------------------

interface NumberOpts<T extends object> extends BaseOpts<T> {
  /** Displayed/scrubbed value = stored value × scale. Bounds, precision,
   * steps and Ctrl snapping are all in DISPLAY units. */
  scale?: number;
  min?: number;
  max?: number;
  step?: number;
  /** Drag-only step override (value per horizontal pixel); arrow keys keep
   *  `step`. See ScrubSpec.scrubStep. */
  scrubStep?: number;
  /** Ctrl-during-scrub snap multiple; default 1 (whole values). */
  ctrlSnap?: number;
  /** Legacy whole-number rounding (good for x/y; off for opacity).
   *  Equivalent to `precision: 0`; kept so existing panels don't churn. */
  round?: boolean;
  /** Decimal places rounded to at commit. Overrides `round`. */
  precision?: number;
  /** Display-only suffix, e.g. '°' or 'px'. */
  unit?: string;
  /** Shown (and scrubbed from) when the field is absent on the element
   *  (e.g. `autoAdvanceDelay` before the first edit). */
  defaultValue?: number;
}

/** Legacy `round: true` maps to `precision: 0`; explicit precision wins. */
function scrubSpecFrom(opts: {
  min?: number; max?: number; step?: number; scrubStep?: number;
  round?: boolean; precision?: number; ctrlSnap?: number;
}): ScrubSpec {
  return {
    min: opts.min,
    max: opts.max,
    step: opts.step,
    scrubStep: opts.scrubStep,
    ctrlSnap: opts.ctrlSnap,
    precision: opts.precision ?? (opts.round ? 0 : undefined),
  };
}

export class NumberProperty<T extends object = SlideElement> extends BaseProperty<T, number> {
  private readonly opts: NumberOpts<T>;
  constructor(opts: NumberOpts<T>) { super(opts); this.opts = opts; }
  renderEditor({ element, update }: PropertyContext<T>) {
    return (
      <NumberEditor
        element={element}
        update={update}
        syncFields={this.syncFields}
        value={(this.get(element) ?? this.opts.defaultValue ?? 0) * (this.opts.scale ?? 1)}
        changesFor={(el: T, v: number) => this.set(el, v / (this.opts.scale ?? 1))}
        spec={scrubSpecFrom(this.opts)}
        unit={this.opts.unit}
        disabled={this.disabledFor(element)}
      />
    );
  }
}

interface RangeOpts<T extends object> extends BaseOpts<T> {
  min: number;
  max: number;
  /** Slider value = stored value × scale (e.g. opacity 0..1 with scale=100
   *  becomes a 0..100 slider). */
  scale?: number;
}

export class RangeProperty<T extends object = SlideElement> extends BaseProperty<T, number> {
  private readonly opts: RangeOpts<T>;
  constructor(opts: RangeOpts<T>) { super(opts); this.opts = opts; }
  renderEditor({ element, update }: PropertyContext<T>) {
    return (
      <RangeEditor
        element={element}
        update={update}
        syncFields={this.syncFields}
        value={this.get(element)}
        changesFor={(el: T, v: number) => this.set(el, v)}
        min={this.opts.min}
        max={this.opts.max}
        scale={this.opts.scale}
        disabled={this.disabledFor(element)}
      />
    );
  }
}

interface ColorOpts<T extends object> extends BaseOpts<T> {
  allowTransparent?: boolean;
}

export class ColorProperty<T extends object = SlideElement> extends BaseProperty<T, string> {
  private readonly opts: ColorOpts<T>;
  constructor(opts: ColorOpts<T>) { super(opts); this.opts = opts; }
  renderEditor({ element, update }: PropertyContext<T>) {
    return (
      <ColorPicker
        color={this.get(element)}
        onChange={(v) => update(this.set(element, v))}
        allowTransparent={this.opts.allowTransparent}
      />
    );
  }
}

/** Checkbox row. The editor is a bare Toggle — the label is rendered ONCE,
 *  by the row header, never by the control itself. */
export class CheckboxProperty<T extends object = SlideElement> extends BaseProperty<T, boolean | undefined> {
  constructor(opts: BaseOpts<T>) { super(opts); }
  renderEditor({ element, update }: PropertyContext<T>) {
    return (
      <Toggle
        checked={this.get(element) ?? false}
        disabled={this.disabledFor(element)}
        onChange={(v) => update(this.set(element, v))}
      />
    );
  }
}

interface SelectOpts<T extends object, V extends string | number> extends BaseOpts<T> {
  options: Array<{ value: V; label: string }>;
  defaultValue?: V;
  /** Coerce the select's raw string value back to V on change. Required
   *  when V is `number`; defaults to identity when V is `string`. */
  parse?: (s: string) => V;
}

export class SelectProperty<T extends object = SlideElement, V extends string | number = string> extends BaseProperty<T, V> {
  private readonly opts: SelectOpts<T, V>;
  constructor(opts: SelectOpts<T, V>) { super(opts); this.opts = opts; }
  renderEditor({ element, update }: PropertyContext<T>) {
    const v = (this.get(element) ?? this.opts.defaultValue) as V;
    const parse = this.opts.parse ?? ((s: string) => s as V);
    return (
      <SelectControl
        value={String(v)}
        options={this.opts.options.map((o) => ({ value: String(o.value), label: o.label }))}
        onChange={(s) => update(this.set(element, parse(s)))}
        disabled={this.disabledFor(element)}
      />
    );
  }
}

interface PreviewSelectOpts<T extends object, V extends string | number> extends BaseOpts<T> {
  /** `preview` is a render function over the current element, so a tile can
   *  reflect live element state (e.g. a dash pattern at the element's own
   *  stroke width) — pass `() => node` when the preview is static. */
  options: Array<{ value: V; label: string; preview: (el: T) => React.ReactNode }>;
  defaultValue?: V;
  /** Grid width of the tile grid. Default 3; use 2 for long labels. */
  columns?: number;
}

/** Exclusive choice rendered as a PreviewSelect tile grid instead of a
 *  native dropdown — each option shows what picking it actually looks like
 *  (a dashed line sample, a font specimen, …). Values stay typed end to
 *  end, so no `parse` round-trip is needed (unlike SelectProperty, whose
 *  native <select> forces strings). */
export class PreviewSelectProperty<T extends object = SlideElement, V extends string | number = string> extends BaseProperty<T, V> {
  private readonly opts: PreviewSelectOpts<T, V>;
  constructor(opts: PreviewSelectOpts<T, V>) { super(opts); this.opts = opts; }
  renderEditor({ element, update }: PropertyContext<T>) {
    const v = (this.get(element) ?? this.opts.defaultValue) as V;
    return (
      <PreviewSelect<V>
        label={this.label}
        options={this.opts.options.map((o) => ({
          value: o.value, label: o.label, preview: o.preview(element),
        }))}
        value={v}
        onChange={(nv) => update(this.set(element, nv))}
        columns={this.opts.columns}
        disabled={this.disabledFor(element)}
      />
    );
  }
}

/** Two side-by-side number inputs (Position X/Y, Size W/H). The two fields
 *  share one transition group and one sync set so they animate as a unit. */
interface PairOpts<T extends object> extends BaseOpts<T> {
  keys: [string, string];
  labels: [string, string];
  /** Legacy whole-number rounding; equivalent to `precision: 0`. */
  round?: boolean;
  /** Shared across both axes (previously accepted-but-ignored). */
  min?: number;
  max?: number;
  step?: number;
  scrubStep?: number;
  ctrlSnap?: number;
  precision?: number;
}

export class PairNumberProperty<T extends object = SlideElement> extends BaseProperty<T, number> {
  private readonly opts: PairOpts<T>;
  constructor(opts: PairOpts<T>) { super(opts); this.opts = opts; }
  override get syncFields(): string[] { return this.opts.syncFields ?? this.opts.keys; }
  renderEditor({ element, update }: PropertyContext<T>) {
    return (
      <PairEditor
        element={element}
        update={update}
        syncFields={this.syncFields}
        keys={this.opts.keys}
        labels={this.opts.labels}
        spec={scrubSpecFrom(this.opts)}
        disabled={this.disabledFor(element)}
      />
    );
  }
}

/** Header-only property (no editor body). Used for fields edited elsewhere
 *  but still animated / synced from the panel — e.g. `Control points` is
 *  edited via canvas handles, but the header still drives transitions and
 *  keyframe resets. */
interface ReadoutOpts<T extends object> extends BaseOpts<T> {
  /** Suffix shown in parentheses after the label, e.g. `(3)` for "3 points". */
  readout?: (el: T) => string;
}

export class ReadoutProperty<T extends object = SlideElement> extends BaseProperty<T, unknown> {
  private readonly opts: ReadoutOpts<T>;
  constructor(opts: ReadoutOpts<T>) { super(opts); this.opts = opts; }
  formattedLabel(el: T): string {
    return this.opts.readout ? `${this.label} (${this.opts.readout(el)})` : this.label;
  }
  renderEditor() { return null; }
}

/** A free-form property whose value text is rendered inline beneath the
 *  header but isn't edited from the panel — current example is the text
 *  Content readout (a slice of the element's text). */
interface PreviewOpts<T extends object> extends BaseOpts<T> {
  preview: (el: T) => string;
}

export class TextPreviewProperty<T extends object = SlideElement> extends BaseProperty<T, string> {
  private readonly opts: PreviewOpts<T>;
  constructor(opts: PreviewOpts<T>) { super(opts); this.opts = opts; }
  renderEditor({ element }: PropertyContext<T>) {
    return <div className="text-xs text-gray-400 truncate">{this.opts.preview(element)}</div>;
  }
}
