/**
 * Lay out a markdown + LaTeX text element into a self-contained SVG fragment.
 *
 * Combines our existing markdown parser (parseBlocks + parseInlineSegments) with
 * MathJax-rendered math (via latexToSvg). The result is a string ready to drop
 * into a <g> via innerHTML, with all glyphs as SVG <text> or <path> primitives
 * (no foreignObject, no HTML).
 *
 * Caching: keyed by (text + style + boxWidth). The text-element object never
 * stores rendered output — the layout cache lives here in module scope. Same
 * inputs ⇒ instant cached return.
 */

import { parseBlocks, parseInlineSegments, getBlockFontMultiplier } from '../components/canvas/CustomMarkdownRenderer';
import type { TextStyle } from '../types/presentation';
import { texFragmentToSvg } from '../services/latexToSvg';

export interface SvgTextDoc {
  /** SVG fragment string ready for `innerHTML` on a <g> element. */
  svgMarkup: string;
  /** Phase 2: per-glyph paths for Write effect. Empty in Phase 1. */
  paths: Array<{ d: string; transform: string; length: number; fillColor: string }>;
  /** Phase 2: sum of path lengths; drives the Write stroke budget. */
  totalLength: number;
  /** Computed content width (capped at boxWidth). */
  width: number;
  /** Computed content height (sum of line advances). */
  height: number;
}

const layoutCache = new Map<string, Promise<SvgTextDoc>>();

function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Canvas-based text width measurement. Cheap and accurate for layout.
let measureCanvas: HTMLCanvasElement | null = null;
function measureText(text: string, fontPx: number, weight: string, fontStyle: string, family: string): number {
  if (typeof document === 'undefined') return text.length * fontPx * 0.5;
  if (!measureCanvas) measureCanvas = document.createElement('canvas');
  const ctx = measureCanvas.getContext('2d');
  if (!ctx) return text.length * fontPx * 0.5;
  ctx.font = `${fontStyle} ${weight} ${fontPx}px ${family}`;
  return ctx.measureText(text).width;
}

// MathJax emits the outer <svg> with width/height in `ex` units (or em/px).
// 1ex ≈ 0.5em ≈ 0.5 * fontPx. Parse to pixels.
function parseMathSvgSize(svgMarkup: string, fontPx: number): { widthPx: number; heightPx: number } {
  const widthMatch = svgMarkup.match(/<svg[^>]*\bwidth="([\d.]+)(ex|em|px)?"/);
  const heightMatch = svgMarkup.match(/<svg[^>]*\bheight="([\d.]+)(ex|em|px)?"/);
  const toPx = (val: number, unit: string | undefined): number => {
    if (unit === 'em') return val * fontPx;
    if (unit === 'px') return val;
    return val * fontPx * 0.5;
  };
  return {
    widthPx: widthMatch ? toPx(parseFloat(widthMatch[1]), widthMatch[2]) : fontPx,
    heightPx: heightMatch ? toPx(parseFloat(heightMatch[1]), heightMatch[2]) : fontPx,
  };
}

function buildTextDecoration(underline: boolean, strikethrough: boolean): string {
  const parts: string[] = [];
  if (underline) parts.push('underline');
  if (strikethrough) parts.push('line-through');
  return parts.join(' ');
}

type PlacedUnit =
  | {
      kind: 'text';
      text: string;
      widthPx: number;
      weight: string;
      fontStyle: string;
      decoration: string;
      color: string;
    }
  | { kind: 'math'; svg: string; widthPx: number; heightPx: number };

