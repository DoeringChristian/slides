import type { SlideElement, TextElement, ShapeElement, ImageElement, EasingType } from '../types/presentation';
import { clamp } from './geometry';
import { resamplePath, sampledPath } from './pathShapes';
import type { PathCurve } from '../types/presentation';

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

// Easing functions
function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

// Apply easing based on type
function applyEasing(t: number, easing: EasingType | undefined): number {
  switch (easing) {
    case 'const': return t < 0.5 ? 0 : 1;  // Snap at midpoint
    case 'ease': return easeInOutCubic(t);
    case 'dissolve': return t;
    // Glyph/path/visual-wrapper easings — numeric branch doesn't apply, the
    // visibility/content branches handle them. Pass through.
    case 'write':
    case 'typewriter':
    case 'fadebyglyph':
    case 'create':
    case 'wipe':
    case 'slidein':
    case 'grow':
    case 'iris':
      return t;
    case 'linear':
    default: return t;
  }
}

// Attached to interpolated elements when the renderer should drive a special
// entrance/exit animation. Lives on a private `_writeFx` field on the element
// so it doesn't pollute the persisted schema. Modes:
//
//  Glyph-level (text only — SVGTextPaths.RenderPaths picks the formula):
//    'write'       : manim pen-draw — staggered outline reveal + fill phase.
//    'typewriter'  : sequential per-glyph fill, no stroke.
//    'fadebyglyph' : per-glyph staggered fade with overlap (LaggedStart).
//
//  Shape-level (shape renderer reads it to switch to path-based draw):
//    'create'      : outline trace + fill, like Write but on the shape's perimeter.
//
//  Element-agnostic visual wrappers (renderPresenterElement wraps the rendered
//  element in a transform/clip group — works for text/shape/image uniformly):
//    'wipe'        : directional clip-path reveal (uses anim.from).
//    'slidein'     : translate from off-screen edge (uses anim.from).
//    'grow'        : scale from anchor 0 → 1 (uses anim.anchor).
//    'iris'        : circular clip-path expanding from a point.
//
// `t` and `direction` work the same across all modes — direction='out' is
// just the reverse (interpolation flips t before attaching).
export type AnimMode =
  | 'write' | 'typewriter' | 'fadebyglyph'
  | 'create'
  | 'wipe' | 'slidein' | 'grow' | 'iris';

export interface WriteEffect {
  t: number;                       // 0..1 progress
  direction: 'in' | 'out';
  mode: AnimMode;
  /** Direction for wipe/slidein. */
  from?: 'left' | 'right' | 'top' | 'bottom';
  /** Anchor for grow. */
  anchor?:
    | 'center'
    | 'top-left' | 'top' | 'top-right'
    | 'left' | 'right'
    | 'bottom-left' | 'bottom' | 'bottom-right';
  /** Iris: optional centre in element-local [0,1] coordinates. */
  cx?: number;
  cy?: number;
  /** Group stagger: per-child time delay (0..1). The parent's interpolation
   *  attaches the same _writeFx to each child but bumps `t` down by
   *  `childIndex * lag`; the per-child renderer then sees a delayed t. */
  staggerLag?: number;
  staggerIndex?: number;
}

// Lerp with easing applied
function lerpEased(a: number, b: number, t: number, easing: EasingType | undefined): number {
  return lerp(a, b, applyEasing(t, easing));
}

// Lerp angles via the shortest path (handles wrapping around 360°)
function lerpAngle(a: number, b: number, t: number): number {
  // Normalize both to [0, 360)
  a = ((a % 360) + 360) % 360;
  b = ((b % 360) + 360) % 360;
  // Shortest angular distance
  let delta = b - a;
  if (delta > 180) delta -= 360;
  if (delta < -180) delta += 360;
  return a + delta * t;
}

function lerpAngleEased(a: number, b: number, t: number, easing: EasingType | undefined): number {
  return lerpAngle(a, b, applyEasing(t, easing));
}

