import React from 'react';
import { ColorPicker } from '../toolbar/ColorPicker';
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

/** Returns a `Partial<E>` that, when shallow-merged onto `el`, sets the
 *  value at `path`. For nested paths the intermediate objects are spread
 *  from the live element so sibling fields aren't lost. */
export function setNestedPartial<E>(el: E, path: string, value: unknown): Partial<E> {
  const parts = path.split('.');
  if (parts.length === 1) {
    return { [parts[0]]: value } as Partial<E>;
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
  return root as Partial<E>;
}

export function defaultEquals(a: unknown, b: unknown): boolean {
  if (typeof a === 'number' && typeof b === 'number') return Math.round(a * 100) === Math.round(b * 100);
  return JSON.stringify(a) === JSON.stringify(b);
}

// ---------------------------------------------------------------------------
// Abstract Property
// ---------------------------------------------------------------------------

export interface PropertyContext<E extends SlideElement> {
  element: E;
  update: (changes: Partial<E>) => void;
}

export abstract class Property<E extends SlideElement = SlideElement> {
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
  visibleFor(_element: E): boolean { return true; }

  /** Whether to render this property's editor in a disabled state — the row
   *  still shows up, but the value can't be changed. Distinct from
   *  `visibleFor`: hidden vs. shown-but-greyed. */
  disabledFor(_element: E): boolean { return false; }

  /** If true, the containing panel packs this row side-by-side with the
   *  previous property (see `BaseOpts.groupWithPrevious`). */
  get groupWithPrevious(): boolean { return false; }

  /** Has any of `syncFields` got a different value on `kf` than on the
   *  current element? Drives whether KeyframeButtons shows an arrow. */
  differsFromKeyframe(kf: E, current: E): boolean {
    return this.syncFields.some((f) => !defaultEquals(getNested(kf, f), getNested(current, f)));
  }

  /** Build a `Partial<E>` that copies all `syncFields` from `target` into
   *  the current element. Handles dot-notation paths (nested style fields)
   *  by deep-spreading intermediate objects. */
  copyFromKeyframe(target: E, current: E): Partial<E> {
    let changes: Partial<E> = {};
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
  abstract renderEditor(ctx: PropertyContext<E>): React.ReactNode;
}

// ---------------------------------------------------------------------------
// Base implementation with field path + dot-notation read/write
// ---------------------------------------------------------------------------

interface BaseOpts<E extends SlideElement> {
  /** Dot-notation field path. Used both as the displayed `key` and as the
   *  default getter / setter path. */
  key: string;
  label: string;
  transitionGroup?: TransitionGroup;
  /** Defaults to `[key]`. */
  syncFields?: string[];
  visibleFor?: (el: E) => boolean;
  disabledFor?: (el: E) => boolean;
  /** Render this property's row on the same horizontal line as the previous
   *  property. Used to pack narrow editors (e.g. fill + stroke color swatches)
   *  into a single row instead of two half-empty rows. */
  groupWithPrevious?: boolean;
}

abstract class BaseProperty<E extends SlideElement, V> extends Property<E> {
  readonly key: string;
  readonly label: string;
  private readonly _transitionGroup?: TransitionGroup;
  private readonly _syncFields?: string[];
  private readonly _visibleFor?: (el: E) => boolean;
  private readonly _disabledFor?: (el: E) => boolean;
  private readonly _groupWithPrevious?: boolean;

  constructor(opts: BaseOpts<E>) {
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
  override visibleFor(el: E): boolean { return this._visibleFor ? this._visibleFor(el) : true; }
  override disabledFor(el: E): boolean { return this._disabledFor ? this._disabledFor(el) : false; }
  override get groupWithPrevious(): boolean { return this._groupWithPrevious ?? false; }

  protected get(el: E): V { return getNested(el, this.key) as V; }
  protected set(el: E, v: V): Partial<E> { return setNestedPartial(el, this.key, v); }
}

// ---------------------------------------------------------------------------
// Concrete property types
// ---------------------------------------------------------------------------

interface NumberOpts<E extends SlideElement> extends BaseOpts<E> {
  min?: number;
  max?: number;
  step?: number;
  /** Round the display value (good for x/y; off for opacity). */
  round?: boolean;
}

export class NumberProperty<E extends SlideElement> extends BaseProperty<E, number> {
  private readonly opts: NumberOpts<E>;
  constructor(opts: NumberOpts<E>) { super(opts); this.opts = opts; }
  renderEditor({ element, update }: PropertyContext<E>) {
    const v = this.get(element);
    return (
      <input
        type="number"
        value={this.opts.round ? Math.round(v) : v}
        min={this.opts.min}
        max={this.opts.max}
        step={this.opts.step}
        onChange={(e) => update(this.set(element, Number(e.target.value)))}
        className="w-full h-8 text-sm border border-gray-300 rounded px-2"
      />
    );
  }
}

interface RangeOpts<E extends SlideElement> extends BaseOpts<E> {
  min: number;
  max: number;
  /** Slider value = stored value × scale (e.g. opacity 0..1 with scale=100
   *  becomes a 0..100 slider). */
  scale?: number;
}

export class RangeProperty<E extends SlideElement> extends BaseProperty<E, number> {
  private readonly opts: RangeOpts<E>;
  constructor(opts: RangeOpts<E>) { super(opts); this.opts = opts; }
  renderEditor({ element, update }: PropertyContext<E>) {
    const v = this.get(element);
    const scale = this.opts.scale ?? 1;
    return (
      <input
        type="range"
        value={v * scale}
        min={this.opts.min}
        max={this.opts.max}
        onChange={(e) => update(this.set(element, Number(e.target.value) / scale))}
        className="w-full accent-blue-500"
      />
    );
  }
}

interface ColorOpts<E extends SlideElement> extends BaseOpts<E> {
  allowTransparent?: boolean;
}

export class ColorProperty<E extends SlideElement> extends BaseProperty<E, string> {
  private readonly opts: ColorOpts<E>;
  constructor(opts: ColorOpts<E>) { super(opts); this.opts = opts; }
  renderEditor({ element, update }: PropertyContext<E>) {
    return (
      <ColorPicker
        color={this.get(element)}
        onChange={(v) => update(this.set(element, v))}
        allowTransparent={this.opts.allowTransparent}
      />
    );
  }
}

export class CheckboxProperty<E extends SlideElement> extends BaseProperty<E, boolean | undefined> {
  constructor(opts: BaseOpts<E>) { super(opts); }
  renderEditor({ element, update }: PropertyContext<E>) {
    const disabled = this.disabledFor(element);
    return (
      <label className={`text-xs flex items-center gap-2 ${disabled ? 'text-gray-300' : 'text-gray-500'}`}>
        <input
          type="checkbox"
          checked={this.get(element) ?? false}
          disabled={disabled}
          onChange={(e) => update(this.set(element, e.target.checked))}
          className="accent-blue-500 disabled:opacity-50"
        />
        {this.label}
      </label>
    );
  }
}

interface SelectOpts<E extends SlideElement, V extends string | number> extends BaseOpts<E> {
  options: Array<{ value: V; label: string }>;
  defaultValue?: V;
  /** Coerce the select's raw string value back to V on change. Required
   *  when V is `number`; defaults to identity when V is `string`. */
  parse?: (s: string) => V;
}

export class SelectProperty<E extends SlideElement, V extends string | number = string> extends BaseProperty<E, V> {
  private readonly opts: SelectOpts<E, V>;
  constructor(opts: SelectOpts<E, V>) { super(opts); this.opts = opts; }
  renderEditor({ element, update }: PropertyContext<E>) {
    const v = (this.get(element) ?? this.opts.defaultValue) as V;
    const parse = this.opts.parse ?? ((s: string) => s as V);
    return (
      <select
        value={String(v)}
        onChange={(e) => update(this.set(element, parse(e.target.value)))}
        className="w-full h-8 text-sm border border-gray-300 rounded px-2 bg-white"
      >
        {this.opts.options.map((o) => (
          <option key={String(o.value)} value={String(o.value)}>{o.label}</option>
        ))}
      </select>
    );
  }
}

/** Two side-by-side number inputs (Position X/Y, Size W/H). The two fields
 *  share one transition group and one sync set so they animate as a unit. */
interface PairOpts<E extends SlideElement> extends BaseOpts<E> {
  keys: [string, string];
  labels: [string, string];
  round?: boolean;
}

export class PairNumberProperty<E extends SlideElement> extends BaseProperty<E, number> {
  private readonly opts: PairOpts<E>;
  constructor(opts: PairOpts<E>) { super(opts); this.opts = opts; }
  override get syncFields(): string[] { return this.opts.syncFields ?? this.opts.keys; }
  renderEditor({ element, update }: PropertyContext<E>) {
    const cells = this.opts.keys.map((k, i) => {
      const v = getNested(element, k) as number;
      return (
        <div key={k}>
          <label className="text-xs text-gray-500 block mb-1">{this.opts.labels[i]}</label>
          <input
            type="number"
            value={this.opts.round ? Math.round(v) : v}
            onChange={(ev) => update(setNestedPartial(element, k, Number(ev.target.value)))}
            className="w-full h-7 text-xs border border-gray-300 rounded px-2"
          />
        </div>
      );
    });
    return <div className="grid grid-cols-2 gap-2">{cells}</div>;
  }
}

/** Header-only property (no editor body). Used for fields edited elsewhere
 *  but still animated / synced from the panel — e.g. `Control points` is
 *  edited via canvas handles, but the header still drives transitions and
 *  keyframe resets. */
interface ReadoutOpts<E extends SlideElement> extends BaseOpts<E> {
  /** Suffix shown in parentheses after the label, e.g. `(3)` for "3 points". */
  readout?: (el: E) => string;
}

export class ReadoutProperty<E extends SlideElement> extends BaseProperty<E, unknown> {
  private readonly opts: ReadoutOpts<E>;
  constructor(opts: ReadoutOpts<E>) { super(opts); this.opts = opts; }
  formattedLabel(el: E): string {
    return this.opts.readout ? `${this.label} (${this.opts.readout(el)})` : this.label;
  }
  renderEditor() { return null; }
}

/** A free-form property whose value text is rendered inline beneath the
 *  header but isn't edited from the panel — current example is the text
 *  Content readout (a slice of the element's text). */
interface PreviewOpts<E extends SlideElement> extends BaseOpts<E> {
  preview: (el: E) => string;
}

export class TextPreviewProperty<E extends SlideElement> extends BaseProperty<E, string> {
  private readonly opts: PreviewOpts<E>;
  constructor(opts: PreviewOpts<E>) { super(opts); this.opts = opts; }
  renderEditor({ element }: PropertyContext<E>) {
    return <div className="text-xs text-gray-400 truncate">{this.opts.preview(element)}</div>;
  }
}