export async function layoutSvgText(
  text: string,
  style: TextStyle,
  boxWidth: number,
  _emitPaths: boolean = false,
): Promise<SvgTextDoc> {
  const key = JSON.stringify([
    text,
    style.fontFamily,
    style.fontSize,
    style.fontWeight,
    style.fontStyle,
    style.color,
    style.lineHeight,
    style.align,
    boxWidth,
  ]);
  const cached = layoutCache.get(key);
  if (cached) return cached;

  const promise = (async (): Promise<SvgTextDoc> => {
    const blocks = parseBlocks(text || '');
    const baseFontSize = style.fontSize;
    const lineHeight = style.lineHeight || 1.2;
    const parts: string[] = [];
    let yCursor = 0;
    let maxLineWidth = 0;

    for (const block of blocks) {
      const multiplier = getBlockFontMultiplier(block.type);
      const blockFontSize = baseFontSize * multiplier;
      const isHeader = block.type === 'h1' || block.type === 'h2' || block.type === 'h3';
      const blockWeight = isHeader ? 'bold' : String(style.fontWeight ?? 'normal');

      // Empty paragraph → advance one line and continue (mirrors the HTML
      // renderer's `&nbsp;` placeholder behaviour).
      if (!block.displayContent.trim() && block.type === 'paragraph') {
        yCursor += blockFontSize * lineHeight;
        continue;
      }

      const segments = parseInlineSegments(
        block.displayContent,
        block.sourceStart + block.prefixLength,
      );

      // Build line[] from segments. Each line is a list of placed units.
      const lines: PlacedUnit[][] = [[]];
      let curLineWidth = 0;
      const startNewLine = (): void => {
        maxLineWidth = Math.max(maxLineWidth, curLineWidth);
        lines.push([]);
        curLineWidth = 0;
      };

      for (const seg of segments) {
        if (seg.type === 'latex') {
          let mathSvg: string;
          try {
            mathSvg = await texFragmentToSvg(seg.displayContent, seg.isBlock);
          } catch {
            mathSvg = `<text fill="#d1242f" font-size="${blockFontSize * 0.8}" font-family="monospace">${escapeXml(seg.content)}</text>`;
          }
          const { widthPx, heightPx } = parseMathSvgSize(mathSvg, blockFontSize);
          if (seg.isBlock) {
            if (curLineWidth > 0) startNewLine();
            lines[lines.length - 1].push({ kind: 'math', svg: mathSvg, widthPx, heightPx });
            curLineWidth = widthPx;
            startNewLine();
          } else {
            if (curLineWidth + widthPx > boxWidth && curLineWidth > 0) startNewLine();
            lines[lines.length - 1].push({ kind: 'math', svg: mathSvg, widthPx, heightPx });
            curLineWidth += widthPx;
          }
          continue;
        }

        // text | formatted | link
        let weight = blockWeight;
        let fontStyle = style.fontStyle || 'normal';
        let decoration = '';
        let color = style.color;
        const txt = seg.displayContent;
        if (seg.type === 'formatted') {
          if (seg.bold) weight = 'bold';
          if (seg.italic) fontStyle = 'italic';
          decoration = buildTextDecoration(Boolean(seg.underline), Boolean(seg.strikethrough));
        }
        if (seg.type === 'link') color = '#2563eb';

        // Word-level wrap (split on whitespace but keep whitespace tokens).
        const words = txt.split(/(\s+)/);
        for (const word of words) {
          if (!word) continue;
          const wpx = measureText(word, blockFontSize, weight, fontStyle, style.fontFamily);
          const isWhitespace = !word.trim();
          if (!isWhitespace && curLineWidth + wpx > boxWidth && curLineWidth > 0) {
            startNewLine();
          }
          if (isWhitespace && curLineWidth === 0) continue; // drop leading whitespace
          lines[lines.length - 1].push({
            kind: 'text',
            text: word,
            widthPx: wpx,
            weight,
            fontStyle,
            decoration,
            color,
          });
          curLineWidth += wpx;
        }
      }
      maxLineWidth = Math.max(maxLineWidth, curLineWidth);

      // Render each line.
      for (const line of lines) {
        if (line.length === 0) {
          yCursor += blockFontSize * lineHeight;
          continue;
        }
        const lineMathHeight = line
          .filter((u): u is Extract<PlacedUnit, { kind: 'math' }> => u.kind === 'math')
          .reduce((m, u) => Math.max(m, u.heightPx), 0);
        const lineHeightPx = Math.max(blockFontSize, lineMathHeight) * lineHeight;
        const baseline = yCursor + blockFontSize * 0.8;

        const lineContentWidth = line.reduce((a, u) => a + u.widthPx, 0);
        let xOffset = 0;
        if (style.align === 'center') xOffset = Math.max(0, (boxWidth - lineContentWidth) / 2);
        else if (style.align === 'right') xOffset = Math.max(0, boxWidth - lineContentWidth);

        let xCursor = xOffset;
        for (const unit of line) {
          if (unit.kind === 'text') {
            const decAttr = unit.decoration ? ` text-decoration="${unit.decoration}"` : '';
            parts.push(
              `<text x="${xCursor.toFixed(2)}" y="${baseline.toFixed(2)}" fill="${unit.color}" font-size="${blockFontSize}" font-family="${escapeXml(style.fontFamily)}" font-weight="${unit.weight}" font-style="${unit.fontStyle}"${decAttr} xml:space="preserve">${escapeXml(unit.text)}</text>`,
            );
          } else {
            // Math goes baseline-aligned. MathJax SVGs typically extend a bit
            // above and below the baseline; translate so the visual baseline
            // lands near the text baseline (0.7 of fontPx down works well).
            parts.push(
              `<g transform="translate(${xCursor.toFixed(2)},${(baseline - blockFontSize * 0.7).toFixed(2)})">${unit.svg}</g>`,
            );
          }
          xCursor += unit.widthPx;
        }
        yCursor += lineHeightPx;
      }
    }

    const totalHeight = yCursor;
    const totalWidth = Math.min(boxWidth, Math.max(maxLineWidth, 1));

    return {
      svgMarkup: parts.join(''),
      paths: [],
      totalLength: 0,
      width: totalWidth,
      height: totalHeight,
    };
  })();

  layoutCache.set(key, promise);
  return promise;
}

export function clearTextLayoutCache(): void {
  layoutCache.clear();
}
