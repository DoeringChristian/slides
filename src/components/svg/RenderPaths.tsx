import React from 'react';
import type { WriteEffect } from '../../utils/interpolation';

/** One renderable SVG path used by every glyph/path-based animation. */
export interface SvgPath {
  d: string;
  transform: string;
  /** Total path length used both for budget calculations and as the
   *  stroke-dasharray value. In SCREEN-pixel space. */
  length: number;
  /** Fill colour applied during the FILL phase. */
  fillColor: string;
  /** Stroke colour during the REVEAL phase. Defaults to `fillColor` (matches
   *  text behaviour); shapes may pass a separate stroke colour. */
  strokeColor?: string;
  /** Math glyphs render inside a heavy scale-down transform; without
   *  non-scaling-stroke their stroke width shrinks to invisibility. */
  nonScalingStroke: boolean;
  /** Source-line index this path belongs to. Used by the edit overlay to
   *  hide paths on the cursor / selection lines so the raw text underneath
   *  shows through. -1 for paths that don't belong to a specific source
   *  line (rare). */
  lineIndex?: number;
}

/**
 * Per-glyph frame for WRITE / CREATE: staggered two-phase animation (manim's
 * `Write`).
 *
 *   REVEAL (~70% of the unit's window): a thin pen traces the outline.
 *   FILL  (~30%): stroke fades, fill ramps 0 → 1.
 *
 * Steady state collapses to the FILL endpoint by feeding T=Infinity.
 */
function writeGlyphFrame(
  pathLength: number,
  glyphIndex: number,
  lag: number,
  T: number,
  glyphSpan: number,
): { dashOffset: number; fillOpacity: number; strokeOpacity: number } {
  const REVEAL_END = 0.7;
  const startT = glyphIndex * lag;
  const localT = Math.max(0, Math.min(1, (T - startT) / glyphSpan));
  if (localT <= 0) return { dashOffset: pathLength, fillOpacity: 0, strokeOpacity: 0 };
  if (localT < REVEAL_END) {
    const ph = localT / REVEAL_END;
    return { dashOffset: pathLength * (1 - ph), fillOpacity: 0, strokeOpacity: 1 };
  }
  const ph = (localT - REVEAL_END) / (1 - REVEAL_END);
  return { dashOffset: 0, fillOpacity: ph, strokeOpacity: 1 - ph };
}

/**
 * TYPEWRITER: glyphs fade in one at a time, no stroke, no overlap.
 */
function typewriterGlyphFrame(
  glyphIndex: number,
  T: number,
  N: number,
): { dashOffset: number; fillOpacity: number; strokeOpacity: number } {
  const localT = Math.max(0, Math.min(1, T * N - glyphIndex));
  return { dashOffset: 0, fillOpacity: localT, strokeOpacity: 0 };
}

/**
 * FADE-BY-GLYPH: each glyph fades over its own window with overlap controlled
 * by `lag`. Softer than typewriter pops; simpler than Write's stroke phase.
 */
function fadeByGlyphFrame(
  glyphIndex: number,
  lag: number,
  T: number,
  glyphSpan: number,
): { dashOffset: number; fillOpacity: number; strokeOpacity: number } {
  const startT = glyphIndex * lag;
  const localT = Math.max(0, Math.min(1, (T - startT) / glyphSpan));
  return { dashOffset: 0, fillOpacity: localT, strokeOpacity: 0 };
}

interface RenderPathsProps {
  paths: SvgPath[];
  writeFx?: WriteEffect;
  /** Stroke width for the REVEAL pen. Callers usually pass
   *  `Math.max(1.2, fontSize / 20)` for text or the shape's own strokeWidth. */
  strokeWidth: number;
}

/**
 * Per-path render shared by every glyph- or path-based animation. Used by
 * both `SVGTextPaths` (text glyph paths) and shape-Create (a single outline
 * path). Branches on `writeFx.mode` for the per-unit formula; steady frame
 * (`writeFx === undefined`) feeds T=Infinity which lands on full fill, no
 * stroke — so the transition end-state matches the steady frame exactly.
 */
export const RenderPaths: React.FC<RenderPathsProps> = ({ paths, writeFx, strokeWidth }) => {
  const T = writeFx ? writeFx.t : Number.POSITIVE_INFINITY;
  const mode: WriteEffect['mode'] = writeFx?.mode ?? 'write';
  const N = paths.length;
  const glyphSpan = mode === 'fadebyglyph' ? 0.5 : 0.5;
  const lag = writeFx && N > 1 ? (1 - glyphSpan) / (N - 1) : 0;

  return (
    <g>
      {paths.map((p, i) => {
        let frame;
        switch (mode) {
          case 'typewriter':
            frame = typewriterGlyphFrame(i, T, N);
            break;
          case 'fadebyglyph':
            frame = fadeByGlyphFrame(i, lag, T, glyphSpan);
            break;
          case 'write':
          case 'create':
          default:
            frame = writeGlyphFrame(p.length, i, lag, T, glyphSpan);
            break;
        }
        const strokeCol = p.strokeColor ?? p.fillColor;
        return (
          <path
            key={i}
            d={p.d}
            transform={p.transform || undefined}
            fill={p.fillColor}
            fillOpacity={frame.fillOpacity}
            stroke={strokeCol}
            strokeOpacity={frame.strokeOpacity}
            strokeWidth={strokeWidth}
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeDasharray={p.length}
            strokeDashoffset={frame.dashOffset}
            vectorEffect={p.nonScalingStroke ? 'non-scaling-stroke' : undefined}
          />
        );
      })}
    </g>
  );
};
