import React, { useMemo, memo } from 'react';
import 'katex/dist/katex.min.css';
import type { TextStyle } from '../../types/presentation';
import { renderLatex } from '../../utils/text/latexUtils';

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
  /** First source line this block covers. */
  lineIndex: number;
  /**
   * How many source lines it covers. One for every block except a math span
   * written across lines — `$$`, body, `$$` — which is a single formula and
   * therefore a single block.
   */
  lineCount: number;
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

/**
 * The inline grammar, as one alternation.
 *
 * Order matters: longer patterns first, so `$$` wins over `$` and `**` over
 * `*`. Both delimiters of a math span may be separated by newlines — `[^$]`
 * and `[\s\S]` match them — which is what makes a `$$`-on-its-own-line
 * display equation one segment rather than three broken lines.
 *
 * Match: $$ ... $$ (block latex) | $ ... $ (inline latex) | [text](url) (link)
 *        | **...** (bold) | __...__ (bold) | *...* (italic) | _..._ (italic)
 *        | ~~...~~ (strikethrough) | ++...++ (underline)
 */
const INLINE_PATTERN =
  /(\$\$[\s\S]*?\$\$|\$[^$]+?\$|\[[^\]]+\]\([^)]+\)|\*\*[^*]+\*\*|__[^_]+__|\*[^*]+\*|_[^_]+_|~~[^~]+~~|\+\+[^+]+\+\+)/
    .source;

/**
 * Math spans that cross a line break, as `[start, end)` source offsets.
 *
 * `parseBlocks` splits on newlines and `parseInlineSegments` then runs per
 * block, so a formula whose delimiters sit on different lines used to match
 * nothing at all: the canonical display form
 *
 *     $$
 *     E = mc^2
 *     $$
 *
 * rendered as three lines of literal source, and so did an inline `$…$` that
 * happened to have a newline before its closing `$`. Worse, with the math
 * span gone the remaining markdown rules chew on the TeX — `_[^_]+_` matches
 * the subscripts in `\sum_{i=1}^{N}\prod_k` and italicises them.
 *
 * Detection runs the WHOLE inline grammar over the WHOLE text rather than
 * just a math pattern, so a `$` that `parseInlineSegments` would have swallowed
 * as part of a link or a bold run is not mistaken for a formula here. Only
 * spans that actually cross a newline are reported; single-line ones already
 * parse correctly and need no block merging.
 */
// eslint-disable-next-line react-refresh/only-export-components -- shared parsing/rendering helper exported beside the component; full reload on edit is fine
export function multiLineMathSpans(text: string): Array<{ start: number; end: number }> {
  const spans: Array<{ start: number; end: number }> = [];
  for (const match of text.matchAll(new RegExp(INLINE_PATTERN, 'g'))) {
    const value = match[0];
    if (value.startsWith('$') && value.includes('\n')) {
      spans.push({ start: match.index, end: match.index + value.length });
    }
  }
  return spans;
}

/** The block covering a source line, for consumers that index by line. */
// eslint-disable-next-line react-refresh/only-export-components -- shared parsing/rendering helper exported beside the component; full reload on edit is fine
export function blockForLine(blocks: ParsedBlock[], line: number): ParsedBlock | undefined {
  return blocks.find((b) => line >= b.lineIndex && line < b.lineIndex + b.lineCount);
}

// Parse inline content to extract LaTeX, links, and formatted text segments
// eslint-disable-next-line react-refresh/only-export-components -- shared parsing/rendering helper exported beside the component; full reload on edit is fine
export function parseInlineSegments(content: string, sourceOffset: number): InlineSegment[] {
  const segments: InlineSegment[] = [];

  const combinedRegex = new RegExp(INLINE_PATTERN, 'g');

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

// Parse text into blocks with source position tracking
// eslint-disable-next-line react-refresh/only-export-components -- shared parsing/rendering helper exported beside the component; full reload on edit is fine
export function parseBlocks(text: string): ParsedBlock[] {
  const lines = text.split('\n');
  const spans = multiLineMathSpans(text);
  const blocks: ParsedBlock[] = [];
  let sourcePos = 0;

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const line = lines[lineIndex];
    const sourceStart = sourcePos;
    const sourceEnd = sourcePos + line.length;

    // A line that begins strictly inside a math span is the continuation of a
    // formula, not a block of its own: fold it into the block that opened the
    // span so the segment parser sees both delimiters at once. The newline is
    // kept — MathJax treats it as ordinary TeX whitespace, and dropping it
    // would shift every source offset after this point.
    const continuation = blocks.length > 0
      && spans.some((span) => span.start < sourceStart && sourceStart < span.end);
    if (continuation) {
      const open = blocks[blocks.length - 1];
      open.content += `\n${line}`;
      open.displayContent += `\n${line}`;
      open.sourceEnd = sourceEnd;
      open.lineCount++;
      sourcePos = sourceEnd + 1;
      continue;
    }

    let block: ParsedBlock;

    const span = { sourceStart, sourceEnd, lineIndex, lineCount: 1 };
    if (line.startsWith('### ')) {
      block = { type: 'h3', content: line, displayContent: line.slice(4), prefixLength: 4, ...span };
    } else if (line.startsWith('## ')) {
      block = { type: 'h2', content: line, displayContent: line.slice(3), prefixLength: 3, ...span };
    } else if (line.startsWith('# ')) {
      block = { type: 'h1', content: line, displayContent: line.slice(2), prefixLength: 2, ...span };
    } else if (/^[-*]\s/.test(line)) {
      // Keep the full line as displayContent to match editor exactly
      block = { type: 'bullet', content: line, displayContent: line, prefixLength: 0, ...span };
    } else if (/^\d+\.\s/.test(line)) {
      // Keep the full line as displayContent to match editor exactly
      block = { type: 'numbered', content: line, displayContent: line, prefixLength: 0, ...span };
    } else {
      block = { type: 'paragraph', content: line, displayContent: line, prefixLength: 0, ...span };
    }

    blocks.push(block);
    sourcePos = sourceEnd + 1; // +1 for newline
  }

  return blocks;
}

