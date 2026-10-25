import React, { useEffect, useReducer } from 'react';
import type { SlideElement, TextElement, ShapeElement } from '../../types/presentation';
import type { MorphFx } from '../../utils/interpolation';
import { lerp, lerpColor } from '../../utils/interpolation';
import { textInsets } from '../../utils/boundTextLayout';
import { textVerticalOffset, type SvgTextDoc } from '../../utils/textLayout';
import { getUserTextLayoutSync, layoutUserText } from '../../utils/userTextSizing';
import { samplePathD } from '../../utils/glyphPaths';
import {
  shapeToUnitOutline,
  partitionOutline,
  parseTransformChain,
  applyMat,
} from '../../utils/morphGeometry';
import { RenderShape } from './ElementRenderer';
import { SVGTextPaths } from './SVGTextPaths';

/** Points per glyph outline AND per shape-outline segment — pairs lerp
 *  pointwise, so both sides of a pair use the same count. */
const SAMPLES_PER_GLYPH = 32;
/** Minimum shape-outline sample density before partitioning. */
const OUTLINE_MIN_SAMPLES = 257;

interface GlyphPairing {
  /** Text-element-local glyph outlines (one polyline per glyph), reading
   *  order. */
  glyphs: number[][];
  /** Shape-element-local outline segments, same count/order as `glyphs`. */
  segments: number[][];
  /** Per-glyph text-side colour (links/math can differ from style.color). */
  glyphColors: string[];
}

// Pairing cache — keyed on everything the geometry depends on (text layout
// identity + shape geometry + sampling density). Same pattern as geomCache
// in shapeToPath.ts: bounded by distinct (text, shape) pairs in the deck.
const pairingCache = new Map<string, GlyphPairing>();

function shapeGeomKey(shape: ShapeElement): string {
  return [
    shape.shapeType,
    shape.width, shape.height,
    shape.cornerRadius ?? 0,
    shape.points ? shape.points.join(',') : '',
    shape.tangents ? shape.tangents.join(',') : '',
    shape.closed ? 1 : 0,
    shape.curve ?? 'linear',
  ].join('|');
}

function textGeomKey(text: TextElement, boxWidth: number): string {
  const s = text.style;
  return [
    text.text,
    s.fontSize, s.fontWeight, s.fontStyle, s.lineHeight, s.align, s.verticalAlign,
    boxWidth, text.height, textInsets(text), text.textSizing, s.color, s.fontFamily, s.textDecoration,
  ].join('|');
}

/**
 * Arc-partition correspondence: the text's K glyph outlines (reading order)
 * pair with K contiguous equal-arc segments of the single shape outline.
 * Ink bijection — segments tile the outline exactly, nothing overdraws —
 * and fully deterministic, so the pairing is identical whichever side is
 * `from` (direction symmetry). Returns null while glyph sampling is
 * unavailable (no DOM) or the layout has no glyphs.
 */
function buildPairing(
  textEl: TextElement,
  shapeEl: ShapeElement,
  doc: SvgTextDoc,
  boxWidth: number,
): GlyphPairing | null {
  const K = doc.paths.length;
  if (K === 0) return null;
  const key = `${textGeomKey(textEl, boxWidth)}||${shapeGeomKey(shapeEl)}|${K}|${SAMPLES_PER_GLYPH}`;
  const hit = pairingCache.get(key);
  if (hit) return hit;

  const vOff = textVerticalOffset(textEl.style.verticalAlign, textEl.height, textInsets(textEl), doc.height);
  const glyphs: number[][] = [];
  const glyphColors: string[] = [];
  for (const p of doc.paths) {
    const mat = parseTransformChain(p.transform);
    const raw = samplePathD(p.d, SAMPLES_PER_GLYPH);
    const pts: number[] = [];
    if (raw.length === 2 * SAMPLES_PER_GLYPH) {
      for (let i = 0; i < raw.length; i += 2) {
        const [x, y] = applyMat(mat, raw[i], raw[i + 1]);
        pts.push(x + textInsets(textEl), y + textInsets(textEl) + vOff);
      }
    } else {
      // Sampling unavailable (or degenerate d): collapse the glyph to its
      // pen position so the pair still animates instead of vanishing.
      const [x, y] = applyMat(mat, 0, 0);
      for (let i = 0; i < SAMPLES_PER_GLYPH; i++) {
        pts.push(x + textInsets(textEl), y + textInsets(textEl) + vOff);
      }
    }
    glyphs.push(pts);
    glyphColors.push(p.fillColor);
  }

  // Shape outline in shape-local coords, dense enough that each of the K
  // segments keeps its curvature.
  const outlineN = Math.max(OUTLINE_MIN_SAMPLES, K * 16 + 1);
  const unit = shapeToUnitOutline(shapeEl, outlineN);
  const outline: number[] = new Array(unit.points.length);
  for (let i = 0; i < unit.points.length; i += 2) {
    outline[i] = unit.points[i] * shapeEl.width;
    outline[i + 1] = unit.points[i + 1] * shapeEl.height;
  }
  const segments = partitionOutline(outline, K, SAMPLES_PER_GLYPH);
  if (segments.length !== K) return null;

  const pairing: GlyphPairing = { glyphs, segments, glyphColors };
  pairingCache.set(key, pairing);
  return pairing;
}

