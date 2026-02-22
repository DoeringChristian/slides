import React, { useMemo, memo } from 'react';
import type { TextStyle } from '../../types/presentation';

interface Props {
  text: string;
  style: TextStyle;
  zoom: number;
}

export interface ParsedBlock {
  type: 'h1' | 'h2' | 'h3' | 'bullet' | 'numbered' | 'paragraph';
  content: string;
  displayContent: string;
  sourceStart: number;
  sourceEnd: number;
  prefixLength: number;
}

// Parse text into blocks with source position tracking
export function parseBlocks(text: string): ParsedBlock[] {
  const lines = text.split('\n');
  const blocks: ParsedBlock[] = [];
  let sourcePos = 0;

  for (const line of lines) {
    const sourceStart = sourcePos;
    const sourceEnd = sourcePos + line.length;

    let block: ParsedBlock;

    if (line.startsWith('### ')) {
      block = { type: 'h3', content: line, displayContent: line.slice(4), sourceStart, sourceEnd, prefixLength: 4 };
    } else if (line.startsWith('## ')) {
      block = { type: 'h2', content: line, displayContent: line.slice(3), sourceStart, sourceEnd, prefixLength: 3 };
    } else if (line.startsWith('# ')) {
      block = { type: 'h1', content: line, displayContent: line.slice(2), sourceStart, sourceEnd, prefixLength: 2 };
    } else if (/^[-*]\s/.test(line)) {
      block = { type: 'bullet', content: line, displayContent: line.slice(2), sourceStart, sourceEnd, prefixLength: 2 };
    } else if (/^\d+\.\s/.test(line)) {
      const match = line.match(/^(\d+\.\s)/);
      const prefixLength = match ? match[1].length : 3;
      block = { type: 'numbered', content: line, displayContent: line.slice(prefixLength), sourceStart, sourceEnd, prefixLength };
    } else {
      block = { type: 'paragraph', content: line, displayContent: line, sourceStart, sourceEnd, prefixLength: 0 };
    }

    blocks.push(block);
    sourcePos = sourceEnd + 1; // +1 for newline
  }

  return blocks;
}

// Get font size multiplier for block type
export function getBlockFontMultiplier(type: ParsedBlock['type']): number {
  switch (type) {
    case 'h1': return 2;
    case 'h2': return 1.5;
    case 'h3': return 1.25;
    default: return 1;
  }
}

// Memoized block renderer
const BlockRenderer = memo(({
  block,
  baseFontSize,
  baseStyle,
  lineHeight
}: {
  block: ParsedBlock;
  baseFontSize: number;
  baseStyle: React.CSSProperties;
  lineHeight: number;
}) => {
  const multiplier = getBlockFontMultiplier(block.type);
  const fontSize = baseFontSize * multiplier;
  const isHeader = block.type === 'h1' || block.type === 'h2' || block.type === 'h3';
  const isList = block.type === 'bullet' || block.type === 'numbered';

  const style: React.CSSProperties = {
    ...baseStyle,
    fontSize: `${fontSize}px`,
    fontWeight: isHeader ? 'bold' : baseStyle.fontWeight,
    minHeight: `${fontSize * lineHeight}px`,
    display: isList ? 'flex' : undefined,
  };

  if (block.type === 'bullet') {
    return (
      <div style={style}>
        <span style={{ marginRight: '0.5em', flexShrink: 0 }}>•</span>
        <span>{block.displayContent}</span>
      </div>
    );
  }

  if (block.type === 'numbered') {
    const num = block.content.match(/^(\d+)\./)?.[1] || '1';
    return (
      <div style={style}>
        <span style={{ marginRight: '0.5em', flexShrink: 0 }}>{num}.</span>
        <span>{block.displayContent}</span>
      </div>
    );
  }

  // Headers and paragraphs
  return (
    <div style={style}>
      {block.displayContent || <br />}
    </div>
  );
});

export const CustomMarkdownRenderer: React.FC<Props> = memo(({ text, style, zoom }) => {
  const blocks = useMemo(() => parseBlocks(text), [text]);

  const baseFontSize = style.fontSize * zoom;
  const lineHeight = style.lineHeight || 1.2;

  const baseStyle = useMemo((): React.CSSProperties => ({
    fontFamily: style.fontFamily,
    fontWeight: style.fontWeight,
    fontStyle: style.fontStyle,
    color: style.color,
    textAlign: style.align,
    lineHeight: lineHeight,
    textDecoration: style.textDecoration === 'none' ? undefined : style.textDecoration,
  }), [style.fontFamily, style.fontWeight, style.fontStyle, style.color, style.align, lineHeight, style.textDecoration]);

  return (
    <div className="custom-markdown-content" style={{ padding: `${4 * zoom}px` }}>
      {blocks.map((block, index) => (
        <BlockRenderer
          key={index}
          block={block}
          baseFontSize={baseFontSize}
          baseStyle={baseStyle}
          lineHeight={lineHeight}
        />
      ))}
    </div>
  );
});
