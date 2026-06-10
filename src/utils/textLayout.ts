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
import type { SvgPath } from '../components/svg/RenderPaths';
export type { SvgPath } from '../components/svg/RenderPaths';

export interface SvgTextDoc {
  /** Per-glyph paths. The renderer runs them through the same stroke-dash
   *  pipeline for both steady (writeFx undefined → every glyph at full fill)
   *  and Write/Unwrite (writeFx.t drives per-glyph progress). */
  paths: SvgPath[];
  /** Sum of path lengths; drives the Write stroke budget. */
  totalLength: number;
  /** Computed content width (capped at boxWidth). */
  width: number;
  /** Computed content height (sum of line advances). */
  height: number;
  /** One entry per source line (`text.split('\n')`). The edit overlay uses
   *  these to size its contentEditable line divs to match the SVG layout
   *  exactly, so cursor positions line up with the rendered glyphs. */
  lines: Array<{
    /** Top y of this line in layout coordinates (inside the padding-translated
     *  group, so 0 is the first line's top). */
    yTop: number;
    /** Bottom y (exclusive). yBottom - yTop is the line's CSS height. */
    yBottom: number;
    /** Baseline y for this line (yTop + aboveBaseline). */
    baseline: number;
    /** The raw source for this line (markdown markup chars intact). */
    source: string;
  }>;
}

const layoutCache = new Map<string, Promise<SvgTextDoc>>();