/**
 * Shared leaf that resolves a `_morphFx` descriptor (text ↔ shape morph)
 * attached by `interpolateElement`. Consumed at ONE dispatch point
 * (`presenterUtils.renderElementInner`), so the presenter, animation
 * previews and every export that runs the presenter renderer draw morphs
 * identically — never fork this per context.
 *
 * Geometry: each glyph outline pairs with one contiguous equal-arc segment
 * of the shape outline (arc partition, see `buildPairing`); each pair
 * renders as one <path> whose points lerp between the two sides, with fill
 * lerping text colour → shape fill and stroke ramping 0 → shape
 * strokeWidth. Position / size / rotation / opacity come from the already
 * base-lerped `element`, so their own transition-group easings keep
 * governing them.
 *
 * Text layout is async: until `getLayoutSync` has the doc, we kick
 * `layoutSvgText` and render a sqrt-opacity crossfade of the two real
 * elements (graceful degradation), re-rendering when the layout lands.
 */
export const RenderMorph: React.FC<{ element: SlideElement }> = ({ element }) => {
  const fx = (element as SlideElement & { _morphFx?: MorphFx })._morphFx;
  const from = fx?.from;
  const to = fx?.to;
  const textEl = (from?.type === 'text' ? from : to?.type === 'text' ? to : null) as TextElement | null;
  const shapeEl = (from?.type === 'shape' ? from : to?.type === 'shape' ? to : null) as ShapeElement | null;

  const boxWidth = textEl ? Math.max(1, textEl.width - textInsets(textEl) * 2) : 1;
  const doc = textEl ? getUserTextLayoutSync(textEl) : null;

  // Async layout kick — re-render once the layout lands. (Reducer bump
  // instead of storing the doc: getLayoutSync is the single source of
  // truth, matching hit-testing and SVGTextPaths.)
  const [, bump] = useReducer((x: number) => x + 1, 0);
  useEffect(() => {
    if (doc || !textEl) return;
    let live = true;
    layoutUserText(textEl).then(
      () => { if (live) bump(); },
      () => {},
    );
    return () => { live = false; };
  }, [doc, textEl, textEl?.text, textEl?.style, boxWidth]);

  if (!fx || !from || !to) return null;

  const t = Math.max(0, Math.min(1, fx.t));
  const cx = element.x + element.width / 2;
  const cy = element.y + element.height / 2;
  const rotate = element.rotation ? `rotate(${element.rotation}, ${cx}, ${cy})` : undefined;

  const pairing = textEl && shapeEl && doc ? buildPairing(textEl, shapeEl, doc, boxWidth) : null;

  if (!pairing || !textEl || !shapeEl) {
    // Graceful degradation: sqrt-opacity crossfade of the two REAL elements
    // through the shared leaf renderers (never a forked drawing path).
    const renderSide = (el: SlideElement, alpha: number, prefix: string): React.ReactNode => {
      if (el.type === 'text') {
        return (
          <SVGTextPaths
            element={el as TextElement}
            opacity={el.opacity * alpha}
            clipIdPrefix={`morph-${prefix}`}
          />
        );
      }
      if (el.type === 'shape') {
        return <RenderShape element={{ ...(el as ShapeElement), opacity: el.opacity * alpha }} />;
      }
      return null;
    };
    return (
      <g transform={rotate}>
        {renderSide(from, Math.sqrt(1 - t), 'src')}
        {renderSide(to, Math.sqrt(t), 'tgt')}
      </g>
    );
  }

  // Direction: the pairing is canonical (text side ↔ shape side); assign
  // from/to per this transition's direction. `tShape` is the fraction of
  // the way toward the SHAPE side, used for the style ramps.
  const fromIsText = from === textEl;
  const tShape = fromIsText ? t : 1 - t;
  const shapeFill = shapeEl.fill || 'transparent';
  const strokeWidth = lerp(0, shapeEl.strokeWidth || 0, tShape);

  const pairs: React.ReactNode[] = [];
  for (let i = 0; i < pairing.glyphs.length; i++) {
    const textPts = pairing.glyphs[i];
    const shapePts = pairing.segments[i];
    const fromPts = fromIsText ? textPts : shapePts;
    const toPts = fromIsText ? shapePts : textPts;
    let d = '';
    for (let j = 0; j < fromPts.length; j += 2) {
      const x = lerp(fromPts[j], toPts[j], t);
      const y = lerp(fromPts[j + 1], toPts[j + 1], t);
      d += `${j === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${y.toFixed(2)} `;
    }
    d += 'Z';
    const textColor = pairing.glyphColors[i];
    const fill = fromIsText
      ? lerpColor(textColor, shapeFill, t)
      : lerpColor(shapeFill, textColor, t);
    pairs.push(
      <path
        key={i}
        d={d}
        fill={fill}
        stroke={strokeWidth > 0.01 ? (shapeEl.stroke || 'none') : 'none'}
        strokeWidth={strokeWidth}
        strokeLinejoin="round"
        strokeLinecap="round"
      />,
    );
  }

  // Each side's pair points are LOCAL to its own element box; the lerped
  // geometry is placed at the base-lerped position, so the `position`
  // group easing keeps governing where the morph sits.
  return (
    <g transform={rotate} opacity={element.opacity} style={{ pointerEvents: 'none' }}>
      <g transform={`translate(${element.x}, ${element.y})`}>{pairs}</g>
    </g>
  );
};