// Get font size multiplier for block type
// eslint-disable-next-line react-refresh/only-export-components -- shared parsing/rendering helper exported beside the component; full reload on edit is fine
export function getBlockFontMultiplier(type: ParsedBlock['type']): number {
  switch (type) {
    case 'h1': return 2;
    case 'h2': return 1.5;
    case 'h3': return 1.25;
    default: return 1;
  }
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Render inline segments as an HTML string. Single source of truth shared by
// SVGTextContent (foreignObject), CustomMarkdownRenderer (presenter), and the
// static SVG export renderer.
function renderInlineSegmentsAsHtml(content: string, sourceOffset: number): string {
  const segments = parseInlineSegments(content, sourceOffset);
  return segments.map((segment) => {
    if (segment.type === 'latex') {
      return renderLatex(segment.displayContent, segment.isBlock);
    }
    if (segment.type === 'link') {
      return `<span style="color:#2563eb;text-decoration:underline">${escapeHtml(segment.displayContent)}</span>`;
    }
    if (segment.type === 'formatted') {
      let style = '';
      if (segment.bold) style += 'font-weight:bold;';
      if (segment.italic) style += 'font-style:italic;';
      if (segment.strikethrough) style += 'text-decoration:line-through;';
      if (segment.underline) style += 'text-decoration:underline;';
      return `<span style="${style}">${escapeHtml(segment.displayContent)}</span>`;
    }
    return escapeHtml(segment.displayContent);
  }).join('');
}

// Render a parsed block as an HTML string (the per-block <div>).
function renderBlockAsHtml(block: ParsedBlock, baseFontSize: number, baseFontWeight: string | number, lineHeight: number): string {
  const multiplier = getBlockFontMultiplier(block.type);
  const fontSize = baseFontSize * multiplier;
  const isHeader = block.type === 'h1' || block.type === 'h2' || block.type === 'h3';
  const fontWeight = isHeader ? 'bold' : baseFontWeight;

  const inlineSourceOffset = block.sourceStart + block.prefixLength;
  const inner = renderInlineSegmentsAsHtml(block.displayContent, inlineSourceOffset) || '&nbsp;';

  return `<div style="font-size:${fontSize}px;font-weight:${fontWeight};line-height:${lineHeight};min-height:${fontSize * lineHeight}px;margin:0;padding:0;">${inner}</div>`;
}

// Render the full text as an inner-HTML string for the markdown container.
// Pass this through dangerouslySetInnerHTML on the container described by
// containerStyleForMarkdown().
// eslint-disable-next-line react-refresh/only-export-components -- shared parsing/rendering helper exported beside the component; full reload on edit is fine
export function renderMarkdownToHtml(text: string, style: TextStyle, zoom: number): string {
  const blocks = parseBlocks(text || '');
  const baseFontSize = style.fontSize * zoom;
  const lineHeight = style.lineHeight || 1.2;
  const baseFontWeight = style.fontWeight;
  return blocks.map((block) => renderBlockAsHtml(block, baseFontSize, baseFontWeight, lineHeight)).join('');
}

// Container style shared by all markdown renderers. The block <div>s already
// carry font-size/weight/line-height, so the container only carries the
// element-level style (font family, color, alignment, decoration, etc.).
// eslint-disable-next-line react-refresh/only-export-components -- shared parsing/rendering helper exported beside the component; full reload on edit is fine
export function containerStyleForMarkdown(style: TextStyle): React.CSSProperties {
  return {
    fontFamily: style.fontFamily,
    fontStyle: style.fontStyle,
    color: style.color,
    textAlign: style.align,
    wordWrap: 'break-word',
    overflowWrap: 'break-word',
    whiteSpace: 'pre-wrap',
  };
}

export const CustomMarkdownRenderer: React.FC<Props> = memo(({ text, style, zoom }) => {
  const html = useMemo(() => renderMarkdownToHtml(text, style, zoom), [text, style, zoom]);
  const containerStyle = useMemo(() => containerStyleForMarkdown(style), [style]);

  return (
    <div
      className="custom-markdown-content"
      style={containerStyle}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
});
