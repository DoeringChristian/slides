import type { TextElement } from '../types/presentation';
import { parseBlocks, getBlockFontMultiplier, parseInlineSegments } from '../components/canvas/CustomMarkdownRenderer';
import { TEXT_BOX_PADDING } from './constants';
import { getLayoutSync, layoutSvgText, type SvgTextDoc } from './textLayout';

interface Point { x: number; y: number }

/**
 * Hit-test a point (element-local coords, slide units) against the text
 * content. Used by the canvas pointer handler to decide drag-vs-edit when
 * the user clicks an unselected text element.
 *
 * Sources the rendered height from the SVG layout cache so we agree with
 * what the user sees; falls back to the box height if the layout hasn't
 * resolved yet (first frame after slide switch).
 */
export function isPointOnTextContent(element: TextElement, point: Point): boolean {
  const { text, width, height, style } = element;
  if (!text || text.trim() === '') return false;

  const padding = TEXT_BOX_PADDING;

  // Border margin: clicks near box edges always start a drag, not edit mode.
  // Only enforced within the original bounds (not below for overflow).
  const borderMargin = 8;
  if (point.x < borderMargin || point.x > width - borderMargin ||
      (point.y < height && (point.y < borderMargin || point.y > height - borderMargin))) {
    return false;
  }

  const contentWidth = width - padding * 2;
  const contentHeight = height - padding * 2;
  const doc = getLayoutSync(text, style, contentWidth);
  const renderedHeight = doc?.height ?? contentHeight;

  let textY = padding;
  if (style.verticalAlign === 'middle') textY = padding + Math.max(0, (contentHeight - renderedHeight) / 2);
  else if (style.verticalAlign === 'bottom') textY = padding + Math.max(0, contentHeight - renderedHeight);

  const tolerance = 4;
  return (
    point.x >= padding - tolerance &&
    point.x <= padding + contentWidth + tolerance &&
    point.y >= textY - tolerance &&
    point.y <= textY + renderedHeight + tolerance
  );
}

/**
 * Approximate rendered block height when no layout is cached. Used only by
 * SVGTextNode's hit-rect sizing before the SVG's first layout settles —
 * everywhere else reads doc.lines / doc.height from the layout cache.
 */
export function measureBlockHeight(
  text: string,
  fontSize: number,
  fontFamily: string,
  fontWeight: string,
  lineHeight: number,
  maxWidth: number,
): number {
  // Match the SVG renderer's per-line factor: a baseline at 0.8 * fontSize
  // plus a descender of 0.4 * lineHeight * fontSize.
  const totalLineFactor = 0.8 + 0.4 * lineHeight;
  const container = document.createElement('div');
  container.style.cssText = `
    position: absolute;
    visibility: hidden;
    width: ${maxWidth}px;
    font-size: ${fontSize}px;
    font-family: 'InterEdit', ${fontFamily};
    font-weight: ${fontWeight};
    line-height: 1;
    white-space: pre-wrap;
    word-break: break-word;
    margin: 0;
    padding: 0 0 ${fontSize * Math.max(0, totalLineFactor - 1)}px 0;
    font-kerning: none;
    font-feature-settings: "kern" 0;
  `;
  container.textContent = text || ' ';
  document.body.appendChild(container);
  const measured = container.getBoundingClientRect().height;
  document.body.removeChild(container);
  return Math.max(measured, fontSize * totalLineFactor);
}

/**
 * Map a click in element-local coords (slide units) to a cursor offset in
 * the element's source text.
 *
 * Y mapping comes from the SVG layout (`doc.lines[i].yTop/yBottom` is the
 * actual rendered range of source line `i`), so the line we pick is exactly
 * the line under the user's finger. If the layout hasn't resolved yet (rare
 * — steady frames pre-populate the cache), we await it; the caller already
 * runs this on the edit-mode-entry path, which is async-friendly.
 *
 * X mapping uses the DOM Range API against the displayContent of the
 * clicked block, in InterEdit at the same font-size + line-height + kerning
 * settings as the renderer. Browser shaping isn't bit-identical to
 * opentype.js, but with kerning off the per-char advance widths line up
 * within a sub-pixel.
 */
