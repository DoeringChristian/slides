import { parseTransformChain } from '../animation/morphGeometry';
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

import { parseBlocks, parseInlineSegments, getBlockFontMultiplier } from '../../components/canvas/CustomMarkdownRenderer';
import type { InlineSegment } from '../../components/canvas/CustomMarkdownRenderer';
import type { TextStyle } from '../../types/presentation';
import { texFragmentToSvg } from '../../services/latexToSvg';
import { loadFont, textToGlyphPaths, pathLengthFor } from './glyphPaths';
import { resolveMathFont } from './fontRegistry';
import type { SvgPath } from '../../components/svg/RenderPaths';
export type { SvgPath } from '../../components/svg/RenderPaths';

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

/**
 * Keys touched while recording, used to bake a deck's layouts for export.
 *
 * Recorded at the point of lookup rather than derived separately: auto-content
 * text lays out twice (unwrapped, then re-wrapped at its measured width), so
 * any attempt to recompute the key set outside this module would drift from
 * what the renderer actually asks for.
 */
let recordedKeys: Set<string> | null = null;
// Settled-result mirror of layoutCache so hit-testing and hit-rect sizing
// can read the same layout the SVG renderer used, without each one DOM-
// measuring its own approximation. Populated as soon as each promise
// resolves; queried via getLayoutSync.
const syncLayoutCache = new Map<string, SvgTextDoc>();

function layoutCacheKey(
  text: string,
  style: TextStyle,
  boxWidth: number,
  rawLineIndices?: Set<number>,
): string {
  const rawKey = rawLineIndices && rawLineIndices.size > 0
    ? Array.from(rawLineIndices).sort((a, b) => a - b).join(',')
    : '';
  return JSON.stringify([
    text,
    // Family and math font change the glyph outlines, so they are part of the
    // identity of a layout — omitting them serves the previous font's result.
    style.fontFamily,
    style.mathFont,
    style.fontSize,
    style.fontWeight,
    style.fontStyle,
    style.color,
    style.lineHeight,
    style.align,
    boxWidth,
    rawKey,
  ]);
}

/** Start collecting the layout keys the renderer asks for. */
export function startLayoutRecording(): void {
  recordedKeys = new Set();
}

/**
 * Stop recording and return the settled layouts for every key touched.
 *
 * A key with no settled entry is skipped: it was still in flight, and a
 * missing bake falls back to live layout rather than rendering nothing.
 */
export function finishLayoutRecording(): Record<string, SvgTextDoc> {
  const out: Record<string, SvgTextDoc> = {};
  for (const key of recordedKeys ?? []) {
    const doc = syncLayoutCache.get(key);
    if (doc) out[key] = doc;
  }
  recordedKeys = null;
  return out;
}

/**
 * Install pre-computed layouts, as produced by `finishLayoutRecording`.
 *
 * Priming both caches is the whole mechanism: every lookup already goes
 * through them, so a player with a full bake never parses a font, never loads
 * MathJax, and resolves synchronously on the first frame.
 */
export function primeLayoutCache(entries: Record<string, SvgTextDoc>): void {
  for (const [key, doc] of Object.entries(entries)) {
    layoutCache.set(key, Promise.resolve(doc));
    syncLayoutCache.set(key, doc);
  }
}

/**
 * Returns the cached SvgTextDoc for these inputs if the SVG renderer has
 * already laid them out, or null otherwise. Callers (hit-testing, hit-rect
 * sizing) read from this instead of rolling their own DOM-measurement
 * estimate, which guarantees they agree with what the user actually sees.
 */
export function getLayoutSync(
  text: string,
  style: TextStyle,
  boxWidth: number,
  rawLineIndices?: Set<number>,
): SvgTextDoc | null {
  return syncLayoutCache.get(layoutCacheKey(text, style, boxWidth, rawLineIndices)) ?? null;
}

/**
 * Vertical alignment offset of a laid-out text block inside its element box.
 * Extracted from SVGTextPaths so every consumer of a layout (the renderer
 * itself, RenderMorph's glyph-outline extraction, hit-testing) computes the
 * SAME glyph positions. `contentHeight` is `SvgTextDoc.height`.
 */
