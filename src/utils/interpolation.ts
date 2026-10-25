import { interpolateVectorGeometry } from './vectorGeometry';
import { parsePaintColor, formatPaintColor, noPaint } from './paintColor';
import { stationaryPathPair } from './pathInterpolation';
import { bsplineExtensionPair } from './bsplineExtension';
import { pathGeometryInBox, pathPointsInSlide, slidePointToPath } from './pathEditing';
import type { SlideElement, TextElement, ShapeElement, ImageElement, EasingType, ArrowheadType } from '../types/presentation';
import { resamplePath, catmullTangents, supportsPathClosure, pathEndpointDirection, type PathClosureEffect, type PathExtensionEffect, type ExtendEffect } from './pathShapes';
import { lerpMorphedPaths, morphShapeOutlines, outlineIsClosed } from './morphGeometry';

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
    case 'extend':
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
  /** Create: when true, an end-arrowhead rides the growing tip of the
   *  line instead of being traced last. */
  tipDraw?: boolean;
  /** Group stagger: per-child time delay (0..1). The parent's interpolation
   *  attaches the same _writeFx to each child but bumps `t` down by
   *  `childIndex * lag`; the per-child renderer then sees a delayed t. */
  staggerLag?: number;
  staggerIndex?: number;
}

/** Cross-TYPE morph descriptor (text ↔ shape), attached to interpolated
 *  elements as a private `_morphFx` field (same pattern as `_writeFx`).
 *  Interpolation only decides WHEN a morph runs and how far along it is;
 *  the shared `RenderMorph` leaf resolves the actual glyph/outline
 *  geometry at render time (text layout is async, so geometry can't be
 *  produced here). `t` already has the `morph` group easing applied:
 *  0 = fully `from`, 1 = fully `to`. */
export interface MorphFx {
  t: number;
  from: SlideElement;
  to: SlideElement;
}

// Lerp with easing applied
function lerpEased(a: number, b: number, t: number, easing: EasingType | undefined): number {
  return lerp(a, b, applyEasing(t, easing));
}