// Color lerp with easing applied
function lerpColorEased(a: string, b: string, t: number, easing: EasingType | undefined): string {
  return lerpColor(a, b, applyEasing(t, easing));
}

function parseHex(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  if (h.length === 3) {
    return [
      parseInt(h[0] + h[0], 16),
      parseInt(h[1] + h[1], 16),
      parseInt(h[2] + h[2], 16),
    ];
  }
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}

function toHex(r: number, g: number, b: number): string {
  const rr = clamp(Math.round(r), 0, 255).toString(16).padStart(2, '0');
  const gg = clamp(Math.round(g), 0, 255).toString(16).padStart(2, '0');
  const bb = clamp(Math.round(b), 0, 255).toString(16).padStart(2, '0');
  return `#${rr}${gg}${bb}`;
}

export function lerpColor(a: string, b: string, t: number): string {
  if (!a || !b || !a.startsWith('#') || !b.startsWith('#')) {
    return t < 0.5 ? a : b;
  }
  const [ar, ag, ab] = parseHex(a);
  const [br, bg, bb] = parseHex(b);
  return toHex(lerp(ar, br, t), lerp(ag, bg, t), lerp(ab, bb, t));
}

function lerpPoints(a: number[], b: number[], t: number): number[] {
  if (a.length !== b.length) return t < 0.5 ? a : b;
  return a.map((v, i) => lerp(v, b[i], t));
}

/** Per-arrow fade alpha across a slide transition.
 *
 *  Returns `undefined` when both sides agree (no animation needed — the
 *  boolean field already carries the right value) or when no easing is set
 *  (default `const` behaviour: snap at t=0.5). Otherwise eases between 0
 *  and 1 so the renderer can fade the arrowhead's opacity. */
function arrowAlpha(
  a: boolean | undefined,
  b: boolean | undefined,
  t: number,
  easing: EasingType | undefined,
): number | undefined {
  if (!easing || easing === 'const') return undefined;
  if (a === b) return undefined;
  const aV = a ? 1 : 0;
  const bV = b ? 1 : 0;
  return lerpEased(aV, bV, t, easing);
}

/** Sample a path into a polyline suitable for the smooth curve / closed
 *  morph. When the source is closed, append the first sample at the end
 *  so the closing segment becomes an explicit polyline edge — the
 *  in-flight interpolated shape is rendered as an OPEN polyline, so the
 *  Z command can't add (or remove) a visible segment mid-transition. */
function polylineForMorph(points: number[], curve: PathCurve, closed: boolean): number[] {
  const samples = sampledPath(points, curve, closed);
  if (closed && samples.length >= 2) return [...samples, samples[0], samples[1]];
  return samples;
}

/** Smooth control-point interpolation for path shapes.
 *
 *  When source and target have the same number of vertices, each is lerped
 *  pairwise — exact and cheap. When they differ, we arc-length-resample
 *  BOTH paths to the larger N first, so a 2-point line morphing into a
 *  6-point curve eases through equally-spaced intermediate points instead
 *  of snapping at t=0.5.
 *
 *  Easing is applied to t before resampling — callers pass the eased t.
 */
function lerpControlPoints(a: number[], b: number[], t: number, closed: boolean): number[] {
  if (a.length === b.length) return a.map((v, i) => lerp(v, b[i], t));
  const targetN = Math.max(a.length, b.length) / 2;
  const aR = resamplePath(a, targetN, closed);
  const bR = resamplePath(b, targetN, closed);
  return aR.map((v, i) => lerp(v, bR[i], t));
}