export function textVerticalOffset(
  verticalAlign: TextStyle['verticalAlign'],
  boxHeight: number,
  padding: number,
  contentHeight: number,
): number {
  if (verticalAlign === 'middle') {
    return Math.max(0, (boxHeight - padding * 2 - contentHeight) / 2);
  }
  if (verticalAlign === 'bottom') {
    return Math.max(0, boxHeight - padding * 2 - contentHeight);
  }
  return 0;
}

/** The plain-text strut shared by SVG rows and native editing line boxes. */
export function textRowMetrics(fontSize: number, lineHeight: number) {
  const baseline = fontSize * 0.8;
  const advance = baseline + fontSize * 0.4 * (lineHeight || 1.2);
  return { baseline, advance };
}

const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
// Typographic breakable spaces are word boundaries, not emergency word splits.
// NBSP (00A0), figure space (2007), and narrow NBSP (202F) deliberately stay
// inside their word. Only ASCII spaces/tabs hang in the alignment pass below.
// Keep ASCII runs separate so their trailing suffix can hang even when a
// typographic space immediately precedes it; the latter still takes up width.
const breakableTextSpaces = /([ \t]+|[\u2000-\u2006\u2008-\u200a\u205f\u3000]+)/;
const onlyBreakableTextSpaces = /^[ \t\u2000-\u2006\u2008-\u200a\u205f\u3000]+$/;

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

  // Size comes from the viewBox, NOT from the width/height attributes.
  //
  // MathJax states those in `ex`, and one ex is the chosen font's x-height —
  // 0.442em for newcm, different for every other math font. Reading them as
  // a flat 0.5em (as this did) renders every equation ~13% oversized for
  // newcm, with the baseline offsets inflated to match, so math sat too big
  // and too low against its own text. Worse, width and height are rounded to
  // three decimals, so scaleX and scaleY came out unequal and each glyph was
  // very slightly stretched.
  //
  // The viewBox is in MathJax's own unit of 1/1000 em, which needs no font
  // metrics and no rounding: one uniform scale, exact at any font size.
  const vb = (inner.getAttribute('viewBox') || '').split(/\s+/).map(parseFloat);
  if (vb.length !== 4 || vb.some((v) => !Number.isFinite(v))) return null;
  const [vbX, vbY, vbW, vbH] = vb;
  if (!vbW || !vbH) return null;
  const scale = fontPx / 1000;
  const scaleX = scale, scaleY = scale;
  const widthPx = vbW * scale;
  const heightPx = vbH * scale;
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
    return raws.map((g) => {
      const transform = g.innerTr ? `${outerTr} ${g.innerTr}` : outerTr;
      const [a,b,c,d] = parseTransformChain(transform);
      // Include nested MathJax scales (subscripts, superscripts, stretchy
      // glyphs). Compensate only glyph-local scale, never the slide viewport.
      const glyphScale = Math.sqrt(Math.abs(a*d-b*c)) || 1;
      return {
        d: g.d, transform, length: g.localLen * glyphScale,
        fillColor: color, nonScalingStroke: false, strokeScale: 1 / glyphScale,
      };
    });
  };

  return { widthPx, heightPx, aboveBaseline, belowBaseline, emitPaths };
}

/** Convert one `$…$` / `$$…$$` segment to drawable geometry, or null when it
 *  cannot be drawn (bad TeX, or no DOMParser in this environment). */