// Lerp angles via the shortest path (handles wrapping around 360°)
export function lerpAngle(a: number, b: number, t: number): number {
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

export function lerpColor(a: string, b: string, t: number): string {
  const ca = parsePaintColor(a), cb = parsePaintColor(b);
  if (!ca || !cb) return t < 0.5 ? a : b;
  // Missing paint fades the other colour without introducing a black fringe.
  const rgbA = noPaint(a) ? cb : ca;
  const rgbB = noPaint(b) ? ca : cb;
  if (t === 0 && noPaint(a)) return a;
  if (t === 1 && noPaint(b)) return b;
  return formatPaintColor({ r: lerp(rgbA.r, rgbB.r, t), g: lerp(rgbA.g, rgbB.g, t), b: lerp(rgbA.b, rgbB.b, t), a: lerp(ca.a, cb.a, t) });
}

function lerpPoints(a: number[], b: number[], t: number): number[] {
  if (a.length !== b.length) return t < 0.5 ? a : b;
  return a.map((v, i) => lerp(v, b[i], t));
}

/** Per-arrowhead fade alpha across a slide transition.
 *
 *  Works on head PRESENCE (any head vs 'none'/absent): returns `undefined`
 *  when both sides agree on presence (no fade needed — the typed field
 *  already carries the right glyph; a type-only change hard-cuts at t=0.5
 *  like every discrete property) or when no easing is set (default `const`
 *  behaviour: snap at t=0.5). Otherwise eases between 0 and 1 so the
 *  renderer can fade the arrowhead's opacity. */
function arrowAlpha(
  a: ArrowheadType | undefined,
  b: ArrowheadType | undefined,
  t: number,
  easing: EasingType | undefined,
): number | undefined {
  if (!easing || easing === 'const') return undefined;
  const aV = a && a !== 'none' ? 1 : 0;
  const bV = b && b !== 'none' ? 1 : 0;
  if (aV === bV) return undefined;
  return lerpEased(aV, bV, t, easing);
}

/** Tangent list a bezier keyframe actually renders with: stored tangents
 *  when they match the vertex count, Catmull-Rom estimates otherwise —
 *  mirrors pathD's fallback so the lerp starts/ends on what's on screen. */
function renderedTangents(points: number[], tangents: number[] | undefined, closed: boolean): number[] {
  return tangents && tangents.length === points.length * 2
    ? tangents
    : catmullTangents(points, closed);
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

  // Compound vectors must never enter the single-outline morph.
  // Crossfade unsupported topology (including text-vector) at the independently
  // interpolated design box. Same topology interpolates normalized coordinates.
  const aVector = a.type === 'shape' && a.shapeType === 'vector';
  const bVector = b.type === 'shape' && b.shapeType === 'vector';
  if ((aVector || bVector) && (a.type === 'shape' || a.type === 'text') && (b.type === 'shape' || b.type === 'text')) {
    const geometryT = applyEasing(t, a.type === b.type ? tr.controlPoints ?? 'linear' : tr.morph ?? 'const');
    const box = { x: base.x, y: base.y, width: base.width, height: base.height, rotation: base.rotation, opacity: base.opacity, visible: true };
    // Geometry progress never owns paint or box progress, even at const cuts.
    const paint = a.type === 'shape' && b.type === 'shape' ? {
      fill: lerpColor(a.fill, b.fill, applyEasing(t, tr.fill)),
      fillStyle: applyEasing(t, tr.fill) < 0.5 ? a.fillStyle : b.fillStyle,
      stroke: lerpColor(a.stroke, b.stroke, applyEasing(t, tr.stroke)),
      strokeWidth: lerpEased(a.strokeWidth, b.strokeWidth, t, tr.strokeWidth),
    } : {};
    const layer = (element: SlideElement): SlideElement => ({ ...element, ...box,
      ...(element.type === 'shape' ? paint : {}),
      ...(element.type === 'shape' && element.shapeType === 'path' ? pathGeometryInBox(element, box.width, box.height) : {}),
    });
    if (aVector && bVector && a.geometry && b.geometry) {
      const geometry = interpolateVectorGeometry(a.geometry, b.geometry, geometryT);
      if (geometry) return { ...b, ...box, ...paint, geometry };
    }
    const from = layer(a), to = layer(b);
    if (geometryT <= 0) return from;
    if (geometryT >= 1) return to;
    return { ...to, _vectorCrossfade: {
      from: { ...from, opacity: baseOpacity * (1 - geometryT) },
      to: { ...to, opacity: baseOpacity * geometryT },
    } } as SlideElement & { _vectorCrossfade: { from: SlideElement; to: SlideElement } };
  }

  // Text elements
  if (a.type === 'text' && b.type === 'text') {
    const ta = a as TextElement;
    const tb = b as TextElement;
    const contentEasing = tr.content ?? 'const';
    const textLayout = t < 0.5 ? ta : tb;
    const layoutFields = { textSizing: textLayout.textSizing, boundTextLayout: textLayout.boundTextLayout,
      containerId: textLayout.containerId, boundTextBaselineHeight: textLayout.boundTextBaselineHeight };

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
          ...layoutFields,
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
        textSizing: tb.textSizing, boundTextLayout: tb.boundTextLayout,
        containerId: tb.containerId, boundTextBaselineHeight: tb.boundTextBaselineHeight,
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
      ...layoutFields,
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

    // Cross-shapeType morph (rect ↔ star, ellipse ↔ path, …): AUTOMATIC —
    // both outlines are sampled/aligned/lerped by morphShapeOutlines and the
    // in-flight frame renders as a synthetic path shape. The geometry t is
    // eased by the EXISTING controlPoints group (same precedent as the
    // curve/closed morph below); every other property keeps its own group
    // easing via `base` / the fill/stroke/width lerps. The synthetic shape
    // stays closed (so fills keep rendering) unless an open path
    // participates, in which case the closing edge is baked into the sample
    // list and the polyline renders open — exactly like the path↔path morph.
    if (sa.shapeType !== sb.shapeType && t > 0 && t < 1) {
      const geomT = applyEasing(t, tr.controlPoints ?? 'linear');
      return {
        ...base,
        type: 'shape',
        shapeType: 'path',
        fill: lerpColor(sa.fill, sb.fill, fillT),
        fillStyle: fillT < 0.5 ? sa.fillStyle : sb.fillStyle,
        stroke: lerpColor(sa.stroke, sb.stroke, strokeT),
        strokeWidth: lerpEased(sa.strokeWidth, sb.strokeWidth, t, tr.strokeWidth),
        cornerRadius: 0,
        points: morphShapeOutlines(sa, sb, geomT, undefined, base.width, base.height),
        curve: 'linear',
        closed: outlineIsClosed(sa) && outlineIsClosed(sb),
        tangents: undefined,
        startHead: undefined,
        endHead: undefined,
        startBinding: undefined,
        endBinding: undefined,
      } as ShapeElement;
    }

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
    // Bezier pair-lerp: both sides bezier with equal vertex count (and the
    // same closed state) lerp `tangents` pairwise alongside `points` under
    // the controlPoints group — exact and cheap, like same-N point lists.
    // Any other bezier combination (count mismatch, bezier ↔ other curve)
    // falls into the sampled-morph path below, which works because
    // sampledPath knows bezier.
    const aIsBezier = aCurve === 'bezier';
    const bIsBezier = bCurve === 'bezier';
    const bezierPairLerp = aIsBezier && bIsBezier
      && !!sa.points && !!sb.points && sa.points.length === sb.points.length
      && aClosed === bClosed;
    const pathsMorph = sa.shapeType === 'path' && sb.shapeType === 'path'
      && (aCurve !== bCurve || aClosed !== bClosed
        || ((aIsBezier || bIsBezier) && !bezierPairLerp)
        || ((aCurve === 'smooth' || bCurve === 'smooth') && sa.points?.length !== sb.points?.length));
    const closurePair = sa.shapeType === 'path' && sb.shapeType === 'path'
      && aCurve === bCurve && aClosed !== bClosed && sa.points?.length === sb.points?.length
      && supportsPathClosure(sa) && supportsPathClosure(sb);
    let pathClosure: PathClosureEffect | undefined;
    let pathExtension: PathExtensionEffect | undefined;
    let nextCurve: ShapeElement['curve'] | undefined = t < 0.5 ? sa.curve : sb.curve;
    let nextClosed: boolean | undefined = t < 0.5 ? sa.closed : sb.closed;
    let nextPoints: number[] | undefined;
    let nextTangents: number[] | undefined = t < 0.5 ? sa.tangents : sb.tangents;
    if (sa.points && sb.points) {
      const ease = tr.controlPoints ?? 'linear';
      const splineExtension = t > 0 && t < 1 ? bsplineExtensionPair(sa, sb) : null;
      const stationary = sa.shapeType === 'path' && sb.shapeType === 'path'
        && t > 0 && t < 1 ? stationaryPathPair(sa, sb) : null;
      if (t === 0 || t === 1) {
        nextPoints = t === 0 ? sa.points : sb.points;
        nextTangents = t === 0 ? sa.tangents : sb.tangents;
      } else if (closurePair) {
        const easedT = applyEasing(t, ease);
        // Local design-box interpolation keeps authored pose/size independent
        // of controlPoints. No world-pinning or global arc-length resampling.
        const ag = pathGeometryInBox(sa, base.width, base.height);
        const bg = pathGeometryInBox(sb, base.width, base.height);
        nextPoints = ag.points!.map((v, i) => lerp(v, bg.points![i], easedT));
        nextTangents = aIsBezier ? ag.tangents!.map((v, i) => lerp(v, bg.tangents![i], easedT))
          : easedT < 0.5 ? sa.tangents : sb.tangents;
        nextCurve = easedT < 0.5 ? sa.curve : sb.curve;
        const progress = lerp(Number(aClosed), Number(bClosed), easedT);
        nextClosed = progress === 1;
        // Keep paint even when const geometry is already at an endpoint.
        pathClosure = { progress, fillOpacity: lerp(Number(aClosed), Number(bClosed), fillT) };
      } else if (splineExtension) {
        const easedT = applyEasing(t, ease);
        const endpoint = easedT === 0 ? sa : easedT === 1 ? sb : undefined;
        // Const must keep the actual native representation, not just an
        // approximation of its shape. Only normalization bookkeeping cancels.
        const world = endpoint ? pathPointsInSlide(endpoint)
          : splineExtension.a.map((v, i) => lerp(v, splineExtension.b[i], easedT));
        nextPoints = [];
        for (let i = 0; i < world.length; i += 2) {
          const local = slidePointToPath({ ...sa, x: base.x, y: base.y, width: base.width, height: base.height, rotation: base.rotation }, world[i], world[i + 1]);
          nextPoints.push(local.x, local.y);
        }
        nextCurve = endpoint ? endpoint.curve : 'linear';
        nextTangents = undefined;
        if (!endpoint) {
          const direction = (end: 'start' | 'end') => {
            const ad = pathEndpointDirection(sa.points!, aCurve, false, undefined, end);
            const bd = pathEndpointDirection(sb.points!, bCurve, false, undefined, end);
            const angle = lerpAngle(Math.atan2(ad.dy, ad.dx) * 180 / Math.PI,
              Math.atan2(bd.dy, bd.dx) * 180 / Math.PI, easedT) * Math.PI / 180;
            return { dx: Math.cos(angle), dy: Math.sin(angle) };
          };
          pathExtension = { startDirection: direction('start'), endDirection: direction('end') };
        }
      } else if (stationary) {
        const easedT = applyEasing(t, ease);
        // A const interior edit keeps the actual native endpoint topology,
        // while paint and bbox properties retain their independent clocks.
        const endpoint = stationary.interior ? easedT === 0 ? sa : easedT === 1 ? sb : undefined : undefined;
        const world = endpoint ? pathPointsInSlide(endpoint)
          : stationary.a.map((v, i) => lerp(v, stationary.b[i], easedT));
        nextPoints = [];
        for (let i = 0; i < world.length; i += 2) {
          const local = slidePointToPath({ ...sa, x: base.x, y: base.y, width: base.width, height: base.height, rotation: base.rotation },
            world[i], world[i + 1]);
          nextPoints.push(local.x, local.y);
        }
        if (endpoint) {
          nextCurve = endpoint.curve;
          nextTangents = endpoint.tangents;
        } else if (aIsBezier || (aCurve === 'smooth' && sa.points.length !== sb.points.length)) {
          nextCurve = 'bezier';
          nextTangents = stationary.aTangents.map((v, i) => lerp(v, stationary.bTangents[i], easedT));
        }
      } else if (pathsMorph && t > 0 && t < 1) {
        nextPoints = lerpMorphedPaths(
          sa.points, aCurve, aClosed, sa.tangents,
          sb.points, bCurve, bClosed, sb.tangents,
          applyEasing(t, ease),
        );
        nextCurve = 'linear';
        nextClosed = false;
        nextTangents = undefined;
      } else {
        const easedT = tr.controlPoints ? applyEasing(t, ease) : t;
        nextPoints = tr.controlPoints
          ? lerpControlPoints(sa.points, sb.points, easedT, aClosed || bClosed)
          : lerpPoints(sa.points, sb.points, t);
        if (bezierPairLerp) {
          // Lerp against the tangents each keyframe RENDERS with (stored or
          // Catmull-Rom fallback) so missing arrays animate smoothly too.
          const aTan = renderedTangents(sa.points, sa.tangents, aClosed);
          const bTan = renderedTangents(sb.points, sb.tangents, bClosed);
          nextTangents = aTan.map((v, i) => lerp(v, bTan[i], easedT));
        }
      }
    } else {
      nextPoints = t < 0.5 ? sa.points : sb.points;
    }

    // Per-arrowhead fade alpha. When the matching easing is set AND head
    // presence differs between A and B, we ease a numeric 0↔1 alpha and
    // attach it as `_startArrowAlpha` / `_endArrowAlpha`; ElementRenderer
    // honours those over head presence. The head TYPE itself always snaps
    // at t=0.5 (mirroring the old boolean snap), so without an easing set
    // the whole head snaps (default `const` behaviour).
    const startArrowAlpha = arrowAlpha(sa.startHead, sb.startHead, t, tr.startArrow);
    const endArrowAlpha = arrowAlpha(sa.endHead, sb.endHead, t, tr.endArrow);
    // While a presence fade is active, the interpolated element must carry
    // the glyph of the side that HAS a head for the whole transition —
    // otherwise the t<0.5 half would render 'none' at partial alpha (i.e.
    // nothing) and the fade would look like a snap anyway.
    const headDuringFade = (aH: ArrowheadType | undefined, bH: ArrowheadType | undefined) =>
      aH && aH !== 'none' ? aH : bH;
    const nextStartHead = startArrowAlpha !== undefined
      ? headDuringFade(sa.startHead, sb.startHead)
      : (t < 0.5 ? sa.startHead : sb.startHead);
    const nextEndHead = endArrowAlpha !== undefined
      ? headDuringFade(sa.endHead, sb.endHead)
      : (t < 0.5 ? sa.endHead : sb.endHead);

    return {
      ...base,
      type: 'shape',
      shapeType: t < 0.5 ? sa.shapeType : sb.shapeType,
      fill: lerpColor(sa.fill, sb.fill, fillT),
      fillStyle: fillT < 0.5 ? sa.fillStyle : sb.fillStyle,
      stroke: lerpColor(sa.stroke, sb.stroke, strokeT),
      strokeWidth: lerpEased(sa.strokeWidth, sb.strokeWidth, t, tr.strokeWidth),
      cornerRadius: lerpEased(sa.cornerRadius, sb.cornerRadius, t, tr.cornerRadius),
      points: nextPoints,
      curve: nextCurve,
      closed: nextClosed,
      tangents: nextTangents,
      startHead: nextStartHead,
      endHead: nextEndHead,
      _startArrowAlpha: startArrowAlpha,
      _endArrowAlpha: endArrowAlpha,
      ...(pathClosure ? { _pathClosure: pathClosure } : {}),
      ...(pathExtension ? { _pathExtension: pathExtension } : {}),
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
        case 'dissolve': {
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
        }

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

  // Cross-TYPE keyframes (text ↔ shape ↔ image). Base properties —
  // position / size / rotation / opacity — ALWAYS lerp under their own
  // group easings; the discrete remainder (the element's type-specific
  // payload) snaps at t=0.5.
  const snapped = t < 0.5 ? a : b;
  const result = {
    ...snapped,
    x: base.x,
    y: base.y,
    width: base.width,
    height: base.height,
    rotation: base.rotation,
    opacity: base.opacity,
    visible: true,
  } as SlideElement;

  // Opt-in text ↔ shape geometry morph via the `morph` transition group.
  // 'const' (and unset) keep the hard cut; 'linear'/'ease' attach a
  // _morphFx descriptor that the shared RenderMorph leaf resolves. The
  // morph governs ONLY the geometry correspondence — the base lerp above
  // still carries position/size/rotation/opacity under their own easings.
  const morphable = (el: SlideElement) => el.type === 'text' || el.type === 'shape';
  if (morphable(a) && morphable(b) && tr.morph && tr.morph !== 'const' && t > 0 && t < 1) {
    return {
      ...result,
      _morphFx: { t: applyEasing(t, tr.morph), from: a, to: b },
    } as SlideElement & { _morphFx: MorphFx };
  }
  return result;
}

/** Default visibility easing for an element when no explicit setting is
 *  present. Path shapes (lines, arrows, polylines, polygons) draw themselves
 *  on appear via `create`; everything else falls back to a simple linear
 *  fade. Used by both the interpolator (to actually animate) and the
 *  TransitionButton (to show the right "current" pill in the picker). */
export function defaultVisibilityEasing(element: SlideElement | undefined): EasingType {
  if (element && element.type === 'shape' && (element as ShapeElement).shapeType === 'path') {
    return 'create';
  }
  return 'linear';
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
    case 'create':      return mk('create',   { tipDraw: options?.create?.tipDraw });
    // 'extend' is NOT a WriteEffect mode: it's pure geometry, so it rides on
    // the element as `_extendFx` instead (see buildExtendFx).
    case 'wipe':        return mk('wipe',    { from: options?.wipe?.from });
    case 'slidein':     return mk('slidein', { from: options?.slidein?.from });
    case 'grow':        return mk('grow',    { anchor: options?.grow?.anchor });
    case 'iris':        return mk('iris',    { cx: options?.iris?.cx, cy: options?.iris?.cy });
    default:            return null;
  }
}

/** Try to build an `extend` descriptor for a visibility transition.
 *
 *  Unlike every `WriteEffect` mode this animation is pure GEOMETRY, so it does
 *  not go through `_writeFx`/the presenter at all: the descriptor rides on the
 *  element as `_extendFx` and `pathArrowGeometry` — the one geometry source the
 *  editor canvas, presenter, standalone/viewer builds, Create and the PDF export
 *  all funnel through — resolves it into an arc-length prefix of the path's own
 *  route. The typed arrowheads then come out of that prefix's own endpoints, so
 *  the end glyph rides the growing tip at its normal size and stroke.
 *
 *  Returns null for anything with no route to grow along (text, images, filled
 *  primitives like rect/ellipse/star, degenerate vertex lists), which falls
 *  through to the ordinary opacity ramp. `progress` spans the FULL transition
 *  window and is already direction-mapped by the caller, so backward playback
 *  simply retracts the path toward its first vertex. */
function buildExtendFx(
  element: SlideElement,
  easing: import('../types/presentation').EasingType | undefined,
  progress: number,
): ExtendEffect | null {
  if (easing !== 'extend' || element.type !== 'shape') return null;
  const shape = element as ShapeElement;
  if (shape.shapeType !== 'path' || (shape.points?.length ?? 0) < 4) return null;
  return { progress: Math.max(0, Math.min(1, progress)) };
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
    const easing = elA.transitions?.visibility ?? defaultVisibilityEasing(elA);
    const extend = buildExtendFx(elA, easing, 1 - t);
    if (extend) {
      return { ...elA, visible: true, _extendFx: extend } as SlideElement & { _extendFx: ExtendEffect };
    }
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
  const easing = target.transitions?.visibility ?? defaultVisibilityEasing(target);
  const extend = buildExtendFx(target, easing, t);
  if (extend) {
    return { ...target, visible: true, _extendFx: extend } as SlideElement & { _extendFx: ExtendEffect };
  }
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