// Typewriter text interpolation
// Finds common prefix/suffix and animates the changing part
function interpolateTextTypewriter(a: string, b: string, t: number): string {
  if (a === b) return a;

  // Find common prefix
  let prefixLen = 0;
  while (prefixLen < a.length && prefixLen < b.length && a[prefixLen] === b[prefixLen]) {
    prefixLen++;
  }

  // Find common suffix (after prefix)
  let suffixLen = 0;
  while (
    suffixLen < a.length - prefixLen &&
    suffixLen < b.length - prefixLen &&
    a[a.length - 1 - suffixLen] === b[b.length - 1 - suffixLen]
  ) {
    suffixLen++;
  }

  const prefix = a.slice(0, prefixLen);
  const suffix = a.slice(a.length - suffixLen);
  const aMiddle = a.slice(prefixLen, a.length - suffixLen);
  const bMiddle = b.slice(prefixLen, b.length - suffixLen);

  // If only adding or removing text (no middle change on one side)
  if (aMiddle.length === 0) {
    // Pure addition: type out bMiddle
    const charsToShow = Math.round(bMiddle.length * t);
    return prefix + bMiddle.slice(0, charsToShow) + suffix;
  }

  if (bMiddle.length === 0) {
    // Pure deletion: backspace aMiddle
    const charsToKeep = Math.round(aMiddle.length * (1 - t));
    return prefix + aMiddle.slice(0, charsToKeep) + suffix;
  }

  // Both have middle content - do a two-phase animation:
  // First half: delete old middle, Second half: type new middle
  if (t < 0.5) {
    // Deleting phase
    const deleteT = t * 2;
    const charsToKeep = Math.round(aMiddle.length * (1 - deleteT));
    return prefix + aMiddle.slice(0, charsToKeep) + suffix;
  } else {
    // Typing phase
    const typeT = (t - 0.5) * 2;
    const charsToShow = Math.round(bMiddle.length * typeT);
    return prefix + bMiddle.slice(0, charsToShow) + suffix;
  }
}

// Text content interpolation result
interface TextInterpolation {
  text: string;
  opacityMultiplier: number; // 1 = normal, <1 = fading
  dissolveSource?: { text: string; opacityMultiplier: number }; // For crossfade dissolve
}

// Interpolate text based on easing type
function interpolateText(a: string, b: string, t: number, easing: EasingType | undefined): TextInterpolation {
  if (a === b) return { text: a, opacityMultiplier: 1 };

  switch (easing) {
    case 'typewriter':
      // Typewriter effect with easing
      return { text: interpolateTextTypewriter(a, b, easeInOutCubic(t)), opacityMultiplier: 1 };

    case 'dissolve':
    case 'linear':
    case 'ease':
      // Crossfade dissolve: render both old and new text simultaneously
      // Using sqrt curves like image dissolve for smooth blending
      return {
        text: b,
        opacityMultiplier: Math.sqrt(t),
        dissolveSource: { text: a, opacityMultiplier: Math.sqrt(1 - t) },
      };

    case 'const':
    default:
      // Snap at midpoint
      return { text: t < 0.5 ? a : b, opacityMultiplier: 1 };
  }
}

// Calculate fadeinout opacity for content changes
// First half: fade out (1 -> 0), Second half: fade in (0 -> 1)
function fadeinoutOpacity(baseOpacity: number, t: number): number {
  if (t < 0.5) {
    // Fade out: opacity goes from baseOpacity to 0 as t goes from 0 to 0.5
    return baseOpacity * (1 - t * 2);
  } else {
    // Fade in: opacity goes from 0 to baseOpacity as t goes from 0.5 to 1
    return baseOpacity * ((t - 0.5) * 2);
  }
}

// Dissolve source info for text crossfade
export interface TextDissolveSource {
  text: string;
  opacity: number;
}

// Crossfade source info for rendering both source and target
export interface CrossfadeSource {
  resourceId: string | null | undefined;
  opacity: number;
  cropX: number;
  cropY: number;
  cropWidth: number;
  cropHeight: number;
}

