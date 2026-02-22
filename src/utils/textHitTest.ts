import type { TextElement } from '../types/presentation';

interface Point {
  x: number;
  y: number;
}

/**
 * Check if a point (relative to the element's top-left) is within the actual text content area.
 * Returns false if the text is empty or the point is in padding/empty space.
 */
export function isPointOnTextContent(element: TextElement, point: Point): boolean {
  const { text, width, height, style } = element;

  // No text content - not on text
  if (!text || text.trim() === '') {
    return false;
  }

  const padding = 4; // Same padding as TextEditOverlay
  const { fontSize, fontFamily, fontWeight, lineHeight, align, verticalAlign } = style;

  // Measure text using canvas
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) return false;

  ctx.font = `${fontWeight === 'bold' ? 'bold ' : ''}${fontSize}px ${fontFamily}`;

  // Split text into lines and measure each
  const lines = text.split('\n');
  const lineHeightPx = fontSize * (lineHeight || 1.2);
  const textHeight = lines.length * lineHeightPx;

  // Find the widest line
  let maxLineWidth = 0;
  for (const line of lines) {
    const lineWidth = ctx.measureText(line).width;
    maxLineWidth = Math.max(maxLineWidth, lineWidth);
  }

  // Calculate content area (inside padding)
  const contentLeft = padding;
  const contentTop = padding;
  const contentWidth = width - padding * 2;
  const contentHeight = height - padding * 2;

  // Calculate text position based on alignment
  let textX = contentLeft;
  if (align === 'center') {
    textX = contentLeft + (contentWidth - maxLineWidth) / 2;
  } else if (align === 'right') {
    textX = contentLeft + contentWidth - maxLineWidth;
  }

  let textY = contentTop;
  if (verticalAlign === 'middle') {
    textY = contentTop + (contentHeight - textHeight) / 2;
  } else if (verticalAlign === 'bottom') {
    textY = contentTop + contentHeight - textHeight;
  }

  // Define the text bounding box with some tolerance
  const tolerance = 4;
  const textBounds = {
    left: Math.max(0, textX - tolerance),
    top: Math.max(0, textY - tolerance),
    right: Math.min(width, textX + maxLineWidth + tolerance),
    bottom: Math.min(height, textY + textHeight + tolerance),
  };

  // Check if point is within text bounds
  return (
    point.x >= textBounds.left &&
    point.x <= textBounds.right &&
    point.y >= textBounds.top &&
    point.y <= textBounds.bottom
  );
}
