import React, { useEffect, useMemo, useState, memo } from 'react';
import type { TextElement } from '../../types/presentation';
import type { WriteEffect } from '../../utils/interpolation';
import { textInsets, textInkOverflow } from '../../utils/boundTextLayout';
import { layoutSvgText, textVerticalOffset, type SvgTextDoc } from '../../utils/textLayout';
import { prewarmFonts } from '../../utils/glyphPaths';
import { layoutUserText } from '../../utils/userTextSizing';
import { RenderPaths } from './RenderPaths';
import { SVGTextContent } from './SVGTextContent';

// Pre-warm Inter fonts so the first transition doesn't burn its window on the
// font fetch + parse (~100-300ms).
prewarmFonts();

interface Props {
  element: TextElement;
  isEditing?: boolean;
  opacity?: number;
  clipIdPrefix?: string;
  writeFx?: WriteEffect;
  /** Edit-overlay use case: these source-line indices are laid out as RAW
   *  source text (markdown delimiters visible, no math/segment processing) so
   *  the user can see and edit the markup. The line still uses the same font,
   *  weight, and baseline as a formatted line — only the content differs. */
  rawLineIndices?: Set<number>;
  /** Called once whenever the layout finishes (or replaces). The edit overlay
   *  uses the doc's per-line metrics to size its contentEditable line divs to
   *  match the rendered glyph positions exactly. */
  onLayout?: (doc: SvgTextDoc) => void;
  /** Extra cushion (px) added around the clip rect. Defaults to a small
   *  cushion for bound labels and explicit free sizing (whose box hugs text, so glyph
   *  ink that overhangs its advance width — italics, LaTeX radicals,
   *  descenders — would otherwise get shaved). */
  clipPadding?: number;
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
  rawLineIndices,
  onLayout,
  clipPadding,
}) => {
  const { style, x: elementX, y: elementY, width, height, rotation } = element;
  const padding = textInsets(element);
  const clipPad = clipPadding ?? textInkOverflow(element);
  const bottomOverflow = 500;
  const clipId = `${clipIdPrefix}-${element.id}`;

  const cx = elementX + width / 2;
  const cy = elementY + height / 2;
  const transform = rotation ? `rotate(${rotation}, ${cx}, ${cy})` : undefined;

  // Stable rawLineIndices key for the memo. Sets aren't structurally compared.
  const rawKey = rawLineIndices && rawLineIndices.size > 0
    ? Array.from(rawLineIndices).sort((a, b) => a - b).join(',')
    : '';

  const layoutPromise = useMemo(
    () => element.textSizing === 'auto-content' && !element.containerId
      ? layoutUserText(element, rawLineIndices)
      : layoutSvgText(element.text || '', style, Math.max(1, width - padding * 2), rawLineIndices),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [element.text, style.fontSize, style.fontWeight, style.fontStyle,
     style.color, style.fontFamily, style.textDecoration, style.lineHeight, style.align, width, padding, rawKey, element.textSizing, element.containerId],
  );

  const [doc, setDoc] = useState<SvgTextDoc | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setFailed(false);
    setDoc(null);
    layoutPromise.then(
      (d) => { if (!cancelled) { setDoc(d); onLayout?.(d); } },
      (err) => {
        if (!cancelled) {
          console.warn('[SVGTextPaths] layout failed, falling back to SVGTextContent', err);
          setFailed(true);
        }
      },
    );
    return () => { cancelled = true; };
  }, [layoutPromise]);

  // Don't render SVG text when editing — the HTML editor overlay handles it.
  // (Checked after the hooks so hook order stays stable if isEditing toggles.)
  if (isEditing) return null;

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

  // Vertical alignment offset within the box (shared helper so RenderMorph
  // and hit-testing agree with the renderer).
  const verticalOffset = textVerticalOffset(style.verticalAlign, height, padding, doc.height);

  return (
    <g transform={transform} style={{ pointerEvents: 'none' }}>
      <defs>
        <clipPath id={clipId}>
          <rect
            x={elementX + padding - clipPad}
            y={elementY + padding - clipPad}
            width={width - padding * 2 + clipPad * 2}
            height={height - padding * 2 + clipPad * 2 + bottomOverflow}
          />
        </clipPath>
      </defs>
      <g clipPath={`url(#${clipId})`}>
        <g
          transform={`translate(${elementX + padding}, ${elementY + padding + verticalOffset})`}
          opacity={opacity}
        >
          <RenderPaths paths={doc.paths} writeFx={writeFx} strokeWidth={Math.max(1.2, style.fontSize / 20)} />
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
    prev.clipPadding === next.clipPadding &&
    a.containerId === b.containerId &&
    a.textSizing === b.textSizing &&
    a.boundTextLayout === b.boundTextLayout &&
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
    prev.writeFx?.direction === next.writeFx?.direction &&
    setsEqual(prev.rawLineIndices, next.rawLineIndices)
  );
});

function setsEqual(a: Set<number> | undefined, b: Set<number> | undefined): boolean {
  if (a === b) return true;
  if (!a || !b) return (a?.size ?? 0) === 0 && (b?.size ?? 0) === 0;
  if (a.size !== b.size) return false;
  for (const v of a) if (!b.has(v)) return false;
  return true;
}