export function interpolateElement(a: SlideElement, b: SlideElement, t: number, isForward: boolean = true): SlideElement {
  // Get transition settings from the element that was the "target" in forward direction
  // Forward: A→B, use B's transitions
  // Backward: B→A (but A and B are swapped), so use A's transitions (which is now 'a')
  const tr = isForward ? (b.transitions || {}) : (a.transitions || {});

  // Base element properties with per-property easing
  const baseOpacity = lerpEased(a.opacity, b.opacity, t, tr.opacity);
  const base = {
    ...a,
    x: lerpEased(a.x, b.x, t, tr.position),
    y: lerpEased(a.y, b.y, t, tr.position),
    width: lerpEased(a.width, b.width, t, tr.size),
    height: lerpEased(a.height, b.height, t, tr.size),
    rotation: lerpAngleEased(a.rotation, b.rotation, t, tr.rotation),
    opacity: baseOpacity,
    visible: true,
  };

  // Text elements
  if (a.type === 'text' && b.type === 'text') {
    const ta = a as TextElement;
    const tb = b as TextElement;
    const contentEasing = tr.content ?? 'const';

    // Glyph-level content change. Both Write and Typewriter share the same
    // mechanics — the only differences are the per-glyph render formula
    // (RenderPaths branches on `mode`) and the undoFirst default.
    //
    //   undoFirst=false: at t=0+ the source snaps off, target reveals across
    //     the FULL duration. Cleanest for Write ("clear + write").
    //
    //   undoFirst=true: source un-reveals in the first half, target reveals
    //     in the second half. Matches the typewriter intuition of "delete
    //     then type" (so it's the default for typewriter).
    if ((contentEasing === 'write' || contentEasing === 'typewriter' || contentEasing === 'fadebyglyph') && ta.text !== tb.text) {
      const mode: WriteEffect['mode'] = contentEasing;
      const opts = mode === 'write' ? tr.contentOptions?.write
        : mode === 'typewriter' ? tr.contentOptions?.typewriter
        : undefined;
      // typewriter historically defaults to "delete then type"; write and
      // fadebyglyph default to "snap clear then reveal".
      const undoFirstDefault = mode === 'typewriter';
      const undoFirst = opts?.undoFirst ?? undoFirstDefault;

      if (undoFirst) {
        const useA = t < 0.5;
        const sourceText = useA ? ta.text : tb.text;
        const fx: WriteEffect = useA
          ? { t: 1 - t * 2, direction: 'out', mode }
          : { t: (t - 0.5) * 2, direction: 'in', mode };
        return {
          ...base,
          type: 'text',
          text: sourceText,
          opacity: baseOpacity,
          style: {
            fontFamily: useA ? ta.style.fontFamily : tb.style.fontFamily,
            fontSize: lerpEased(ta.style.fontSize, tb.style.fontSize, t, tr.fontSize),
            fontWeight: useA ? ta.style.fontWeight : tb.style.fontWeight,
            fontStyle: useA ? ta.style.fontStyle : tb.style.fontStyle,
            textDecoration: useA ? ta.style.textDecoration : tb.style.textDecoration,
            color: lerpColorEased(ta.style.color, tb.style.color, t, tr.color),
            align: useA ? ta.style.align : tb.style.align,
            verticalAlign: useA ? ta.style.verticalAlign : tb.style.verticalAlign,
            lineHeight: lerpEased(ta.style.lineHeight, tb.style.lineHeight, t, tr.lineHeight),
          },
          _writeFx: fx,
        } as TextElement & { _writeFx: WriteEffect };
      }
      return {
        ...base,
        type: 'text',
        text: tb.text,
        opacity: baseOpacity,
        style: {
          fontFamily: tb.style.fontFamily,
          fontSize: tb.style.fontSize,
          fontWeight: tb.style.fontWeight,
          fontStyle: tb.style.fontStyle,
          textDecoration: tb.style.textDecoration,
          color: tb.style.color,
          align: tb.style.align,
          verticalAlign: tb.style.verticalAlign,
          lineHeight: tb.style.lineHeight,
        },
        _writeFx: { t, direction: 'in', mode },
      } as TextElement & { _writeFx: WriteEffect };
    }

    const textResult = interpolateText(ta.text, tb.text, t, contentEasing);
    const result: TextElement & { _dissolveText?: TextDissolveSource } = {
      ...base,
      type: 'text',
      text: textResult.text,
      opacity: baseOpacity * textResult.opacityMultiplier,
      style: {
        fontFamily: t < 0.5 ? ta.style.fontFamily : tb.style.fontFamily,
        fontSize: lerpEased(ta.style.fontSize, tb.style.fontSize, t, tr.fontSize),
        fontWeight: t < 0.5 ? ta.style.fontWeight : tb.style.fontWeight,
        fontStyle: t < 0.5 ? ta.style.fontStyle : tb.style.fontStyle,
        textDecoration: t < 0.5 ? ta.style.textDecoration : tb.style.textDecoration,
        color: lerpColorEased(ta.style.color, tb.style.color, t, tr.color),
        align: t < 0.5 ? ta.style.align : tb.style.align,
        verticalAlign: t < 0.5 ? ta.style.verticalAlign : tb.style.verticalAlign,
        lineHeight: lerpEased(ta.style.lineHeight, tb.style.lineHeight, t, tr.lineHeight),
      },
    };
    if (textResult.dissolveSource) {
      result._dissolveText = {
        text: textResult.dissolveSource.text,
        opacity: baseOpacity * textResult.dissolveSource.opacityMultiplier,
      };
    }
    return result;
  }

  // Shape elements
  if (a.type === 'shape' && b.type === 'shape') {
    const sa = a as ShapeElement;
    const sb = b as ShapeElement;
    const fillT = applyEasing(t, tr.fill);
    const strokeT = applyEasing(t, tr.stroke);

    // Curve / closed morph: snapping the path shape at t=0.5 looks abrupt
    // whenever the source and target paths differ in curve mode OR closed
    // state. We sample both into dense polylines, lerp pairwise, and
    // render the in-flight shape as a plain LINEAR OPEN polyline — the
    // closing segment of a closed source is baked into its sample list
    // (see polylineForMorph), so the renderer doesn't need to draw a Z
    // that would itself snap on/off mid-transition. End states (t=0, 1)
    // still use the original curve/closed.
    const aCurve = sa.curve ?? 'linear';
    const bCurve = sb.curve ?? 'linear';
    const aClosed = sa.closed ?? false;
    const bClosed = sb.closed ?? false;
    const pathsMorph = sa.shapeType === 'path' && sb.shapeType === 'path'
      && (aCurve !== bCurve || aClosed !== bClosed);
    let nextCurve: ShapeElement['curve'] | undefined = t < 0.5 ? sa.curve : sb.curve;
    let nextClosed: boolean | undefined = t < 0.5 ? sa.closed : sb.closed;
    let nextPoints: number[] | undefined;
    if (sa.points && sb.points) {
      const ease = tr.controlPoints ?? 'linear';
      if (pathsMorph && t > 0 && t < 1) {
        const aSamples = polylineForMorph(sa.points, aCurve, aClosed);
        const bSamples = polylineForMorph(sb.points, bCurve, bClosed);
        nextPoints = lerpControlPoints(aSamples, bSamples, applyEasing(t, ease), false);
        nextCurve = 'linear';
        nextClosed = false;
      } else if (tr.controlPoints) {
        nextPoints = lerpControlPoints(sa.points, sb.points, applyEasing(t, ease), aClosed || bClosed);
      } else {
        nextPoints = lerpPoints(sa.points, sb.points, t);
      }
    } else {
      nextPoints = t < 0.5 ? sa.points : sb.points;
    }

    // Per-arrow fade alpha. When the matching easing is set AND the
    // endpoints differ between A and B, we ease a numeric 0↔1 alpha and
    // attach it as `_startArrowAlpha` / `_endArrowAlpha`; ElementRenderer
    // honours those over the boolean fields. Without an easing set, the
    // boolean snaps at t=0.5 (default `const` behaviour).
    const startArrowAlpha = arrowAlpha(sa.startArrow, sb.startArrow, t, tr.startArrow);
    const endArrowAlpha = arrowAlpha(sa.endArrow, sb.endArrow, t, tr.endArrow);

    return {
      ...base,
      type: 'shape',
      shapeType: t < 0.5 ? sa.shapeType : sb.shapeType,
      fill: lerpColor(sa.fill, sb.fill, fillT),
      stroke: lerpColor(sa.stroke, sb.stroke, strokeT),
      strokeWidth: lerpEased(sa.strokeWidth, sb.strokeWidth, t, tr.strokeWidth),
      cornerRadius: lerpEased(sa.cornerRadius, sb.cornerRadius, t, tr.cornerRadius),
      points: nextPoints,
      curve: nextCurve,
      closed: nextClosed,
      startArrow: t < 0.5 ? sa.startArrow : sb.startArrow,
      endArrow: t < 0.5 ? sa.endArrow : sb.endArrow,
      _startArrowAlpha: startArrowAlpha,
      _endArrowAlpha: endArrowAlpha,
      startBinding: t < 0.5 ? sa.startBinding : sb.startBinding,
      endBinding: t < 0.5 ? sa.endBinding : sb.endBinding,
    } as ShapeElement & { _startArrowAlpha?: number; _endArrowAlpha?: number };
  }

  // Image elements
  if (a.type === 'image' && b.type === 'image') {
    const ia = a as ImageElement;
    const ib = b as ImageElement;

    // Check if resourceId changes
    const resourceChanges = ia.resourceId !== ib.resourceId;
    const useFirst = t < 0.5;

    // Determine resource transition behavior (default to dissolve)
    const resourceEasing = tr.resource ?? 'dissolve';

    // For crop: if resource changes, snap values; otherwise interpolate with easing
    const cropT = applyEasing(t, tr.crop);

    // Build base image result
    const result: ImageElement & { _dissolveSource?: CrossfadeSource } = {
      ...base,
      type: 'image',
      resourceId: ib.resourceId,
      cropX: resourceChanges ? ib.cropX : lerp(ia.cropX, ib.cropX, cropT),
      cropY: resourceChanges ? ib.cropY : lerp(ia.cropY, ib.cropY, cropT),
      cropWidth: resourceChanges ? ib.cropWidth : lerp(ia.cropWidth, ib.cropWidth, cropT),
      cropHeight: resourceChanges ? ib.cropHeight : lerp(ia.cropHeight, ib.cropHeight, cropT),
      playing: ib.playing,
      loop: ib.loop,
      muted: ib.muted,
      startTime: ib.startTime,
    };

    if (resourceChanges) {
      switch (resourceEasing) {
        case 'dissolve':
          // True dissolve: both images blend with curves that minimize lightening
          // Using sqrt curves: combined alpha stays above 0.9 throughout
          // sqrt(t) + sqrt(1-t) * (1 - sqrt(t)) ≈ 0.91 at midpoint
          const sqrtT = Math.sqrt(t);
          const sqrtOneMinusT = Math.sqrt(1 - t);
          result.opacity = baseOpacity * sqrtT;
          result._dissolveSource = {
            resourceId: ia.resourceId,
            opacity: baseOpacity * sqrtOneMinusT,
            cropX: ia.cropX,
            cropY: ia.cropY,
            cropWidth: ia.cropWidth,
            cropHeight: ia.cropHeight,
          };
          break;

        case 'fadeinout':
          // Fade out first half, fade in second half
          result.resourceId = useFirst ? ia.resourceId : ib.resourceId;
          result.opacity = fadeinoutOpacity(baseOpacity, t);
          result.cropX = useFirst ? ia.cropX : ib.cropX;
          result.cropY = useFirst ? ia.cropY : ib.cropY;
          result.cropWidth = useFirst ? ia.cropWidth : ib.cropWidth;
          result.cropHeight = useFirst ? ia.cropHeight : ib.cropHeight;
          break;

        case 'const':
        default:
          // Snap at midpoint
          result.resourceId = useFirst ? ia.resourceId : ib.resourceId;
          result.cropX = useFirst ? ia.cropX : ib.cropX;
          result.cropY = useFirst ? ia.cropY : ib.cropY;
          result.cropWidth = useFirst ? ia.cropWidth : ib.cropWidth;
          result.cropHeight = useFirst ? ia.cropHeight : ib.cropHeight;
          break;
      }
    }

    return result;
  }

  // Fallback: snap at midpoint
  return (t < 0.5 ? { ...a } : { ...b }) as SlideElement;
}