export async function calculateCursorFromClick(
  element: TextElement,
  clickPos: Point,
): Promise<number> {
  const { text, width, height, style } = element;
  if (!text) return 0;

  const padding = TEXT_BOX_PADDING;
  const contentWidth = width - padding * 2;
  const contentHeight = height - padding * 2;

  const doc = getLayoutSync(text, style, contentWidth)
    ?? await layoutSvgText(text, style, contentWidth);

  let verticalOffset = 0;
  if (style.verticalAlign === 'middle') verticalOffset = Math.max(0, (contentHeight - doc.height) / 2);
  else if (style.verticalAlign === 'bottom') verticalOffset = Math.max(0, contentHeight - doc.height);

  const yInContent = clickPos.y - padding - verticalOffset;
  const xInContent = clickPos.x - padding;

  // Find the source line whose [yTop, yBottom) contains the click. Below
  // the last line → snap to the last line.
  const lineIdx = findClickedLine(doc, yInContent);
  const blocks = parseBlocks(text);
  const block = blocks[lineIdx];
  if (!block) return text.length;

  // X-within-line: find the character offset in displayContent under the
  // click. The block may wrap visually; we pass click Y relative to the
  // block top so the Range API can disambiguate rows of a wrapped block.
  const isHeader = block.type === 'h1' || block.type === 'h2' || block.type === 'h3';
  const blockFontSize = style.fontSize * getBlockFontMultiplier(block.type);
  const blockFontWeight = isHeader ? 'bold' : (style.fontWeight || 'normal');
  const yInBlock = yInContent - doc.lines[lineIdx].yTop;
  const charIndex = findCharIndexAt({
    text: block.displayContent,
    fontSize: blockFontSize,
    fontFamily: style.fontFamily,
    fontWeight: blockFontWeight,
    align: style.align,
    boxWidth: contentWidth,
    clickX: xInContent,
    clickY: yInBlock,
  });

  return mapDisplayIndexToSource(block, charIndex);
}

function findClickedLine(doc: SvgTextDoc, yInContent: number): number {
  if (doc.lines.length === 0) return 0;
  for (let i = 0; i < doc.lines.length; i++) {
    if (yInContent < doc.lines[i].yBottom) return i;
  }
  return doc.lines.length - 1;
}

interface CharLookup {
  text: string;
  fontSize: number;
  fontFamily: string;
  fontWeight: string;
  align: string;
  boxWidth: number;
  clickX: number;
  clickY: number;
}

/**
 * Build a hidden DOM mirror of one block's display content in the same font
 * the SVG renderer reads (Inter), then binary-search via Range API to find
 * the character whose center is closest to the click. Kerning is disabled
 * so the browser's per-char advance widths match opentype.js's.
 */
function findCharIndexAt(opts: CharLookup): number {
  const container = document.createElement('div');
  container.style.cssText = `
    position: absolute;
    visibility: hidden;
    width: ${opts.boxWidth}px;
    font-size: ${opts.fontSize}px;
    font-family: 'InterEdit', ${opts.fontFamily};
    font-weight: ${opts.fontWeight};
    line-height: 1;
    white-space: pre-wrap;
    word-break: break-word;
    text-align: ${opts.align};
    margin: 0;
    padding: 0;
    font-kerning: none;
    font-feature-settings: "kern" 0;
  `;
  document.body.appendChild(container);
  const textNode = document.createTextNode(opts.text || ' ');
  container.appendChild(textNode);

  const textLength = opts.text.length;
  if (textLength === 0) {
    document.body.removeChild(container);
    return 0;
  }

  const range = document.createRange();
  const containerRect = container.getBoundingClientRect();
  let low = 0;
  let high = textLength;
  while (low < high) {
    const mid = (low + high) >> 1;
    range.setStart(textNode, mid);
    range.setEnd(textNode, mid + 1);
    const rect = range.getBoundingClientRect();
    const charX = rect.left - containerRect.left;
    const charY = rect.top - containerRect.top;
    if (opts.clickY < charY || (Math.abs(opts.clickY - charY) < rect.height && opts.clickX < charX + rect.width / 2)) {
      high = mid;
    } else {
      low = mid + 1;
    }
  }

  document.body.removeChild(container);
  return low;
}

/**
 * Map a `displayContent`-relative index back to an absolute source offset,
 * respecting markdown inline segments: clicking inside a LaTeX segment
 * places the cursor inside the delimiters, clicking inside a `**bold**`
 * segment lands inside the asterisks, etc.
 */
function mapDisplayIndexToSource(
  block: ReturnType<typeof parseBlocks>[number],
  displayIndex: number,
): number {
  const inlineSourceOffset = block.sourceStart + block.prefixLength;
  const segments = parseInlineSegments(block.displayContent, inlineSourceOffset);
  let acc = 0;
  for (const seg of segments) {
    const segLen = seg.displayContent.length;
    if (displayIndex < acc + segLen) {
      const offsetInSeg = displayIndex - acc;
      if (seg.type === 'latex') {
        const delim = seg.isBlock ? 2 : 1;
        return seg.sourceEnd - delim;
      }
      if (seg.type === 'link') return (seg.linkTextStart ?? seg.sourceStart + 1) + offsetInSeg;
      if (seg.type === 'formatted') return (seg.innerSourceStart ?? seg.sourceStart + 2) + offsetInSeg;
      return seg.sourceStart + offsetInSeg;
    }
    acc += segLen;
  }
  return block.sourceEnd;
}
