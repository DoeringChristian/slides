import React, { useMemo, memo } from 'react';
import type { TextElement } from '../../types/presentation';
import { renderMarkdownToHtml, containerStyleForMarkdown } from '../canvas/CustomMarkdownRenderer';
import { TEXT_BOX_PADDING } from '../../utils/constants';

interface Props {
  element: TextElement;
  isEditing?: boolean;
  opacity?: number;
  clipIdPrefix?: string;
}

export const SVGTextContent: React.FC<Props> = memo(({
  element,
  isEditing = false,
  opacity = 1,
  clipIdPrefix = 'text-clip',
}) => {
  // Don't render SVG text when editing - the HTML editor overlay handles it
  if (isEditing) return null;

  const { text, style, x: elementX, y: elementY, width, height, rotation } = element;

  // Build complete HTML content using the shared renderer (zoom=1: SVG handles scaling)
  const htmlContent = useMemo(() => renderMarkdownToHtml(text || '', style, 1), [text, style]);
  const sharedContainerStyle = useMemo(() => containerStyleForMarkdown(style), [style]);

  // Calculate vertical alignment offset
  const verticalAlignStyle = useMemo(() => {
    switch (style.verticalAlign) {
      case 'middle':
        return { display: 'flex', flexDirection: 'column' as const, justifyContent: 'center' };
      case 'bottom':
        return { display: 'flex', flexDirection: 'column' as const, justifyContent: 'flex-end' };
      default:
        return {};
    }
  }, [style.verticalAlign]);

  // Rotation transform
  const cx = elementX + width / 2;
  const cy = elementY + height / 2;
  const transform = rotation ? `rotate(${rotation}, ${cx}, ${cy})` : undefined;

  const padding = TEXT_BOX_PADDING;

  // Allow text to overflow the bottom edge by extending foreignObject
  const bottomOverflow = 500;
  const clipId = `${clipIdPrefix}-${element.id}`;

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
        <foreignObject
          x={elementX + padding}
          y={elementY + padding}
          width={width - padding * 2}
          height={height - padding * 2 + bottomOverflow}
        >
          <div
            style={{
              width: '100%',
              height: height - padding * 2,
              ...sharedContainerStyle,
              overflow: 'visible',
              opacity,
              userSelect: 'none',
              ...verticalAlignStyle,
            }}
            dangerouslySetInnerHTML={{ __html: htmlContent }}
          />
        </foreignObject>
      </g>
    </g>
  );
}, (prevProps, nextProps) => {
  // Custom comparison - only re-render when these specific properties change
  const prev = prevProps.element;
  const next = nextProps.element;

  return (
    prevProps.isEditing === nextProps.isEditing &&
    prevProps.opacity === nextProps.opacity &&
    prevProps.clipIdPrefix === nextProps.clipIdPrefix &&
    prev.text === next.text &&
    prev.width === next.width &&
    prev.height === next.height &&
    prev.x === next.x &&
    prev.y === next.y &&
    prev.rotation === next.rotation &&
    prev.style.fontSize === next.style.fontSize &&
    prev.style.fontFamily === next.style.fontFamily &&
    prev.style.fontWeight === next.style.fontWeight &&
    prev.style.fontStyle === next.style.fontStyle &&
    prev.style.color === next.style.color &&
    prev.style.align === next.style.align &&
    prev.style.verticalAlign === next.style.verticalAlign &&
    prev.style.lineHeight === next.style.lineHeight
  );
});