/** Try to build a WriteEffect for a visibility transition. Returns null when
 *  the easing isn't one of the new path/wrapper-style animations (fall
 *  through to the existing fade ramp). All these animations span the FULL
 *  transition window — pre-mapped baseT is 0 → 1 of visible time. */
function buildVisibilityFx(
  easing: import('../types/presentation').EasingType | undefined,
  options: import('../types/presentation').TransitionOptions | undefined,
  baseT: number,
  direction: 'in' | 'out',
): WriteEffect | null {
  const mk = (mode: WriteEffect['mode'], extra: Partial<WriteEffect> = {}): WriteEffect =>
    ({ t: baseT, direction, mode, ...extra });
  switch (easing) {
    case 'write':       return mk('write');
    case 'typewriter':  return mk('typewriter');
    case 'fadebyglyph': return mk('fadebyglyph');
    case 'create':      return mk('create');
    case 'wipe':        return mk('wipe',    { from: options?.wipe?.from });
    case 'slidein':     return mk('slidein', { from: options?.slidein?.from });
    case 'grow':        return mk('grow',    { anchor: options?.grow?.anchor });
    case 'iris':        return mk('iris',    { cx: options?.iris?.cx, cy: options?.iris?.cy });
    default:            return null;
  }
}

// Build an interpolated element for visibility transitions
// Fade-out happens in the first half (t: 0 -> 0.5)
// Fade-in happens in the second half (t: 0.5 -> 1)
export function interpolateWithVisibility(
  elA: SlideElement | undefined,
  elB: SlideElement | undefined,
  t: number,
  isForward: boolean = true,
): SlideElement | null {
  const aVisible = elA && elA.visible;
  const bVisible = elB && elB.visible;

  if (!aVisible && !bVisible) return null;

  if (aVisible && bVisible) {
    return interpolateElement(elA, elB, t, isForward);
  }

  // For visibility transitions, use the element that was "target" in forward direction
  // Forward: appearing element (B) has the transition settings
  // Backward: disappearing element (A, which was B in forward) has the settings
  if (aVisible && !bVisible) {
    const easing = elA.transitions?.visibility;
    const fx = buildVisibilityFx(easing, elA.transitions?.visibilityOptions, 1 - t, 'out');
    if (fx) {
      return { ...elA, visible: true, _writeFx: fx } as SlideElement & { _writeFx: WriteEffect };
    }
    // Fade out: completes at t=0.5, stays invisible after
    if (t >= 0.5) return null;
    // Map t from [0, 0.5] to [0, 1] for the fade-out
    const fadeOutT = t * 2;
    const easedT = applyEasing(fadeOutT, easing);
    return { ...elA, opacity: lerp(elA.opacity, 0, easedT), visible: true } as SlideElement;
  }

  // !aVisible && bVisible
  const target = elB!;
  const easing = target.transitions?.visibility;
  const fx = buildVisibilityFx(easing, target.transitions?.visibilityOptions, t, 'in');
  if (fx) {
    return { ...target, visible: true, _writeFx: fx } as SlideElement & { _writeFx: WriteEffect };
  }
  // Fade in starts at t=0.5
  if (t < 0.5) return null;
  // Map t from [0.5, 1] to [0, 1] for the fade-in
  const fadeInT = (t - 0.5) * 2;
  const easedT = applyEasing(fadeInT, easing);
  return { ...target, opacity: lerp(0, target.opacity, easedT), visible: true } as SlideElement;
}
