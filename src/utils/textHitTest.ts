import type { TextElement } from '../types/presentation';
import { parseBlocks, getBlockFontMultiplier, parseInlineSegments, type ParsedBlock } from '../components/canvas/CustomMarkdownRenderer';
import { TEXT_BOX_PADDING } from './constants';

interface Point {
  x: number;
  y: number;
}

/**
 * Check if a point (relative to the element's top-left) is within the actual text content area.
 * Accounts for markdown formatting (headers have larger font sizes).
 */
export function isPointOnTextContent(element: TextElement, point: Point): boolean {
  const { text, width, height, style } = element;

  if (!text || text.trim() === '') {
    return false;
  }

  const padding = TEXT_BOX_PADDING;
  const { fontSize, fontFamily, fontWeight, lineHeight, align, verticalAlign } = style;
  const lineHeightMultiplier = lineHeight || 1.2;

  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) return false;

  const blocks = parseBlocks(text);

  // Calculate total height and max width accounting for markdown
  let totalHeight = 0;
  let maxWidth = 0;

  for (const block of blocks) {
    const multiplier = getBlockFontMultiplier(block.type);
    const blockFontSize = fontSize * multiplier;
    const isHeader = block.type === 'h1' || block.type === 'h2' || block.type === 'h3';
    const blockFontWeight = isHeader ? 'bold ' : (fontWeight === 'bold' ? 'bold ' : '');

    ctx.font = `${blockFontWeight}${blockFontSize}px ${fontFamily}`;

    // Note: bullets and numbered lists now include the prefix in displayContent
    const blockWidth = ctx.measureText(block.displayContent).width;
    const blockHeight = blockFontSize * lineHeightMultiplier;

    totalHeight += blockHeight;
    maxWidth = Math.max(maxWidth, blockWidth);
  }

  const contentWidth = width - padding * 2;
  const contentHeight = height - padding * 2;

  // With word wrapping, text fills up to the content width
  const effectiveTextWidth = Math.min(maxWidth, contentWidth);

  // Calculate text position based on alignment
  let textX = padding;
  if (align === 'center') {
    textX = padding + (contentWidth - effectiveTextWidth) / 2;
  } else if (align === 'right') {
    textX = padding + contentWidth - effectiveTextWidth;
  }

  let textY = padding;
  if (verticalAlign === 'middle') {
    textY = padding + (contentHeight - totalHeight) / 2;
  } else if (verticalAlign === 'bottom') {
    textY = padding + contentHeight - totalHeight;
  }

  // Border margin: clicks near box edges always start a drag, not edit mode
  const borderMargin = 8;
  if (point.x < borderMargin || point.x > width - borderMargin ||
      point.y < borderMargin || point.y > height - borderMargin) {
    return false;
  }

  const tolerance = 4;
  const textBounds = {
    left: Math.max(0, textX - tolerance),
    top: Math.max(0, textY - tolerance),
    right: Math.min(width, textX + effectiveTextWidth + tolerance),
    bottom: Math.min(height, textY + totalHeight + tolerance),
  };

  return (
    point.x >= textBounds.left &&
    point.x <= textBounds.right &&
    point.y >= textBounds.top &&
    point.y <= textBounds.bottom
  );
}

/**
 * Word-wrap text and return an array of lines with their character ranges.
 */
function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number
): { text: string; startIndex: number; endIndex: number }[] {
  const lines: { text: string; startIndex: number; endIndex: number }[] = [];
  const words = text.split(/(\s+)/); // Split but keep whitespace
  let currentLine = '';
  let currentStartIndex = 0;
  let currentIndex = 0;

  for (const word of words) {
    const testLine = currentLine + word;
    const testWidth = ctx.measureText(testLine).width;

    if (testWidth > maxWidth && currentLine !== '') {
      // Push current line and start a new one
      lines.push({
        text: currentLine,
        startIndex: currentStartIndex,
        endIndex: currentIndex,
      });
      currentLine = word;
      currentStartIndex = currentIndex;
    } else {
      currentLine = testLine;
    }
    currentIndex += word.length;
  }

  // Push the last line
  if (currentLine !== '' || lines.length === 0) {
    lines.push({
      text: currentLine,
      startIndex: currentStartIndex,
      endIndex: currentIndex,
    });
  }

  return lines;
}

/**
 * Calculate cursor position from click coordinates.
 * Maps from rendered (display) position back to source position.
 * Handles word-wrapped text properly.
 */
