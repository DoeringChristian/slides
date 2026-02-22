import React, { useMemo, memo } from 'react';
import katex from 'katex';
import 'katex/dist/katex.min.css';
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

// Represents a segment of inline content (text, latex, link, or formatted text)
export interface InlineSegment {
  type: 'text' | 'latex' | 'link' | 'formatted';
  content: string;        // The full match including delimiters
  displayContent: string; // The visible content (text without markup)
  sourceStart: number;    // Position in source where this segment starts
  sourceEnd: number;      // Position in source where this segment ends
  isBlock: boolean;       // For latex: true if $$ (block), false if $ (inline)
  // For links: positions to map display chars to source chars
  linkTextStart?: number; // Position in source where link text starts (after '[')
  linkUrl?: string;       // The URL part of the link
  // For formatted text: styling info
  bold?: boolean;
  italic?: boolean;
  strikethrough?: boolean;
  underline?: boolean;
  innerSourceStart?: number; // Position in source where inner content starts (after opening delimiter)
}

// Parse inline content to extract LaTeX, links, and formatted text segments
export function parseInlineSegments(content: string, sourceOffset: number): InlineSegment[] {
  const segments: InlineSegment[] = [];

  // Combined regex for LaTeX, links, and formatting
  // Order matters: longer patterns first to avoid partial matches
  // Match: $$ ... $$ (block latex) | $ ... $ (inline latex) | [text](url) (link)
  //        | **...** (bold) | __...__ (bold) | *...* (italic) | _..._ (italic)
  //        | ~~...~~ (strikethrough) | ++...++ (underline)
  const combinedRegex = /(\$\$[\s\S]*?\$\$|\$[^$]+?\$|\[[^\]]+\]\([^)]+\)|\*\*[^*]+\*\*|__[^_]+__|\*[^*]+\*|_[^_]+_|~~[^~]+~~|\+\+[^+]+\+\+)/g;

  let lastIndex = 0;
  let match;

  while ((match = combinedRegex.exec(content)) !== null) {
    // Add text before this match
    if (match.index > lastIndex) {
      const textContent = content.slice(lastIndex, match.index);
      segments.push({
        type: 'text',
        content: textContent,
        displayContent: textContent,
        sourceStart: sourceOffset + lastIndex,
        sourceEnd: sourceOffset + match.index,
        isBlock: false,
      });
    }

    const fullMatch = match[0];

    if (fullMatch.startsWith('$$')) {
      // Block LaTeX segment
      const innerContent = fullMatch.slice(2, -2);
      segments.push({
        type: 'latex',
        content: fullMatch,
        displayContent: innerContent,
        sourceStart: sourceOffset + match.index,
        sourceEnd: sourceOffset + match.index + fullMatch.length,
        isBlock: true,
      });
    } else if (fullMatch.startsWith('$')) {
      // Inline LaTeX segment
      const innerContent = fullMatch.slice(1, -1);
      segments.push({
        type: 'latex',
        content: fullMatch,
        displayContent: innerContent,
        sourceStart: sourceOffset + match.index,
        sourceEnd: sourceOffset + match.index + fullMatch.length,
        isBlock: false,
      });
    } else if (fullMatch.startsWith('[')) {
      // Link segment: [text](url)
      const linkMatch = fullMatch.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
      if (linkMatch) {
        const linkText = linkMatch[1];
        const linkUrl = linkMatch[2];

        segments.push({
          type: 'link',
          content: fullMatch,
          displayContent: linkText,
          sourceStart: sourceOffset + match.index,
          sourceEnd: sourceOffset + match.index + fullMatch.length,
          isBlock: false,
          linkTextStart: sourceOffset + match.index + 1, // Position after '['
          linkUrl: linkUrl,
        });
      }
    } else if (fullMatch.startsWith('**') || fullMatch.startsWith('__')) {
      // Bold: **text** or __text__
      const innerContent = fullMatch.slice(2, -2);
      segments.push({
        type: 'formatted',
        content: fullMatch,
        displayContent: innerContent,
        sourceStart: sourceOffset + match.index,
        sourceEnd: sourceOffset + match.index + fullMatch.length,
        isBlock: false,
        bold: true,
        innerSourceStart: sourceOffset + match.index + 2,
      });
    } else if (fullMatch.startsWith('~~')) {
      // Strikethrough: ~~text~~
      const innerContent = fullMatch.slice(2, -2);
      segments.push({
        type: 'formatted',
        content: fullMatch,
        displayContent: innerContent,
        sourceStart: sourceOffset + match.index,
        sourceEnd: sourceOffset + match.index + fullMatch.length,
        isBlock: false,
        strikethrough: true,
        innerSourceStart: sourceOffset + match.index + 2,
      });
    } else if (fullMatch.startsWith('++')) {
      // Underline: ++text++
      const innerContent = fullMatch.slice(2, -2);
      segments.push({
        type: 'formatted',
        content: fullMatch,
        displayContent: innerContent,
        sourceStart: sourceOffset + match.index,
        sourceEnd: sourceOffset + match.index + fullMatch.length,
        isBlock: false,
        underline: true,
        innerSourceStart: sourceOffset + match.index + 2,
      });
    } else if (fullMatch.startsWith('*') || fullMatch.startsWith('_')) {
      // Italic: *text* or _text_
      const innerContent = fullMatch.slice(1, -1);
      segments.push({
        type: 'formatted',
        content: fullMatch,
        displayContent: innerContent,
        sourceStart: sourceOffset + match.index,
        sourceEnd: sourceOffset + match.index + fullMatch.length,
        isBlock: false,
        italic: true,
        innerSourceStart: sourceOffset + match.index + 1,
      });
    }

    lastIndex = match.index + fullMatch.length;
  }

  // Add remaining text after last match
  if (lastIndex < content.length) {
    const textContent = content.slice(lastIndex);
    segments.push({
      type: 'text',
      content: textContent,
      displayContent: textContent,
      sourceStart: sourceOffset + lastIndex,
      sourceEnd: sourceOffset + content.length,
      isBlock: false,
    });
  }

  // If no segments found, return the whole content as text
  if (segments.length === 0 && content.length > 0) {
    segments.push({
      type: 'text',
      content: content,
      displayContent: content,
      sourceStart: sourceOffset,
      sourceEnd: sourceOffset + content.length,
      isBlock: false,
    });
  }

  return segments;
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
      // Keep the full line as displayContent to match editor exactly
      block = { type: 'bullet', content: line, displayContent: line, sourceStart, sourceEnd, prefixLength: 0 };
    } else if (/^\d+\.\s/.test(line)) {
      // Keep the full line as displayContent to match editor exactly
      block = { type: 'numbered', content: line, displayContent: line, sourceStart, sourceEnd, prefixLength: 0 };
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

// Render inline content with LaTeX, link, and formatting support
const InlineContent = memo(({ content, sourceOffset }: { content: string; sourceOffset: number }) => {
  const segments = useMemo(() => parseInlineSegments(content, sourceOffset), [content, sourceOffset]);

  return (
    <>
      {segments.map((segment, i) => {
        if (segment.type === 'latex') {
          return (
            <span
              key={i}
              dangerouslySetInnerHTML={{ __html: renderLatex(segment.displayContent, segment.isBlock) }}
            />
          );
        }
        if (segment.type === 'link') {
          return (
            <span
              key={i}
              style={{
                color: '#2563eb',
                textDecoration: 'underline',
                cursor: 'pointer',
              }}
            >
              {segment.displayContent}
            </span>
          );
        }
        if (segment.type === 'formatted') {
          const style: React.CSSProperties = {};
          if (segment.bold) style.fontWeight = 'bold';
          if (segment.italic) style.fontStyle = 'italic';
          if (segment.strikethrough) style.textDecoration = 'line-through';
          if (segment.underline) style.textDecoration = 'underline';
          return (
            <span key={i} style={style}>
              {segment.displayContent}
            </span>
          );
        }
        return <span key={i}>{segment.displayContent}</span>;
      })}
    </>
  );
});

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

  // Calculate the source offset for inline content (after the prefix)
  const inlineSourceOffset = block.sourceStart + block.prefixLength;

  // Bullet and numbered lists are now rendered with the full line (including prefix)
  // to match the editor exactly
  if (block.type === 'bullet' || block.type === 'numbered') {
    return (
      <div style={style}>
        <InlineContent content={block.displayContent} sourceOffset={inlineSourceOffset} />
      </div>
    );
  }

  // Headers and paragraphs
  return (
    <div style={style}>
      {block.displayContent ? (
        <InlineContent content={block.displayContent} sourceOffset={inlineSourceOffset} />
      ) : (
        <br />
      )}
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
    <div className="custom-markdown-content">
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
