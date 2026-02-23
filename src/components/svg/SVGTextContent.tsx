import React, { useMemo, memo } from 'react';
import katex from 'katex';
import type { TextElement } from '../../types/presentation';
import { parseBlocks, parseInlineSegments, getBlockFontMultiplier, type ParsedBlock, type InlineSegment } from '../canvas/CustomMarkdownRenderer';
import { TEXT_BOX_PADDING } from '../../utils/constants';

interface Props {
  element: TextElement;
  isEditing?: boolean;
}

// Convert alignment to SVG text-anchor
function getTextAnchor(align: 'left' | 'center' | 'right'): 'start' | 'middle' | 'end' {
  switch (align) {
    case 'center': return 'middle';
    case 'right': return 'end';
    default: return 'start';
  }
}

// Get X position based on alignment
function getAlignedX(align: 'left' | 'center' | 'right', elementX: number, width: number, padding: number): number {
  switch (align) {
    case 'center': return elementX + width / 2;
    case 'right': return elementX + width - padding;
    default: return elementX + padding;
  }
}

// Render LaTeX to HTML string for foreignObject
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

// Render a single inline segment as SVG tspan or foreignObject
interface SegmentRenderProps {
  segment: InlineSegment;
  baseStyle: {
    fontFamily: string;
    fontSize: number;
    fontWeight: 'normal' | 'bold';
    fontStyle: 'normal' | 'italic';
    fill: string;
  };
}

const renderSegment = ({ segment, baseStyle }: SegmentRenderProps): React.ReactNode => {
  if (segment.type === 'latex') {
    // LaTeX will be rendered via foreignObject in a separate pass
    // For now, return a placeholder tspan
    return null; // Handled separately
  }

  if (segment.type === 'link') {
    return (
      <tspan
        key={`${segment.sourceStart}-link`}
        fill="#2563eb"
        textDecoration="underline"
        style={{ cursor: 'pointer' }}
      >
        {segment.displayContent}
      </tspan>
    );
  }

  if (segment.type === 'formatted') {
    let fontWeight = baseStyle.fontWeight;
    let fontStyle = baseStyle.fontStyle;
    let textDecoration: string | undefined;

    if (segment.bold) fontWeight = 'bold';
    if (segment.italic) fontStyle = 'italic';
    if (segment.strikethrough) textDecoration = 'line-through';
    if (segment.underline) textDecoration = 'underline';

    return (
      <tspan
        key={`${segment.sourceStart}-formatted`}
        fontWeight={fontWeight}
        fontStyle={fontStyle}
        textDecoration={textDecoration}
      >
        {segment.displayContent}
      </tspan>
    );
  }

  // Plain text
  return (
    <tspan key={`${segment.sourceStart}-text`}>
      {segment.displayContent}
    </tspan>
  );
};

// Check if a block contains LaTeX
function hasLatex(segments: InlineSegment[]): boolean {
  return segments.some(s => s.type === 'latex');
}

// Render a line of text as SVG
interface LineRenderProps {
  block: ParsedBlock;
  segments: InlineSegment[];
  x: number;
  y: number;
  baseStyle: {
    fontFamily: string;
    fontSize: number;
    fontWeight: 'normal' | 'bold';
    fontStyle: 'normal' | 'italic';
    fill: string;
  };
  textAnchor: 'start' | 'middle' | 'end';
  lineHeight: number;
  elementX: number;
  elementWidth: number;
}

