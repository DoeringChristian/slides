/**
 * opentype.js wrapper that gives us per-glyph SVG path data for plain text.
 *
 * Used by the Write/Unwrite text transition: we need every glyph as a stroked
 * <path> with a known length so the animation can drive stroke-dashoffset
 * along each glyph in turn. opentype.js is the only sensible way to get this
 * in a browser; no system-font path is exposed by the web platform.
 *
 * Initial release ships Inter only; the Write effect renders all plain text
 * as Inter regardless of `style.fontFamily`. Multi-font support is a
 * follow-up — the resolveFontUrl table is the single registration point.
 */
import { parse as parseFont, type Font } from 'opentype.js';
import interRegularUrl from '../assets/fonts/Inter-Regular.ttf';
import interBoldUrl from '../assets/fonts/Inter-Bold.ttf';
import interItalicUrl from '../assets/fonts/Inter-Italic.ttf';
import interBoldItalicUrl from '../assets/fonts/Inter-BoldItalic.ttf';

export interface GlyphPath {
  /** SVG path data, local to the pen position. */
  d: string;
  /** x position of the pen for this glyph in text-layout coordinates. */
  x: number;
  /** baseline y for this glyph in text-layout coordinates. */
  y: number;
  /** Width to advance to the next glyph. */
  advance: number;
  /** Total path length, used by the Write effect for stroke-dasharray. */
  length: number;
}

type Weight = 'normal' | 'bold';
type Style = 'normal' | 'italic';

function resolveFontUrl(weight: Weight, style: Style): string {
  // URLs come from Vite imports so the bundler decides:
  //   editor build → hashed asset served from /slides/assets/Inter-*.<hash>.ttf
  //   standalone build → inlined as data: URL (assetsInlineLimit: 100MB)
  // Either way the runtime fetch finds the bytes without depending on a
  // sibling `fonts/` directory next to the HTML — which the single-file
  // standalone export doesn't have.
  if (weight === 'bold' && style === 'italic') return interBoldItalicUrl;
  if (weight === 'bold') return interBoldUrl;
  if (style === 'italic') return interItalicUrl;
  return interRegularUrl;
}

const fontCache = new Map<string, Promise<Font>>();

export function loadFont(weight: Weight, style: Style): Promise<Font> {
  const key = `${weight}|${style}`;
  const hit = fontCache.get(key);
  if (hit) return hit;
  const url = resolveFontUrl(weight, style);
  const p = fetch(url)
    .then((res) => {
      if (!res.ok) throw new Error(`Font ${url} returned HTTP ${res.status}`);
      return res.arrayBuffer();
    })
    .then((buf) => parseFont(buf));
  fontCache.set(key, p);
  // Drop the cache entry on failure so retries are possible.
  p.catch(() => fontCache.delete(key));
  return p;
}

/**
 * Kick off all four font fetches eagerly so they're parsed and cached by the
 * time any Write transition fires. Without this, the first transition lasts
 * less than the font fetch takes and the WritePaths render never appears
 * before the animation has completed.
 */
export function prewarmFonts(): void {
  if (typeof document === 'undefined') return;
  loadFont('normal', 'normal');
  loadFont('bold', 'normal');
  loadFont('normal', 'italic');
  loadFont('bold', 'italic');
}

/**
 * Inject @font-face declarations for the same bundled Inter TTFs that
 * opentype parses, so the HTML edit overlay can render its text in the same
 * font as the SVG path renderer. Without this, edit mode falls back to the
 * element's style.fontFamily (Arial, Helvetica, etc.) and the layout shifts
 * visibly when entering / leaving edit mode.
 *
 * Idempotent: only injects once per page load.
 */
