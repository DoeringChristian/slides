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

  const blocks = parseBlocks(text);

  const contentWidth = width - padding * 2;
  const contentHeight = height - padding * 2;

  // Calculate total height using DOM measurement (accounts for word wrapping)
  let totalHeight = 0;

  for (const block of blocks) {
    const multiplier = getBlockFontMultiplier(block.type);
    const blockFontSize = fontSize * multiplier;
    const isHeader = block.type === 'h1' || block.type === 'h2' || block.type === 'h3';
    const blockFontWeight = isHeader ? 'bold' : (fontWeight || 'normal');

    totalHeight += measureBlockHeight(
      block.displayContent,
      blockFontSize,
      fontFamily,
      blockFontWeight,
      lineHeightMultiplier,
      contentWidth
    );
  }

  // Text always fills the content width (word wrapping)
  const effectiveTextWidth = contentWidth;

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
  // Only apply border margin within the original element bounds (not overflow area)
  const borderMargin = 8;
  if (point.x < borderMargin || point.x > width - borderMargin ||
      (point.y < height && (point.y < borderMargin || point.y > height - borderMargin))) {
    return false;
  }

  const tolerance = 4;
  const textBounds = {
    left: Math.max(0, textX - tolerance),
    top: Math.max(0, textY - tolerance),
    right: Math.min(width, textX + effectiveTextWidth + tolerance),
    bottom: textY + totalHeight + tolerance,
  };

  return (
    point.x >= textBounds.left &&
    point.x <= textBounds.right &&
    point.y >= textBounds.top &&
    point.y <= textBounds.bottom
  );
}

/**
 * Measure the actual rendered height of a block using DOM measurement.
 * This matches the browser's word-wrapping exactly.
 */
export function measureBlockHeight(
  text: string,
  fontSize: number,
  fontFamily: string,
  fontWeight: string,
  lineHeight: number,
  maxWidth: number
): number {
  const container = document.createElement('div');
  container.style.cssText = `
    position: absolute;
    visibility: hidden;
    width: ${maxWidth}px;
    font-size: ${fontSize}px;
    font-family: ${fontFamily};
    font-weight: ${fontWeight};
    line-height: ${lineHeight};
    white-space: pre-wrap;
    word-break: break-word;
    margin: 0;
    padding: 0;
  `;
  container.textContent = text || '\u00A0'; // Use non-breaking space for empty lines
  document.body.appendChild(container);
  const height = container.getBoundingClientRect().height;
  document.body.removeChild(container);
  return Math.max(height, fontSize * lineHeight); // Ensure minimum height
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

  // Calculate block heights using actual DOM measurement
  const blockInfos: BlockInfo[] = [];
  let totalHeight = 0;

  for (const block of blocks) {
    const multiplier = getBlockFontMultiplier(block.type);
    const blockFontSize = fontSize * multiplier;
    const isHeader = block.type === 'h1' || block.type === 'h2' || block.type === 'h3';
    const isBold = isHeader || fontWeight === 'bold';

    // Measure actual rendered height (accounts for word wrapping)
    const blockTotalHeight = measureBlockHeight(
      block.displayContent,
      blockFontSize,
      fontFamily,
      isBold ? 'bold' : (fontWeight || 'normal'),
      lineHeightMultiplier,
      contentWidth
    );

    // For click detection, we treat the whole block as one area
    // (we'll refine X position within the block later)
    const wrappedLinesWithHeight: WrappedLine[] = [{
      text: block.displayContent,
      startIndex: 0,
      endIndex: block.displayContent.length,
      height: blockTotalHeight,
      y: 0,
    }];

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

  // For wrapped text blocks, we need to find which character was clicked
  // Use DOM-based measurement for accurate character positioning
  const clickX = clickPos.x - padding;
  const clickYInBlock = clickPos.y - clickedLine.y;

  // Create a temporary element to measure character positions
  const measureContainer = document.createElement('div');
  measureContainer.style.cssText = `
    position: absolute;
    visibility: hidden;
    width: ${contentWidth}px;
    font-size: ${clickedBlockInfo.fontSize}px;
    font-family: ${fontFamily};
    font-weight: ${clickedBlockInfo.isBold ? 'bold' : (fontWeight || 'normal')};
    line-height: ${lineHeightMultiplier};
    white-space: pre-wrap;
    word-break: break-word;
    text-align: ${align};
    margin: 0;
    padding: 0;
  `;
  document.body.appendChild(measureContainer);

  // Find character index by binary search using Range API
  const textNode = document.createTextNode(block.displayContent || ' ');
  measureContainer.appendChild(textNode);

  let charIndex = 0;
  const textLength = block.displayContent.length;

  if (textLength > 0) {
    const range = document.createRange();

    // Binary search for the closest character
    let low = 0;
    let high = textLength;

    while (low < high) {
      const mid = Math.floor((low + high) / 2);
      range.setStart(textNode, mid);
      range.setEnd(textNode, mid + 1);
      const rect = range.getBoundingClientRect();
      const containerRect = measureContainer.getBoundingClientRect();

      const charX = rect.left - containerRect.left;
      const charY = rect.top - containerRect.top;

      // Check if click is before this character (in reading order)
      if (clickYInBlock < charY || (Math.abs(clickYInBlock - charY) < rect.height && clickX < charX + rect.width / 2)) {
        high = mid;
      } else {
        low = mid + 1;
      }
    }

    charIndex = low;
  }

  document.body.removeChild(measureContainer);

  // Map back to source position
  const displayIndex = charIndex;

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
