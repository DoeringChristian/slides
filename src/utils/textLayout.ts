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
import { loadFont, textToGlyphPaths, pathLengthFor } from './glyphPaths';

export interface SvgPath {
  d: string;
  transform: string;
  /** Length used both for the budget and for stroke-dasharray. In SCREEN
   *  pixels — for text paths that's the local length (no transform scaling),
   *  for math paths it's local length × scaleY. Combined with
   *  vectorEffect="non-scaling-stroke" on math paths, stroke attributes land
   *  in screen-pixel space so the dash and length match up. */
  length: number;
  fillColor: string;
  /** Math paths render inside a heavy scale-down transform; without
   *  non-scaling-stroke their stroke-width shrinks to invisibility. */
  nonScalingStroke: boolean;
}

export interface SvgTextDoc {
  /** SVG fragment string ready for `innerHTML` on a <g> element. */
  svgMarkup: string;
  /** Phase 2: per-glyph paths for Write effect. Empty in Phase 1. */
  paths: SvgPath[];
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

// MathJax emits the outer <svg> with width/height in `ex` units (or em/px) and
// a viewBox like "0 -792 2756 999" where y=0 in vb-space is the math baseline.
// Returns pixel dims plus the viewBox vertical metrics so the layout can land
// the math baseline exactly on the text baseline (used by both Phase 1 steady
// and Phase 2 flatten — they MUST agree or the math jumps at transition end).
function parseMathSvgSize(svgMarkup: string, fontPx: number): {
  widthPx: number;
  heightPx: number;
  vbY: number;
  vbH: number;
} {
  const widthMatch = svgMarkup.match(/<svg[^>]*\bwidth="([\d.]+)(ex|em|px)?"/);
  const heightMatch = svgMarkup.match(/<svg[^>]*\bheight="([\d.]+)(ex|em|px)?"/);
  const vbMatch = svgMarkup.match(/<svg[^>]*\bviewBox="([^"]+)"/);
  const toPx = (val: number, unit: string | undefined): number => {
    if (unit === 'em') return val * fontPx;
    if (unit === 'px') return val;
    return val * fontPx * 0.5;
  };
  let vbY = 0;
  let vbH = 1;
  if (vbMatch) {
    const parts = vbMatch[1].split(/\s+/).map(parseFloat);
    if (parts.length === 4) {
      vbY = parts[1];
      vbH = parts[3] || 1;
    }
  }
  return {
    widthPx: widthMatch ? toPx(parseFloat(widthMatch[1]), widthMatch[2]) : fontPx,
    heightPx: heightMatch ? toPx(parseFloat(heightMatch[1]), heightMatch[2]) : fontPx,
    vbY,
    vbH,
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
  | { kind: 'math'; svg: string; widthPx: number; heightPx: number; vbY: number; vbH: number; color: string };

/**
 * Flatten a MathJax SVG fragment into per-glyph paths suitable for stroke
 * animation. Resolves <use href> references against the SVG's <defs>, chains
 * ancestor transforms, and maps from the math's viewBox units into our layout
 * pixel coordinates.
 *
 * Vertical alignment: MathJax SVGs have viewBox like "0 -792 2756.4 999.8"
 * where y=0 in viewBox space is the math baseline. We compute yOffset so that
 * after the scale + viewBox-origin translation, the math's baseline lines up
 * exactly with the surrounding text baseline.
 */
function flattenMathSvgToPaths(
  mathSvg: string,
  xCursor: number,
  baselineY: number,
  widthPx: number,
  heightPx: number,
  vbY: number,
  vbH: number,
  color: string,
): Array<{ d: string; transform: string; length: number; fillColor: string; nonScalingStroke: boolean }> {
  if (typeof DOMParser === 'undefined') return [];

  const parser = new DOMParser();
  const wrapped = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">${mathSvg}</svg>`;
  const doc = parser.parseFromString(wrapped, 'image/svg+xml');
  if (doc.querySelector('parsererror')) return [];

  // The wrapping <svg> contains the MathJax <svg> as its first/only child.
  const inner = doc.documentElement.querySelector('svg');
  if (!inner) return [];

  const vbAttr = inner.getAttribute('viewBox') || '0 0 1 1';
  const vb = vbAttr.split(/\s+/).map(parseFloat);
  const [vbX, , vbW] = vb.length === 4 ? vb : [0, 0, 1, 1];
  if (!vbW || !vbH) return [];

  const scaleX = widthPx / vbW;
  const scaleY = heightPx / vbH;

  // baselineY = top-of-svg + heightPx * (-vbY)/vbH (the baseline is at vb y=0;
  // that lands `heightPx*(-vbY)/vbH` below the SVG top). Solve for top:
  // top = baselineY - heightPx*(-vbY)/vbH = baselineY + vbY*scaleY.
  // Outer translate then scale then origin-translate puts (0,0)_layout at the
  // viewBox top-left, which matches `top`.
  const yOffset = baselineY + vbY * scaleY;
  const outerTr = `translate(${xCursor.toFixed(3)},${yOffset.toFixed(3)}) scale(${scaleX.toFixed(4)},${scaleY.toFixed(4)}) translate(${(-vbX).toFixed(3)},${(-vbY).toFixed(3)})`;

  // id → path data lookup from <defs>.
  const defs = new Map<string, string>();
  inner.querySelectorAll('defs path').forEach((p) => {
    const id = p.getAttribute('id');
    const d = p.getAttribute('d');
    if (id && d) defs.set(id, d);
  });

  const out: Array<{ d: string; transform: string; length: number; fillColor: string; nonScalingStroke: boolean }> = [];

  const walk = (el: Element, parentTr: string): void => {
    const tr = el.getAttribute('transform');
    const combinedTr = tr ? `${parentTr} ${tr}` : parentTr;

    if (el.localName === 'use') {
      const href = el.getAttribute('href') || el.getAttribute('xlink:href') || '';
      const id = href.startsWith('#') ? href.slice(1) : href;
      const d = defs.get(id);
      if (d) {
        // Path length is measured in the path's LOCAL (viewBox-units) space.
        // The Write budget needs to be comparable across text glyphs and math
        // glyphs; multiply by the per-axis scale (use scaleY since math glyph
        // strokes are roughly isotropic post-scale).
        const localLen = pathLengthFor(d);
        out.push({
          d,
          transform: combinedTr,
          length: localLen * scaleY,
          fillColor: color,
          nonScalingStroke: true,
        });
      }
      return;
    }
    if (el.localName === 'path' && !el.closest('defs')) {
      const d = el.getAttribute('d');
      if (d) {
        const localLen = pathLengthFor(d);
        out.push({
          d,
          transform: combinedTr,
          length: localLen * scaleY,
          fillColor: color,
          nonScalingStroke: true,
        });
      }
      return;
    }
    for (const child of Array.from(el.children)) {
      walk(child, combinedTr);
    }
  };

  for (const child of Array.from(inner.children)) {
    if (child.localName === 'defs') continue;
    walk(child, outerTr);
  }

  return out;
}

export async function layoutSvgText(
  text: string,
  style: TextStyle,
  boxWidth: number,
): Promise<SvgTextDoc> {
  const key = JSON.stringify([
    text,
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
    // Pre-load every font variant up front. Single rendering pipeline ⇒ we
    // always need them (steady frame uses path rendering too).
    const [fontRegular, fontBold, fontItalic, fontBoldItalic] = await Promise.all([
      loadFont('normal', 'normal'),
      loadFont('bold', 'normal'),
      loadFont('normal', 'italic'),
      loadFont('bold', 'italic'),
    ]);
    const pickFont = (weight: string, fs: string) => {
      const bold = weight === 'bold' || Number(weight) >= 600;
      const italic = fs === 'italic';
      if (bold && italic) return fontBoldItalic;
      if (bold) return fontBold;
      if (italic) return fontItalic;
      return fontRegular;
    };

    const blocks = parseBlocks(text || '');
    const baseFontSize = style.fontSize;
    const lineHeight = style.lineHeight || 1.2;
    const pathsOut: SvgPath[] = [];
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
          const { widthPx, heightPx, vbY, vbH } = parseMathSvgSize(mathSvg, blockFontSize);
          if (seg.isBlock) {
            if (curLineWidth > 0) startNewLine();
            lines[lines.length - 1].push({ kind: 'math', svg: mathSvg, widthPx, heightPx, vbY, vbH, color: style.color });
            curLineWidth = widthPx;
            startNewLine();
          } else {
            if (curLineWidth + widthPx > boxWidth && curLineWidth > 0) startNewLine();
            lines[lines.length - 1].push({ kind: 'math', svg: mathSvg, widthPx, heightPx, vbY, vbH, color: style.color });
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

        const font = pickFont(weight, fontStyle);

        // Word-level wrap (split on whitespace but keep whitespace tokens).
        // Width comes from opentype advance widths — the SAME calc used for
        // path emission, so wrap positions cannot disagree with the final
        // pen positions.
        const words = txt.split(/(\s+)/);
        for (const word of words) {
          if (!word) continue;
          const { endX } = textToGlyphPaths(word, font, blockFontSize, 0, 0);
          const wpx = endX;
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
            const font = pickFont(unit.weight, unit.fontStyle);
            const { glyphs, endX } = textToGlyphPaths(unit.text, font, blockFontSize, xCursor, baseline);
            for (const g of glyphs) {
              pathsOut.push({
                d: g.d,
                transform: `translate(${g.x.toFixed(2)},${g.y.toFixed(2)})`,
                length: g.length,
                fillColor: unit.color,
                nonScalingStroke: false,
              });
            }
            xCursor = endX;
          } else {
            const flat = flattenMathSvgToPaths(unit.svg, xCursor, baseline, unit.widthPx, unit.heightPx, unit.vbY, unit.vbH, unit.color);
            pathsOut.push(...flat);
            xCursor += unit.widthPx;
          }
        }
        yCursor += lineHeightPx;
      }
    }

    const totalHeight = yCursor;
    const totalWidth = Math.min(boxWidth, Math.max(maxLineWidth, 1));
    const totalLength = pathsOut.reduce((s, p) => s + p.length, 0);

    return {
      svgMarkup: '',
      paths: pathsOut,
      totalLength,
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