export function calculateCursorFromClick(
  element: TextElement,
  clickPos: Point
): number {
  const { text, width, style } = element;
  const { fontSize, fontFamily, fontWeight, lineHeight, align, verticalAlign } = style;
  const padding = TEXT_BOX_PADDING;
  const lineHeightMultiplier = lineHeight || 1.2;

  if (!text) return 0;

  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) return 0;

  const blocks = parseBlocks(text);
  const contentWidth = width - padding * 2;
  const contentHeight = element.height - padding * 2;

  // Structure to hold wrapped line info for each block
  interface WrappedLine {
    text: string;
    startIndex: number; // Index within displayContent
    endIndex: number;
    height: number;
    y: number; // Y position of this line
  }

  interface BlockInfo {
    block: ParsedBlock;
    fontSize: number;
    isBold: boolean;
    wrappedLines: WrappedLine[];
    totalHeight: number;
  }

  // Calculate wrapped lines for each block
  const blockInfos: BlockInfo[] = [];
  let totalHeight = 0;

  for (const block of blocks) {
    const multiplier = getBlockFontMultiplier(block.type);
    const blockFontSize = fontSize * multiplier;
    const isHeader = block.type === 'h1' || block.type === 'h2' || block.type === 'h3';
    const isBold = isHeader || fontWeight === 'bold';
    const lineHeight = blockFontSize * lineHeightMultiplier;

    ctx.font = `${isBold ? 'bold ' : ''}${blockFontSize}px ${fontFamily}`;

    // Wrap the text
    const wrappedLines = wrapText(ctx, block.displayContent, contentWidth);
    const wrappedLinesWithHeight: WrappedLine[] = wrappedLines.map((line) => ({
      ...line,
      height: lineHeight,
      y: 0, // Will be set later
    }));

    const blockTotalHeight = wrappedLinesWithHeight.length * lineHeight;

    blockInfos.push({
      block,
      fontSize: blockFontSize,
      isBold,
      wrappedLines: wrappedLinesWithHeight,
      totalHeight: blockTotalHeight,
    });

    totalHeight += blockTotalHeight;
  }

  // Calculate starting Y based on vertical alignment
  let startY = padding;
  if (verticalAlign === 'middle') {
    startY = padding + (contentHeight - totalHeight) / 2;
  } else if (verticalAlign === 'bottom') {
    startY = padding + contentHeight - totalHeight;
  }

  // Assign Y positions to all wrapped lines
  let currentY = startY;
  for (const blockInfo of blockInfos) {
    for (const line of blockInfo.wrappedLines) {
      line.y = currentY;
      currentY += line.height;
    }
  }

  // Find which wrapped line was clicked
  let clickedBlockInfo: BlockInfo | null = null;
  let clickedLine: WrappedLine | null = null;

  for (const blockInfo of blockInfos) {
    for (const line of blockInfo.wrappedLines) {
      if (clickPos.y >= line.y && clickPos.y < line.y + line.height) {
        clickedBlockInfo = blockInfo;
        clickedLine = line;
        break;
      }
    }
    if (clickedLine) break;
  }

  // If click is below all lines, use the last line
  if (!clickedBlockInfo || !clickedLine) {
    const lastBlockInfo = blockInfos[blockInfos.length - 1];
    clickedBlockInfo = lastBlockInfo;
    clickedLine = lastBlockInfo.wrappedLines[lastBlockInfo.wrappedLines.length - 1];
  }

  const block = clickedBlockInfo.block;

  // Set font for measuring
  ctx.font = `${clickedBlockInfo.isBold ? 'bold ' : ''}${clickedBlockInfo.fontSize}px ${fontFamily}`;

  // Calculate line X position based on alignment
  const lineWidth = ctx.measureText(clickedLine.text).width;
  let lineX = padding;
  if (align === 'center') {
    lineX = padding + (contentWidth - lineWidth) / 2;
  } else if (align === 'right') {
    lineX = padding + contentWidth - lineWidth;
  }

  // Find character position within the wrapped line
  const clickX = clickPos.x - lineX;

  // If click is before the line, return start of line
  if (clickX < 0) {
    return block.sourceStart + clickedLine.startIndex;
  }

  // Find exact character position within the line
  let charIndex = 0;
  for (let i = 0; i < clickedLine.text.length; i++) {
    const widthUpToChar = ctx.measureText(clickedLine.text.slice(0, i)).width;
    const widthUpToNextChar = ctx.measureText(clickedLine.text.slice(0, i + 1)).width;
    const charMidpoint = (widthUpToChar + widthUpToNextChar) / 2;

    if (clickX < charMidpoint) {
      charIndex = i;
      break;
    }
    charIndex = i + 1;
  }

  // Map back to source position
  // The wrapped line's startIndex is relative to displayContent
  // We need to map displayContent index to source position
  const displayIndex = clickedLine.startIndex + charIndex;

  // For simple text without markdown, displayContent == source content within the block
  // For blocks with prefixes (headers, bullets), we need to account for that
  // block.sourceStart is the start of the source line
  // block.prefixLength is the length of any prefix (e.g., "# " for headers)
  // displayContent starts after the prefix

  // Parse inline segments to handle formatted text properly
  const inlineSourceOffset = block.sourceStart + block.prefixLength;
  const segments = parseInlineSegments(block.displayContent, inlineSourceOffset);

  // Find which segment contains the displayIndex
  let accumulatedDisplayLength = 0;

  for (const segment of segments) {
    const segmentDisplayLength = segment.displayContent.length;

    if (displayIndex < accumulatedDisplayLength + segmentDisplayLength) {
      // Click is within this segment
      const indexInSegment = displayIndex - accumulatedDisplayLength;

      if (segment.type === 'latex') {
        // For LaTeX, place cursor at the end (before closing delimiter)
        const delimiterLength = segment.isBlock ? 2 : 1;
        return segment.sourceEnd - delimiterLength;
      } else if (segment.type === 'link') {
        // Map to position within the link text
        return (segment.linkTextStart ?? segment.sourceStart + 1) + indexInSegment;
      } else if (segment.type === 'formatted') {
        // Map to position within the formatted text (after opening delimiter)
        return (segment.innerSourceStart ?? segment.sourceStart + 2) + indexInSegment;
      } else {
        // Plain text
        return segment.sourceStart + indexInSegment;
      }
    }

    accumulatedDisplayLength += segmentDisplayLength;
  }

  // Click is past the end of content, return end of block
  return block.sourceEnd;
}
