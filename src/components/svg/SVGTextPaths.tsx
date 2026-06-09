import React, { useEffect, useMemo, useRef, useState, memo } from 'react';
import type { TextElement } from '../../types/presentation';
import { TEXT_BOX_PADDING } from '../../utils/constants';
import { layoutSvgText, type SvgTextDoc } from '../../utils/textLayout';
import { SVGTextContent } from './SVGTextContent';

interface Props {
  element: TextElement;
  isEditing?: boolean;
  opacity?: number;
  clipIdPrefix?: string;
}

/**
 * Renders a text element as native SVG (no <foreignObject>): text glyphs as
 * <text> elements, math glyphs as MathJax-emitted <path>s. Replaces
 * SVGTextContent on every non-editing render path.
 *
 * While the layout promise is pending (first MathJax load, first time a unique
 * text+style appears), falls back to SVGTextContent so playback is never blank.
 * If the layout rejects, also falls back. This makes the swap safe: any case
 * that fails in SVGTextPaths still renders via the old HTML path.
 */
export const SVGTextPaths: React.FC<Props> = memo(({
  element,
  isEditing = false,
  opacity = 1,
  clipIdPrefix = 'text-clip',
}) => {
  if (isEditing) return null;

  const { style, x: elementX, y: elementY, width, height, rotation, text } = element;
  const padding = TEXT_BOX_PADDING;
  const bottomOverflow = 500;
  const clipId = `${clipIdPrefix}-${element.id}`;

  const cx = elementX + width / 2;
  const cy = elementY + height / 2;
  const transform = rotation ? `rotate(${rotation}, ${cx}, ${cy})` : undefined;

  const layoutPromise = useMemo(
    () => layoutSvgText(text || '', style, Math.max(1, width - padding * 2), false),
    // Deps cover everything the layout cache key depends on.
    [text, style.fontFamily, style.fontSize, style.fontWeight, style.fontStyle,
     style.color, style.lineHeight, style.align, width, padding],
  );

  const [doc, setDoc] = useState<SvgTextDoc | null>(null);
  const [failed, setFailed] = useState(false);
  const innerGRef = useRef<SVGGElement>(null);

  useEffect(() => {
    let cancelled = false;
    setFailed(false);
    setDoc(null);
    layoutPromise.then(
      (d) => { if (!cancelled) setDoc(d); },
      (err) => {
        if (!cancelled) {
          console.warn('[SVGTextPaths] layout failed; falling back to SVGTextContent', err);
          setFailed(true);
        }
      },
    );
    return () => { cancelled = true; };
  }, [layoutPromise]);

  // Drop the rendered markup into the inner <g> via innerHTML once layout settles.
  useEffect(() => {
    const g = innerGRef.current;
    if (!g) return;
    g.innerHTML = doc?.svgMarkup ?? '';
  }, [doc?.svgMarkup]);

  // Fallback path: while pending OR if layout failed, render via the old HTML
  // path so the user never sees blank content. Once the SVG layout resolves we
  // swap to the path-based render.
  if (failed || !doc) {
    return (
      <SVGTextContent
        element={element}
        isEditing={isEditing}
        opacity={opacity}
        clipIdPrefix={clipIdPrefix}
      />
    );
  }

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
          <g ref={innerGRef} />
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
    a.style.lineHeight === b.style.lineHeight
  );
});