async function parseMathSegment(
  seg: InlineSegment,
  style: TextStyle,
  fontPx: number,
): Promise<ReturnType<typeof parseMathSvg>> {
  try {
    const svg = await texFragmentToSvg(
      seg.displayContent,
      seg.isBlock,
      resolveMathFont(style.fontFamily, style.mathFont).id,
    );
    return parseMathSvg(svg, fontPx);
  } catch {
    return null;
  }
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
  const key = layoutCacheKey(text, style, boxWidth, rawLineIndices);
  recordedKeys?.add(key);
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
    const family = style.fontFamily;
    const [fontRegular, fontBold, fontItalic, fontBoldItalic] = await Promise.all([
      loadFont(family, 'normal', 'normal'),
      loadFont(family, 'bold', 'normal'),
      loadFont(family, 'normal', 'italic'),
      loadFont(family, 'bold', 'italic'),
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
      if (!block.displayContent && block.type === 'paragraph') {
        yCursor += textRowMetrics(blockFontSize, lineHeight).advance;
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
        // Math follows the element's own choice, else whatever its text font
        // pairs with — so prose and equations match by default. Null means
        // "could not be drawn": either the TeX did not convert or there is no
        // DOMParser in this environment.
        const parsed = seg.type === 'latex'
          ? await parseMathSegment(seg, style, blockFontSize)
          : null;
        if (parsed) {
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

        // text | formatted | link, and any math that could not be drawn.
        //
        // That last case used to `continue` here, which DELETED the segment:
        // an unconvertible expression left a hole in the line, so it read as
        // "math is not rendering" rather than "this formula is wrong". Laying
        // the source out as ordinary text keeps it visible, selectable and
        // editable.
        let weight = blockWeight;
        let fontStyle = style.fontStyle || 'normal';
        let decoration = '';
        let color = style.color;
        // Delimiters included for unconverted math, so what is on the slide
        // is exactly what has to be corrected.
        const txt = seg.type === 'latex' ? seg.content : seg.displayContent;
        if (seg.type === 'formatted') {
          if (seg.bold) weight = 'bold';
          if (seg.italic) fontStyle = 'italic';
          decoration = buildTextDecoration(Boolean(seg.underline), Boolean(seg.strikethrough));
        }
        if (seg.type === 'link') color = '#2563eb';

        const font = pickFont(weight, fontStyle);

        // Match native pre-wrap + overflow-wrap:break-word: preserve spaces,
        // hang trailing spaces for alignment, and split only overlong words at
        // grapheme boundaries (never inside a surrogate pair/combining cluster).
        const placeText = (value: string, widthPx: number) => {
          lines[lines.length - 1].push({
            kind: 'text', text: value, widthPx, weight, fontStyle, decoration, color,
          });
          curLineWidth += widthPx;
        };
        for (const word of txt.split(breakableTextSpaces)) {
          if (!word) continue;
          const wpx = textToGlyphPaths(word, font, blockFontSize, 0, 0).endX;
          const isWhitespace = onlyBreakableTextSpaces.test(word);
          if (!isWhitespace && curLineWidth + wpx > boxWidth && curLineWidth > 0) startNewLine();
          if (!isWhitespace && wpx > boxWidth) {
            let run = '';
            let runWidth = 0;
            for (const { segment } of graphemes.segment(word)) {
              const nextWidth = textToGlyphPaths(run + segment, font, blockFontSize, 0, 0).endX;
              if (run && curLineWidth + nextWidth > boxWidth) {
                placeText(run, runWidth);
                startNewLine();
                run = segment;
                runWidth = textToGlyphPaths(segment, font, blockFontSize, 0, 0).endX;
              } else {
                run += segment;
                runWidth = nextWidth;
              }
            }
            if (run) placeText(run, runWidth);
          } else placeText(word, wpx);
        }
      }
      maxLineWidth = Math.max(maxLineWidth, curLineWidth);

      // Render each line.
      for (const [rowIndex, line] of lines.entries()) {
        if (line.length === 0) {
          yCursor += textRowMetrics(blockFontSize, lineHeight).advance;
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
        const metrics = textRowMetrics(blockFontSize, lineHeight);
        const textAbove = metrics.baseline;
        const textBelow = metrics.advance - metrics.baseline;
        const aboveBaseline = Math.max(textAbove, mathAbove);
        // Math-only rows have their own descenders. A plain-text strut
        // otherwise adds half an em of empty space below equations. Keep
        // that strut for mixed text/math and raw-source editing.
        const hasText = line.some(u => u.kind === 'text' && u.text.trim().length > 0);
        const belowBaseline = Math.max(hasText || !mathUnits.length ? textBelow : 0, mathBelow + blockFontSize * 0.1);
        const lineHeightPx = aboveBaseline + belowBaseline;
        const baseline = yCursor + aboveBaseline;

        // Spaces before a soft wrap hang; fitting spaces at a source-line
        // end (including before an explicit newline) still take up width.
        let contentEnd = line.length;
        while (rowIndex < lines.length - 1 && contentEnd > 0) {
          const last = line[contentEnd - 1];
          if (last.kind !== 'text' || !/^[ \t]+$/.test(last.text)) break;
          contentEnd--;
        }
        const lineContentWidth = line.slice(0, contentEnd).reduce((a, u) => a + u.widthPx, 0);
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
  promise.then((d) => { syncLayoutCache.set(key, d); }, () => {});
  return promise;
}

export function clearTextLayoutCache(): void {
  layoutCache.clear();
  syncLayoutCache.clear();
}
