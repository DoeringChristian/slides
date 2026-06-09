import React, { useEffect, useMemo, useState, memo } from 'react';
import type { TextElement } from '../../types/presentation';
import type { WriteEffect } from '../../utils/interpolation';
import { TEXT_BOX_PADDING } from '../../utils/constants';
import { layoutSvgText, type SvgTextDoc } from '../../utils/textLayout';
import { prewarmFonts } from '../../utils/glyphPaths';
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
