import { SVGStrokeCoverage } from './SVGStrokeCoverage';
import type { NativeStrokePlan } from '../../utils/nativeStrokePlan';
import React, { useId } from 'react';
import { SVGStrokeClip } from './SVGStrokeClip';
import type { WriteEffect } from '../../utils/interpolation';
import { parsePaintColor } from '../../utils/paintColor';

/** One renderable SVG path used by every glyph/path-based animation. */
export interface SvgPath {
  d: string;
  /** Original fill region; terminal consumption affects only stroke coverage. */
  fillD?: string;
  strokePlan?: NativeStrokePlan | null;
  fillRule?: 'evenodd' | 'nonzero';
  /** Vector paint roles share one non-staggered Create clock. */
  createRole?: 'fill' | 'stroke';
  /** Shared shaft-only cuts; glyph paths never carry these. */
  shaftClipPaths?: string[];
  transform: string;
  /** Total path length used both for budget calculations and as the
   *  stroke-dasharray value. In SCREEN-pixel space. */
  length: number;
  /** Fill colour applied during the FILL phase. */
  fillColor: string;
  /** Independent topology paint alpha, multiplied by animation/colour alpha. */
  fillOpacity?: number;
  /** Source colour when fillColor is a paint-server URL (e.g. hatch).
   *  Used only to detect visible fill; never replaces the remembered RGB. */
  fillSourceColor?: string;
  /** Actual shape stroke, or glyph reveal stroke. Defaults to `fillColor`
   *  for text. Shape input picking consumes this paint, not the tracing pen. */
  strokeColor?: string;
  /** Create may trace a fill-only shape before filling it. This pen paint
   *  must not manufacture a stroke in steady rendering or input geometry. */
  traceStrokeColor?: string;
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
  /** When false (open path / no fillable area), the FILL phase keeps the
   *  stroke at full opacity instead of fading it out. Without this, an
   *  open line would go invisible at t=1 — there's nothing to fill — and
   *  reappear one frame later when the steady RenderShape takes over,
   *  causing a one-frame flicker. */
  hasFill = true,
): { dashOffset: number; fillOpacity: number; strokeOpacity: number } {
  const REVEAL_END = 0.7;
  const startT = glyphIndex * lag;
  const localT = Math.max(0, Math.min(1, (T - startT) / glyphSpan));
  if (localT <= 0) return { dashOffset: pathLength, fillOpacity: 0, strokeOpacity: 0 };
  if (localT < REVEAL_END) {
    const ph = localT / REVEAL_END;
    return { dashOffset: pathLength * (1 - ph), fillOpacity: 0, strokeOpacity: 1 };
  }
  if (!hasFill) {
    return { dashOffset: 0, fillOpacity: 0, strokeOpacity: 1 };
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
  const coverageId = useId();
  const T = writeFx ? writeFx.t : Number.POSITIVE_INFINITY;
  const mode: WriteEffect['mode'] = writeFx?.mode ?? 'write';
  const N = paths.length;
  const glyphSpan = mode === 'fadebyglyph' ? 0.5 : 0.5;
  const lag = writeFx && N > 1 ? (1 - glyphSpan) / (N - 1) : 0;

  return (
    <g>
      {paths.map((p, i) => {
        let frame;
        if (mode === 'create' && p.createRole) {
          // Outline first; paint regions may close contours for fill, but those
          // closing edges are never traced. Stroke paint remains after reveal.
          const reveal = Math.max(0, Math.min(1, T / 0.7));
          frame = {
            dashOffset: p.createRole === 'stroke' ? p.length * (1 - reveal) : 0,
            fillOpacity: p.createRole === 'fill' ? Math.max(0, Math.min(1, (T - 0.7) / 0.3)) : 0,
            strokeOpacity: p.createRole === 'stroke' && T > 0 ? 1 : 0,
          };
        } else switch (mode) {
          case 'typewriter':
            frame = typewriterGlyphFrame(i, T, N);
            break;
          case 'fadebyglyph':
            frame = fadeByGlyphFrame(i, lag, T, glyphSpan);
            break;
          case 'write':
          case 'create':
          default: {
            // Zero-alpha paint has no visible fill, even when represented by
            // a hatch URL. Hold the stroke just as for a no-colour sentinel.
            const hasFill = (parsePaintColor(p.fillSourceColor ?? p.fillColor)?.a ?? 1) > 0;
            frame = writeGlyphFrame(p.length, i, lag, T, glyphSpan, hasFill);
            break;
          }
        }
        const separateFill = !!p.strokePlan || !!p.shaftClipPaths?.length || p.fillD !== undefined;
        const strokeCol = p.traceStrokeColor ?? p.strokeColor ?? p.fillColor;
        return (
          <g key={i} transform={p.transform || undefined}>
          {separateFill && (
            <path d={p.fillD ?? p.d} fill={p.fillColor} fillOpacity={frame.fillOpacity * (p.fillOpacity ?? 1)} stroke="none" />
          )}
          <SVGStrokeClip paths={p.shaftClipPaths ?? []}>
          {p.strokePlan ? <SVGStrokeCoverage plan={p.strokePlan} color={strokeCol} width={strokeWidth}
            dash={p.length} offset={frame.dashOffset} opacity={frame.strokeOpacity} instanceId={`${coverageId}-${i}`} /> : <path
            d={p.d}
            fillRule={p.fillRule}
            fill={separateFill ? 'none' : p.fillColor}
            fillOpacity={frame.fillOpacity * (p.fillOpacity ?? 1)}
            stroke={strokeCol}
            strokeOpacity={frame.strokeOpacity}
            strokeWidth={strokeWidth}
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeDasharray={p.length}
            strokeDashoffset={frame.dashOffset}
            vectorEffect={p.nonScalingStroke ? 'non-scaling-stroke' : undefined}
          />}
          </SVGStrokeClip>
          </g>
        );
      })}
    </g>
  );
};