let fontFaceInjected = false;
export function injectInterFontFace(): void {
  if (fontFaceInjected || typeof document === 'undefined') return;
  fontFaceInjected = true;
  const style = document.createElement('style');
  style.setAttribute('data-inter-edit-font', '');
  style.textContent = `
    @font-face {
      font-family: 'InterEdit';
      src: url(${interRegularUrl}) format('truetype');
      font-weight: 400;
      font-style: normal;
      font-display: block;
    }
    @font-face {
      font-family: 'InterEdit';
      src: url(${interBoldUrl}) format('truetype');
      font-weight: 700;
      font-style: normal;
      font-display: block;
    }
    @font-face {
      font-family: 'InterEdit';
      src: url(${interItalicUrl}) format('truetype');
      font-weight: 400;
      font-style: italic;
      font-display: block;
    }
    @font-face {
      font-family: 'InterEdit';
      src: url(${interBoldItalicUrl}) format('truetype');
      font-weight: 700;
      font-style: italic;
      font-display: block;
    }
  `;
  document.head.appendChild(style);
}

// Hidden detached SVG path used to compute path lengths. Browsers cache the
// underlying path data per-element; we recreate one element and reuse it.
let lengthProbe: SVGPathElement | null = null;
export function pathLengthFor(d: string): number {
  if (typeof document === 'undefined') return d.length; // SSR fallback
  if (!lengthProbe) {
    lengthProbe = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  }
  lengthProbe.setAttribute('d', d);
  try {
    return lengthProbe.getTotalLength();
  } catch {
    return d.length;
  }
}

// Per-(glyphIndex, fontSize) path-data cache keyed by font name. opentype's
// getPath is fast but we re-render the same text on every frame during a Write
// transition; an inner-loop hash beats recomputing.
const glyphCache = new Map<string, { d: string; length: number }>();

/**
 * Convert a plain-text run into per-glyph SVG paths starting at (startX, y).
 * Returns the array of glyphs plus the advance after the last one.
 *
 * Bypasses `font.stringToGlyphs` deliberately. That helper applies OpenType
 * Bidi + feature substitutions (ccmp, liga, kern, …) and Inter uses lookup
 * formats opentype.js doesn't implement, so it throws on every call. We do
 * raw char-by-char `charToGlyphIndex` lookup instead. Trade-off: ligatures
 * don't fire (so "fi" renders as two glyphs rather than one fused), but
 * every Unicode codepoint resolves and the function never throws. Acceptable
 * for the Write animation; ligatures matter only in the steady frame, which
 * uses SVG <text> via the system font anyway.
 *
 * `font` is an already-loaded Font (from `loadFont`). The y argument is the
 * *baseline* in text-layout coordinates.
 */
export function textToGlyphPaths(
  text: string,
  font: Font,
  fontSize: number,
  startX: number,
  baselineY: number,
): { glyphs: GlyphPath[]; endX: number } {
  const glyphs: GlyphPath[] = [];
  let x = startX;
  const scale = fontSize / font.unitsPerEm;
  const fontName =
    (font as { names?: { fullName?: { en?: string } } }).names?.fullName?.en ?? 'font';

  const codepoints = Array.from(text); // handles surrogate pairs
  let prevGlyph: ReturnType<typeof font.glyphs.get> | null = null;

  for (const ch of codepoints) {
    const idx = font.charToGlyphIndex(ch);
    if (idx === undefined || idx === 0) {
      // .notdef or missing: skip the path but advance by ~half em so layout
      // doesn't collapse around unsupported chars.
      x += fontSize * 0.5;
      prevGlyph = null;
      continue;
    }
    const g = font.glyphs.get(idx);
    if (!g) {
      x += fontSize * 0.5;
      prevGlyph = null;
      continue;
    }

    const cacheKey = `${fontName}|${idx}|${fontSize}`;
    let entry = glyphCache.get(cacheKey);
    if (!entry) {
      const path = g.getPath(0, 0, fontSize);
      const d = path.toPathData(2);
      entry = { d, length: pathLengthFor(d) };
      glyphCache.set(cacheKey, entry);
    }

    const advance = (g.advanceWidth ?? font.unitsPerEm * 0.5) * scale;
    glyphs.push({
      d: entry.d,
      x,
      y: baselineY,
      advance,
      length: entry.length,
    });
    x += advance;

    if (prevGlyph) {
      const kerning = font.getKerningValue(prevGlyph, g);
      if (kerning) x += kerning * scale;
    }
    prevGlyph = g;
  }

  return { glyphs, endX: x };
}

export function clearGlyphPathCache(): void {
  glyphCache.clear();
  fontCache.clear();
}
