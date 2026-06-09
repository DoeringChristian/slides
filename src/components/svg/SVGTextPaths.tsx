import React, { useEffect, useMemo, useState, memo } from 'react';
import type { TextElement } from '../../types/presentation';
import type { WriteEffect } from '../../utils/interpolation';
import { TEXT_BOX_PADDING } from '../../utils/constants';
import { layoutSvgText, type SvgTextDoc, type SvgPath } from '../../utils/textLayout';
import { prewarmFonts } from '../../utils/glyphPaths';
import { SVGTextContent } from './SVGTextContent';

// Pre-warm Inter fonts so the first transition doesn't burn its window on the
// font fetch + parse (~100-300ms).
prewarmFonts();

/**
 * Compute (fillOpacity, strokeOpacity, dashOffset) for a single glyph at the
 * given progress. The "steady" frame is just `writeFx = undefined` — which
 * we represent by feeding T=Infinity so every glyph lands in the FILL phase
 * with fillOpacity=1, no stroke. One rendering pipeline, no drift.
 */
function glyphFrame(
  pathLength: number,
  glyphIndex: number,
  lag: number,
  T: number,
  glyphSpan: number,
  REVEAL_END: number,
): { dashOffset: number; fillOpacity: number; strokeOpacity: number } {
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
 * Per-glyph render. Used for BOTH the steady frame and the in-flight Write
 * transition — same pipeline, no second renderer. Modelled on manim's `Write`:
 * each glyph runs a staggered two-phase animation.
 *
 *   REVEAL (~70% of the glyph's window): a thin pen traces the outline.
 *   FILL  (~30%): stroke fades, fill ramps 0 → 1. End state: solid filled glyph.
 *
 * For `writeFx = undefined` (steady), every glyph is at localT=1 → full fill,
 * no stroke. That's just what the manim animation lands on at t=1, so the
 * transition end-state matches the steady frame exactly.
 */
const RenderPaths: React.FC<{ paths: SvgPath[]; totalLength: number; writeFx?: WriteEffect; fontSize: number }> = ({ paths, writeFx, fontSize }) => {
  const T = writeFx ? writeFx.t : Number.POSITIVE_INFINITY;
  const N = paths.length;
  const glyphSpan = 0.5;
  const lag = writeFx && N > 1 ? (1 - glyphSpan) / (N - 1) : 0;
  const REVEAL_END = 0.7;
  const strokeWidth = Math.max(1.2, fontSize / 20);

  return (
    <g>
      {paths.map((p, i) => {
        const { dashOffset, fillOpacity, strokeOpacity } = glyphFrame(p.length, i, lag, T, glyphSpan, REVEAL_END);
        return (
          <path
            key={i}
            d={p.d}
            transform={p.transform}
            fill={p.fillColor}
            fillOpacity={fillOpacity}
            stroke={p.fillColor}
            strokeOpacity={strokeOpacity}
            strokeWidth={strokeWidth}
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeDasharray={p.length}
            strokeDashoffset={dashOffset}
            vectorEffect={p.nonScalingStroke ? 'non-scaling-stroke' : undefined}
          />
        );
      })}
    </g>
  );
};

interface Props {
  element: TextElement;
  isEditing?: boolean;
  opacity?: number;
  clipIdPrefix?: string;
  writeFx?: WriteEffect;
}

/**
 * Renders a text element as native SVG paths via opentype.js (Inter) for plain
 * text and MathJax SVG-output paths for math. Single pipeline used for both
 * the steady frame and the in-flight Write transition — at writeFx=undefined
 * every glyph is at localT=1 (full fill, no stroke), which is exactly what
 * the animation lands on at t=1. No drift possible.
 *
 * Fallback: if the layout promise rejects (font fetch fail, MathJax error)
 * we render via the old SVGTextContent path so the deck stays playable.
 */
export const SVGTextPaths: React.FC<Props> = memo(({
  element,
  isEditing = false,
  opacity = 1,
  clipIdPrefix = 'text-clip',
  writeFx,
}) => {
  if (isEditing) return null;

  const { style, x: elementX, y: elementY, width, height, rotation } = element;
  const padding = TEXT_BOX_PADDING;
  const bottomOverflow = 500;
  const clipId = `${clipIdPrefix}-${element.id}`;

  const cx = elementX + width / 2;
  const cy = elementY + height / 2;
  const transform = rotation ? `rotate(${rotation}, ${cx}, ${cy})` : undefined;

  const layoutPromise = useMemo(
    () => layoutSvgText(element.text || '', style, Math.max(1, width - padding * 2)),
    [element.text, style.fontSize, style.fontWeight, style.fontStyle,
     style.color, style.lineHeight, style.align, width, padding],
  );

  const [doc, setDoc] = useState<SvgTextDoc | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setFailed(false);
    setDoc(null);
    layoutPromise.then(
      (d) => { if (!cancelled) setDoc(d); },
      (err) => {
        if (!cancelled) {
          console.warn('[SVGTextPaths] layout failed, falling back to SVGTextContent', err);
          setFailed(true);
        }
      },
    );
    return () => { cancelled = true; };
  }, [layoutPromise]);

  if (failed) {
    return (
      <SVGTextContent
        element={element}
        isEditing={isEditing}
        opacity={opacity}
        clipIdPrefix={clipIdPrefix}
      />
    );
  }

  // While layout pending: render nothing. For a Write transition that matches
  // t=0 anyway. For steady frame on first paint, a brief blank during font
  // load — fonts are pre-warmed so this is usually one frame.
  if (!doc) return null;

  // Vertical alignment offset within the box.
  let verticalOffset = 0;
  if (style.verticalAlign === 'middle') {
    verticalOffset = Math.max(0, (height - padding * 2 - doc.height) / 2);
  } else if (style.verticalAlign === 'bottom') {
    verticalOffset = Math.max(0, height - padding * 2 - doc.height);
  }

  return (
    <g transform={transform} style={{ pointerEvents: 'none' }}>
      <defs>
        <clipPath id={clipId}>
          <rect
            x={elementX + padding}
            y={elementY + padding}
            width={width - padding * 2}
            height={height - padding * 2 + bottomOverflow}
          />
        </clipPath>
      </defs>
      <g clipPath={`url(#${clipId})`}>
        <g
          transform={`translate(${elementX + padding}, ${elementY + padding + verticalOffset})`}
          opacity={opacity}
        >
          <RenderPaths paths={doc.paths} totalLength={doc.totalLength} writeFx={writeFx} fontSize={style.fontSize} />
        </g>
      </g>
    </g>
  );
}, (prev, next) => {
  const a = prev.element;
  const b = next.element;
  return (
    prev.isEditing === next.isEditing &&
    prev.opacity === next.opacity &&
    prev.clipIdPrefix === next.clipIdPrefix &&
    a.text === b.text &&
    a.width === b.width &&
    a.height === b.height &&
    a.x === b.x &&
    a.y === b.y &&
    a.rotation === b.rotation &&
    a.style.fontSize === b.style.fontSize &&
    a.style.fontFamily === b.style.fontFamily &&
    a.style.fontWeight === b.style.fontWeight &&
    a.style.fontStyle === b.style.fontStyle &&
    a.style.color === b.style.color &&
    a.style.align === b.style.align &&
    a.style.verticalAlign === b.style.verticalAlign &&
    a.style.lineHeight === b.style.lineHeight &&
    prev.writeFx?.t === next.writeFx?.t &&
    prev.writeFx?.direction === next.writeFx?.direction
  );
});