function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Parse a MathJax SVG fragment once. Returns the pixel dimensions used for
// layout plus a closure that emits per-glyph paths at a given pen position.
// The closure captures the DOM-walked glyph list and the viewBox-to-pixel
// scale so the layout pass can decide where the math goes and the emission
// pass can produce its paths — without re-parsing the SVG.
//
// Math vertical alignment: MathJax viewBox uses y=0 as the baseline (vbY is
// typically negative). The emit closure computes
// yOffset = baselineY + vbY * scaleY so the math baseline lands exactly on
// the surrounding text baseline.
function parseMathSvg(mathSvg: string, fontPx: number): {
  widthPx: number;
  heightPx: number;
  /** Distance from the math baseline (vb y=0) to the TOP of the math. The
   *  layout pass uses this to push the line baseline DOWN far enough that the
   *  math doesn't intrude into the line above. */
  aboveBaseline: number;
  /** Distance from the math baseline to the BOTTOM. The layout pass uses this
   *  to grow the line's descender room so the math doesn't crash into the
   *  line below either. */
  belowBaseline: number;
  emitPaths: (xCursor: number, baselineY: number, color: string) => SvgPath[];
} | null {
  if (typeof DOMParser === 'undefined') return null;

  const parser = new DOMParser();
  const wrapped = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">${mathSvg}</svg>`;
  const doc = parser.parseFromString(wrapped, 'image/svg+xml');
  if (doc.querySelector('parsererror')) return null;
  const inner = doc.documentElement.querySelector('svg');
  if (!inner) return null;

  // Dimensions: MathJax uses `ex` units; 1ex ≈ 0.5em ≈ 0.5 * fontPx.
  const parseDim = (attr: string | null, fallback: number): number => {
    if (!attr) return fallback;
    const m = attr.match(/^([\d.]+)(ex|em|px)?$/);
    if (!m) return fallback;
    const val = parseFloat(m[1]);
    const unit = m[2];
    if (unit === 'em') return val * fontPx;
    if (unit === 'px') return val;
    return val * fontPx * 0.5;
  };
  const widthPx = parseDim(inner.getAttribute('width'), fontPx);
  const heightPx = parseDim(inner.getAttribute('height'), fontPx);

  const vbAttr = inner.getAttribute('viewBox') || '0 0 1 1';
  const vb = vbAttr.split(/\s+/).map(parseFloat);
  const [vbX, vbY, vbW, vbH] = vb.length === 4 ? vb : [0, 0, 1, 1];
  if (!vbW || !vbH) {
    return { widthPx, heightPx, aboveBaseline: heightPx, belowBaseline: 0, emitPaths: () => [] };
  }
  const scaleX = widthPx / vbW;
  const scaleY = heightPx / vbH;
  // MathJax baseline is at vb y=0. vbY is typically negative (e.g. -792),
  // so -vbY gives the distance from baseline up to the viewBox top; vbY+vbH
  // gives the distance from baseline down to the viewBox bottom.
  const aboveBaseline = -vbY * scaleY;
  const belowBaseline = (vbY + vbH) * scaleY;

  // id → path data lookup from <defs>.
  const defs = new Map<string, string>();
  inner.querySelectorAll('defs path').forEach((p) => {
    const id = p.getAttribute('id');
    const d = p.getAttribute('d');
    if (id && d) defs.set(id, d);
  });

  // Collect every renderable glyph in document order with its accumulated
  // inner-SVG transform. The outer translate+scale is appended at emit time.
  type RawGlyph = { d: string; innerTr: string; localLen: number };
  const raws: RawGlyph[] = [];
  const walk = (el: Element, parentTr: string): void => {
    const tr = el.getAttribute('transform');
    const combinedTr = tr ? (parentTr ? `${parentTr} ${tr}` : tr) : parentTr;

    if (el.localName === 'use') {
      const href = el.getAttribute('href') || el.getAttribute('xlink:href') || '';
      const id = href.startsWith('#') ? href.slice(1) : href;
      const d = defs.get(id);
      if (d) raws.push({ d, innerTr: combinedTr, localLen: pathLengthFor(d) });
      return;
    }
    if (el.localName === 'path' && !el.closest('defs')) {
      const d = el.getAttribute('d');
      if (d) raws.push({ d, innerTr: combinedTr, localLen: pathLengthFor(d) });
      return;
    }
    for (const child of Array.from(el.children)) walk(child, combinedTr);
  };
  for (const child of Array.from(inner.children)) {
    if (child.localName === 'defs') continue;
    walk(child, '');
  }

  const emitPaths = (xCursor: number, baselineY: number, color: string): SvgPath[] => {
    const yOffset = baselineY + vbY * scaleY;
    const outerTr = `translate(${xCursor.toFixed(3)},${yOffset.toFixed(3)}) scale(${scaleX.toFixed(4)},${scaleY.toFixed(4)}) translate(${(-vbX).toFixed(3)},${(-vbY).toFixed(3)})`;
    return raws.map((g) => ({
      d: g.d,
      transform: g.innerTr ? `${outerTr} ${g.innerTr}` : outerTr,
      length: g.localLen * scaleY,
      fillColor: color,
      nonScalingStroke: true,
    }));
  };

  return { widthPx, heightPx, aboveBaseline, belowBaseline, emitPaths };
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
  | {
      kind: 'math';
      widthPx: number;
      heightPx: number;
      /** Distance from baseline to top/bottom of the math — used by the layout
       *  pass to grow the line's ascender/descender room so math doesn't
       *  intrude into adjacent lines. */
      aboveBaseline: number;
      belowBaseline: number;
      /** Captures the parsed MathJax SVG + the color; emits glyph paths at the
       *  given pen position. */
      emitPaths: (xCursor: number, baselineY: number) => SvgPath[];
    };

export async function layoutSvgText(
  text: string,
  style: TextStyle,
  boxWidth: number,
  rawLineIndices?: Set<number>,
): Promise<SvgTextDoc> {
  const rawKey = rawLineIndices && rawLineIndices.size > 0
    ? Array.from(rawLineIndices).sort((a, b) => a - b).join(',')
    : '';
  const key = JSON.stringify([
    text,
    style.fontSize,
    style.fontWeight,
    style.fontStyle,
    style.color,
    style.lineHeight,
    style.align,
    boxWidth,
    rawKey,
  ]);
  const cached = layoutCache.get(key);
  if (cached) return cached;

  const promise = (async (): Promise<SvgTextDoc> => {
    // Per-source-line metrics returned in SvgTextDoc.lines. parseBlocks emits
    // one block per source line; we accumulate yTop/yBottom around each block
    // to give the edit overlay enough info to size its contentEditable line
    // divs to match the SVG layout exactly.
    const linesOut: SvgTextDoc['lines'] = [];
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

    for (let blockIdx = 0; blockIdx < blocks.length; blockIdx++) {
      const block = blocks[blockIdx];
      const sourceLineIdx = blockIdx; // parseBlocks → one block per source line
      const lineYTop = yCursor;
      let lineBaseline = -1;
      const multiplier = getBlockFontMultiplier(block.type);
      const blockFontSize = baseFontSize * multiplier;
      const isHeader = block.type === 'h1' || block.type === 'h2' || block.type === 'h3';
      const blockWeight = isHeader ? 'bold' : String(style.fontWeight ?? 'normal');

      // Empty paragraph → advance one line and continue (mirrors the HTML
      // renderer's `&nbsp;` placeholder behaviour).
      if (!block.displayContent.trim() && block.type === 'paragraph') {
        yCursor += blockFontSize * lineHeight;
        linesOut.push({
          yTop: lineYTop,
          yBottom: yCursor,
          baseline: lineYTop + blockFontSize * 0.8,
          source: block.content,
        });
        continue;
      }

      // Cursor / selected lines: lay out the RAW source text instead of the
      // parsed-markdown segments. The edit overlay needs to see (and edit)
      // the literal markdown chars; doing this through the same SVG renderer
      // guarantees the cursor line looks identical to a non-cursor line in
      // font, weight, and baseline — only the content differs.
      const isRawLine = rawLineIndices?.has(sourceLineIdx) ?? false;
      const segments = isRawLine
        ? [{
            type: 'text' as const,
            content: block.content,
            displayContent: block.content,
            sourceStart: block.sourceStart,
            sourceEnd: block.sourceEnd,
            isBlock: false,
          }]
        : parseInlineSegments(
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
          const parsed = parseMathSvg(mathSvg, blockFontSize);
          if (!parsed) continue;
          const mathColor = style.color;
          const unit: PlacedUnit = {
            kind: 'math',
            widthPx: parsed.widthPx,
            heightPx: parsed.heightPx,
            aboveBaseline: parsed.aboveBaseline,
            belowBaseline: parsed.belowBaseline,
            emitPaths: (x, y) => parsed.emitPaths(x, y, mathColor),
          };
          if (seg.isBlock) {
            if (curLineWidth > 0) startNewLine();
            lines[lines.length - 1].push(unit);
            curLineWidth = parsed.widthPx;
            startNewLine();
          } else {
            if (curLineWidth + parsed.widthPx > boxWidth && curLineWidth > 0) startNewLine();
            lines[lines.length - 1].push(unit);
            curLineWidth += parsed.widthPx;
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
        // Per-line baseline metrics. Math glyphs extend by `aboveBaseline`
        // px above the baseline (often ~0.8 * heightPx for MathJax) and by
        // `belowBaseline` below. If we only used `max(fontSize, mathHeight) *
        // lineHeight` for line spacing, the line baseline would sit
        // `fontSize * 0.8` below yCursor and tall math would extend ABOVE
        // yCursor into the line above. Compute the baseline offset from the
        // actual ascender requirements of everything on this line.
        const mathUnits = line.filter(
          (u): u is Extract<PlacedUnit, { kind: 'math' }> => u.kind === 'math',
        );
        const mathAbove = mathUnits.reduce((m, u) => Math.max(m, u.aboveBaseline), 0);
        const mathBelow = mathUnits.reduce((m, u) => Math.max(m, u.belowBaseline), 0);
        const textAbove = blockFontSize * 0.8;
        const textBelow = blockFontSize * 0.4 * lineHeight;
        const aboveBaseline = Math.max(textAbove, mathAbove);
        const belowBaseline = Math.max(textBelow, mathBelow + blockFontSize * 0.1);
        const lineHeightPx = aboveBaseline + belowBaseline;
        const baseline = yCursor + aboveBaseline;

        const lineContentWidth = line.reduce((a, u) => a + u.widthPx, 0);
        let xOffset = 0;
        if (style.align === 'center') xOffset = Math.max(0, (boxWidth - lineContentWidth) / 2);
        else if (style.align === 'right') xOffset = Math.max(0, boxWidth - lineContentWidth);

        let xCursor = xOffset;
        if (lineBaseline < 0) lineBaseline = baseline;
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
                lineIndex: sourceLineIdx,
              });
            }
            xCursor = endX;
          } else {
            const before = pathsOut.length;
            pathsOut.push(...unit.emitPaths(xCursor, baseline));
            for (let k = before; k < pathsOut.length; k++) pathsOut[k].lineIndex = sourceLineIdx;
            xCursor += unit.widthPx;
          }
        }
        yCursor += lineHeightPx;
      }
      linesOut.push({
        yTop: lineYTop,
        yBottom: yCursor,
        baseline: lineBaseline >= 0 ? lineBaseline : lineYTop + blockFontSize * 0.8,
        source: block.content,
      });
    }

    const totalHeight = yCursor;
    const totalWidth = Math.min(boxWidth, Math.max(maxLineWidth, 1));
    const totalLength = pathsOut.reduce((s, p) => s + p.length, 0);

    return {
      paths: pathsOut,
      totalLength,
      width: totalWidth,
      height: totalHeight,
      lines: linesOut,
    };
  })();

  layoutCache.set(key, promise);
  return promise;
}

export function clearTextLayoutCache(): void {
  layoutCache.clear();
}
