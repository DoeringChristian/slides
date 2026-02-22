import type { TextElement } from '../types/presentation';
import { parseBlocks, getBlockFontMultiplier, type ParsedBlock } from '../components/canvas/CustomMarkdownRenderer';

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

  const padding = 4;
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

    // Calculate visual prefix width for bullets/numbered lists
    let visualPrefixWidth = 0;
    if (block.type === 'bullet') {
      visualPrefixWidth = ctx.measureText('•').width + blockFontSize * 0.5;
    } else if (block.type === 'numbered') {
      const num = block.content.match(/^(\d+)\./)?.[1] || '1';
      visualPrefixWidth = ctx.measureText(num + '.').width + blockFontSize * 0.5;
    }

    const blockWidth = visualPrefixWidth + ctx.measureText(block.displayContent).width;
    const blockHeight = blockFontSize * lineHeightMultiplier;

    totalHeight += blockHeight;
    maxWidth = Math.max(maxWidth, blockWidth);
  }

  const contentWidth = width - padding * 2;
  const contentHeight = height - padding * 2;

  // Calculate text position based on alignment
  let textX = padding;
  if (align === 'center') {
    textX = padding + (contentWidth - maxWidth) / 2;
  } else if (align === 'right') {
    textX = padding + contentWidth - maxWidth;
  }

  let textY = padding;
  if (verticalAlign === 'middle') {
    textY = padding + (contentHeight - totalHeight) / 2;
  } else if (verticalAlign === 'bottom') {
    textY = padding + contentHeight - totalHeight;
  }

  const tolerance = 4;
  const textBounds = {
    left: Math.max(0, textX - tolerance),
    top: Math.max(0, textY - tolerance),
    right: Math.min(width, textX + maxWidth + tolerance),
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
 * Calculate cursor position from click coordinates.
 * Maps from rendered (display) position back to source position.
 */
export function calculateCursorFromClick(
  element: TextElement,
  clickPos: Point
): number {
  const { text, width, style } = element;
  const { fontSize, fontFamily, fontWeight, lineHeight, align, verticalAlign } = style;
  const padding = 4;
  const lineHeightMultiplier = lineHeight || 1.2;

  if (!text) return 0;

  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) return 0;

  const blocks = parseBlocks(text);
  const contentWidth = width - padding * 2;
  const contentHeight = element.height - padding * 2;

  // Calculate block heights
  const blockData: { block: ParsedBlock; height: number; fontSize: number; isBold: boolean }[] = [];
  let totalHeight = 0;

  for (const block of blocks) {
    const multiplier = getBlockFontMultiplier(block.type);
    const blockFontSize = fontSize * multiplier;
    const isHeader = block.type === 'h1' || block.type === 'h2' || block.type === 'h3';
    const blockHeight = blockFontSize * lineHeightMultiplier;

    blockData.push({
      block,
      height: blockHeight,
      fontSize: blockFontSize,
      isBold: isHeader || fontWeight === 'bold',
    });
    totalHeight += blockHeight;
  }

  // Calculate starting Y based on vertical alignment
  let startY = padding;
  if (verticalAlign === 'middle') {
    startY = padding + (contentHeight - totalHeight) / 2;
  } else if (verticalAlign === 'bottom') {
    startY = padding + contentHeight - totalHeight;
  }

  // Find which block was clicked
  let currentY = startY;
  let blockIndex = 0;

  for (let i = 0; i < blockData.length; i++) {
    if (currentY + blockData[i].height > clickPos.y) {
      blockIndex = i;
      break;
    }
    currentY += blockData[i].height;
    blockIndex = i;
  }

  blockIndex = Math.max(0, Math.min(blocks.length - 1, blockIndex));
  const bd = blockData[blockIndex];
  const block = bd.block;

  // Set font for measuring
  ctx.font = `${bd.isBold ? 'bold ' : ''}${bd.fontSize}px ${fontFamily}`;

  // Calculate visual prefix width for bullets/numbered lists
  // The renderer shows "• " or "1. " with marginRight: 0.5em before displayContent
  let visualPrefixWidth = 0;
  if (block.type === 'bullet') {
    // "•" + marginRight (0.5em)
    visualPrefixWidth = ctx.measureText('•').width + bd.fontSize * 0.5;
  } else if (block.type === 'numbered') {
    // Extract the number from the original content
    const num = block.content.match(/^(\d+)\./)?.[1] || '1';
    // "N." + marginRight (0.5em)
    visualPrefixWidth = ctx.measureText(num + '.').width + bd.fontSize * 0.5;
  }

  // Calculate block X position
  const displayWidth = ctx.measureText(block.displayContent).width;
  const totalRenderedWidth = visualPrefixWidth + displayWidth;

  let blockX = padding;
  if (align === 'center') {
    blockX = padding + (contentWidth - totalRenderedWidth) / 2;
  } else if (align === 'right') {
    blockX = padding + contentWidth - totalRenderedWidth;
  }

  // The actual text content starts after the visual prefix
  const textStartX = blockX + visualPrefixWidth;

  // Find character position in displayContent
  const clickX = clickPos.x - textStartX;
  let displayCharIndex = 0;

  // If click is before the text (on the bullet/number), return start of line
  if (clickX < 0) {
    return block.sourceStart;
  }

  // Use cumulative text width measurement for accuracy (accounts for kerning)
  for (let i = 0; i < block.displayContent.length; i++) {
    const widthUpToChar = ctx.measureText(block.displayContent.slice(0, i)).width;
    const widthUpToNextChar = ctx.measureText(block.displayContent.slice(0, i + 1)).width;
    const charMidpoint = (widthUpToChar + widthUpToNextChar) / 2;

    if (clickX < charMidpoint) {
      displayCharIndex = i;
      break;
    }
    displayCharIndex = i + 1;
  }

  // Map displayCharIndex back to source position
  // sourceStart is the start of the line, prefixLength is the stripped markdown
  const sourcePos = block.sourceStart + block.prefixLength + displayCharIndex;

  return Math.min(sourcePos, text.length);
}
