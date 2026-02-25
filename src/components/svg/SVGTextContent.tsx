import React, { useMemo, memo } from 'react';
import katex from 'katex';
import type { TextElement } from '../../types/presentation';
import { parseBlocks, parseInlineSegments, getBlockFontMultiplier, type ParsedBlock, type InlineSegment } from '../canvas/CustomMarkdownRenderer';
import { TEXT_BOX_PADDING } from '../../utils/constants';

interface Props {
  element: TextElement;
  isEditing?: boolean;
}

// Render LaTeX to HTML string
function renderLatex(latex: string, displayMode: boolean = false): string {
  try {
    return katex.renderToString(latex, {
      displayMode,
      throwOnError: false,
      output: 'html',
    });
  } catch {
    return latex;
  }
}

// Render text block as HTML for foreignObject
function renderBlockAsHtml(_block: ParsedBlock, segments: InlineSegment[]): string {
  return segments.map((segment) => {
    if (segment.type === 'latex') {
      return renderLatex(segment.displayContent, segment.isBlock);
    }
    if (segment.type === 'link') {
      const escaped = segment.displayContent
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
      return `<span style="color:#2563eb;text-decoration:underline">${escaped}</span>`;
    }
    if (segment.type === 'formatted') {
      let style = '';
      if (segment.bold) style += 'font-weight:bold;';
      if (segment.italic) style += 'font-style:italic;';
      if (segment.strikethrough) style += 'text-decoration:line-through;';
      if (segment.underline) style += 'text-decoration:underline;';
      const escaped = segment.displayContent
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
      return `<span style="${style}">${escaped}</span>`;
    }
    // Plain text - escape HTML
    return segment.displayContent
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }).join('');
}

export const SVGTextContent: React.FC<Props> = memo(({
  element,
  isEditing = false,
}) => {
  // Don't render SVG text when editing - the HTML editor overlay handles it
  if (isEditing) return null;

  const { text, style, x: elementX, y: elementY, width, height, rotation } = element;

  // Parse text into blocks and segments - memoized to only update when text changes
  const blocksWithHtml = useMemo(() => {
    const blocks = parseBlocks(text || '');
    return blocks.map(block => {
      const segments = parseInlineSegments(block.displayContent, block.sourceStart + block.prefixLength);
      return {
        block,
        html: renderBlockAsHtml(block, segments),
      };
    });
  }, [text]);

  // Build complete HTML content - memoized based on text and style
  const htmlContent = useMemo(() => {
    const lineHeight = style.lineHeight || 1.2;

    return blocksWithHtml.map(({ block, html }) => {
      const multiplier = getBlockFontMultiplier(block.type);
      const fontSize = style.fontSize * multiplier;
      const isHeader = block.type === 'h1' || block.type === 'h2' || block.type === 'h3';
      const fontWeight = isHeader ? 'bold' : style.fontWeight;

      return `<div style="font-size:${fontSize}px;font-weight:${fontWeight};line-height:${lineHeight};min-height:${fontSize * lineHeight}px;margin:0;padding:0;">${html || '&nbsp;'}</div>`;
    }).join('');
  }, [blocksWithHtml, style.fontSize, style.fontWeight, style.lineHeight]);

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

  return (
    <g transform={transform} style={{ pointerEvents: 'none' }}>
      <foreignObject
        x={elementX + padding}
        y={elementY + padding}
        width={width - padding * 2}
        height={height - padding * 2}
      >
        <div
          style={{
            width: '100%',
            height: '100%',
            fontFamily: style.fontFamily,
            fontStyle: style.fontStyle,
            color: style.color,
            textAlign: style.align,
            wordWrap: 'break-word',
            overflowWrap: 'break-word',
            whiteSpace: 'pre-wrap',
            overflow: 'hidden',
            userSelect: 'none',
            ...verticalAlignStyle,
          }}
          dangerouslySetInnerHTML={{ __html: htmlContent }}
        />
      </foreignObject>
    </g>
  );
}, (prevProps, nextProps) => {
  // Custom comparison - only re-render when these specific properties change
  const prev = prevProps.element;
  const next = nextProps.element;

  return (
    prevProps.isEditing === nextProps.isEditing &&
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