const SVGTextLine: React.FC<LineRenderProps> = memo(({
  block,
  segments,
  x,
  y,
  baseStyle,
  textAnchor,
  lineHeight,
  elementX,
  elementWidth,
}) => {
  const multiplier = getBlockFontMultiplier(block.type);
  const fontSize = baseStyle.fontSize * multiplier;
  const isHeader = block.type === 'h1' || block.type === 'h2' || block.type === 'h3';
  const fontWeight = isHeader ? 'bold' : baseStyle.fontWeight;

  // Check if this line has LaTeX - if so, use foreignObject
  if (hasLatex(segments)) {
    // Build HTML content with LaTeX
    const htmlContent = segments.map((segment) => {
      if (segment.type === 'latex') {
        return renderLatex(segment.displayContent, segment.isBlock);
      }
      if (segment.type === 'link') {
        return `<span style="color:#2563eb;text-decoration:underline">${segment.displayContent}</span>`;
      }
      if (segment.type === 'formatted') {
        let style = '';
        if (segment.bold) style += 'font-weight:bold;';
        if (segment.italic) style += 'font-style:italic;';
        if (segment.strikethrough) style += 'text-decoration:line-through;';
        if (segment.underline) style += 'text-decoration:underline;';
        return `<span style="${style}">${segment.displayContent}</span>`;
      }
      return segment.displayContent;
    }).join('');

    const padding = TEXT_BOX_PADDING;
    const foWidth = elementWidth - padding * 2;
    const foHeight = fontSize * lineHeight;

    return (
      <foreignObject
        x={elementX + padding}
        y={y - fontSize * 0.8} // Adjust for baseline
        width={foWidth}
        height={foHeight}
      >
        <div
          style={{
            fontFamily: baseStyle.fontFamily,
            fontSize: `${fontSize}px`,
            fontWeight,
            fontStyle: baseStyle.fontStyle,
            color: baseStyle.fill,
            lineHeight: lineHeight,
            textAlign: textAnchor === 'middle' ? 'center' : textAnchor === 'end' ? 'right' : 'left',
          }}
          dangerouslySetInnerHTML={{ __html: htmlContent }}
        />
      </foreignObject>
    );
  }

  // No LaTeX - render as pure SVG text
  return (
    <text
      x={x}
      y={y}
      fontFamily={baseStyle.fontFamily}
      fontSize={fontSize}
      fontWeight={fontWeight}
      fontStyle={baseStyle.fontStyle}
      fill={baseStyle.fill}
      textAnchor={textAnchor}
      dominantBaseline="auto"
    >
      {segments.map((segment) => renderSegment({ segment, baseStyle: { ...baseStyle, fontSize, fontWeight } }))}
    </text>
  );
});

export const SVGTextContent: React.FC<Props> = memo(({
  element,
  isEditing = false,
}) => {
  // Don't render SVG text when editing - the HTML editor overlay handles it
  if (isEditing) return null;

  const { text, style, x: elementX, y: elementY, width, height, rotation } = element;

  // Parse text into blocks
  const blocks = useMemo(() => parseBlocks(text || ''), [text]);

  // Parse inline segments for each block
  const blocksWithSegments = useMemo(() => {
    return blocks.map(block => ({
      block,
      segments: parseInlineSegments(block.displayContent, block.sourceStart + block.prefixLength),
    }));
  }, [blocks]);

  // Calculate line heights and total content height
  const lineData = useMemo(() => {
    const lineHeight = style.lineHeight || 1.2;
    let totalHeight = 0;
    const lines: { block: ParsedBlock; segments: InlineSegment[]; height: number; fontSize: number }[] = [];

    for (const { block, segments } of blocksWithSegments) {
      const multiplier = getBlockFontMultiplier(block.type);
      const fontSize = style.fontSize * multiplier;
      const height = fontSize * lineHeight;
      lines.push({ block, segments, height, fontSize });
      totalHeight += height;
    }

    return { lines, totalHeight, lineHeight };
  }, [blocksWithSegments, style.fontSize, style.lineHeight]);

  // Calculate starting Y based on vertical alignment
  const startY = useMemo(() => {
    const padding = TEXT_BOX_PADDING;
    const contentHeight = height - padding * 2;
    const { totalHeight } = lineData;

    switch (style.verticalAlign) {
      case 'middle':
        return elementY + padding + (contentHeight - totalHeight) / 2;
      case 'bottom':
        return elementY + padding + contentHeight - totalHeight;
      default: // top
        return elementY + padding;
    }
  }, [elementY, height, lineData, style.verticalAlign]);

  // Get text anchor and X position
  const textAnchor = getTextAnchor(style.align);
  const alignedX = getAlignedX(style.align, elementX, width, TEXT_BOX_PADDING);

  // Base style for text
  const baseStyle = useMemo(() => ({
    fontFamily: style.fontFamily,
    fontSize: style.fontSize,
    fontWeight: style.fontWeight,
    fontStyle: style.fontStyle,
    fill: style.color,
  }), [style.fontFamily, style.fontSize, style.fontWeight, style.fontStyle, style.color]);

  // Rotation transform
  const cx = elementX + width / 2;
  const cy = elementY + height / 2;
  const transform = rotation ? `rotate(${rotation}, ${cx}, ${cy})` : undefined;

  // Render each line
  let currentY = startY;

  return (
    <g transform={transform} style={{ pointerEvents: 'none' }}>
      {lineData.lines.map(({ block, segments, height, fontSize }, index) => {
        // Position at baseline (adjust Y for SVG text baseline)
        const lineY = currentY + fontSize * 0.85; // Approximate baseline position
        currentY += height;

        return (
          <SVGTextLine
            key={index}
            block={block}
            segments={segments}
            x={alignedX}
            y={lineY}
            baseStyle={baseStyle}
            textAnchor={textAnchor}
            lineHeight={lineData.lineHeight}
            elementX={elementX}
            elementWidth={width}
          />
        );
      })}
    </g>
  );
});
