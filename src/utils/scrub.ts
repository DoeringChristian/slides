/**
 * Pure math for Blender-style drag-to-scrub numeric inputs.
 *
 * The model is INCREMENTAL: every pointer-move event contributes
 * `dx × step × (fine ? fineFactor : 1)` to a running draft value. The draft
 * is clamped per move but NEVER rounded per move — rounding happens only at
 * commit (`commitValue`), so a slow fine drag can accumulate sub-`step`
 * amounts instead of having every move flushed to zero. Incremental deltas
 * (rather than an absolute down-point mapping) are what let the fine factor
 * toggle mid-drag: pixels moved while Shift is held count fine, pixels moved
 * before/after count coarse.
 *
 * Everything in here is DOM-free so it runs under the node-env vitest suite.
 */

export interface ScrubSpec {
  min?: number;
  max?: number;
  /** Value change per horizontal pixel of coarse drag (and per arrow-key
   *  press in edit mode). Default 1. */
  step?: number;
  /** Multiplier applied to `step` while fine-scrubbing (Shift held).
   *  Default 0.1. */
  fineFactor?: number;
  /** Decimal places to round to at COMMIT time. Undefined = no rounding.
   *  Deliberately not applied per move — see module comment. */
  precision?: number;
}

export function clampValue(v: number, spec: ScrubSpec): number {
  if (spec.min !== undefined && v < spec.min) return spec.min;
  if (spec.max !== undefined && v > spec.max) return spec.max;
  return v;
}

/** Apply one pointer-move's horizontal delta (in screen px) to the running
 *  draft. Clamped, NOT rounded (rounding only at commit). `fine` is polled
 *  per move so Shift can toggle mid-drag. */
export function applyScrubDelta(
  current: number,
  dxPx: number,
  spec: ScrubSpec,
  fine: boolean,
): number {
  const step = spec.step ?? 1;
  const factor = fine ? spec.fineFactor ?? 0.1 : 1;
  return clampValue(current + dxPx * step * factor, spec);
}

/** Finalize a draft value: clamp, then round to `precision` decimals (when
 *  given). This is the only place rounding happens. */
export function commitValue(v: number, spec: ScrubSpec): number {
  let out = clampValue(v, spec);
  if (spec.precision !== undefined) {
    const f = Math.pow(10, spec.precision);
    // Incremental accumulation leaves binary-float dust (0.1 × 5 →
    // 0.4999999999999998); snap to 12 significant digits before rounding so
    // ~1e-15 error can't flip a rounding boundary.
    out = clampValue(Math.round(Number((out * f).toPrecision(12))) / f, spec);
  }
  return out;
}

/** Human-readable rendering of a (possibly mid-scrub, unrounded) value.
 *  With `precision` set the width is fixed; otherwise binary-float noise is
 *  trimmed (0.30000000000000004 → "0.3"). `unit` is appended verbatim. */
export function formatValue(v: number, spec: ScrubSpec, unit?: string): string {
  let text: string;
  if (spec.precision !== undefined) {
    text = v.toFixed(spec.precision);
  } else {
    text = String(Math.round(v * 1e4) / 1e4);
  }
  // toFixed can produce "-0" / "-0.00"; show plain zero.
  if (Number(text) === 0) text = text.replace(/^-/, '');
  return unit ? `${text}${unit}` : text;
}

/** Parse typed input. Returns the clamped number, or null when the text is
 *  not a number (caller reverts to the previous value). Tolerates ',' as the
 *  decimal separator and surrounding whitespace. Rounding is left to
 *  `commitValue`. */
export function parseInput(text: string, spec: ScrubSpec): number | null {
  const t = text.trim().replace(/,/g, '.');
  if (t === '') return null;
  const n = Number(t);
  if (!Number.isFinite(n)) return null;
  return clampValue(n, spec);
}
