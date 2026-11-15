/**
 * opentype.js wrapper that gives us per-glyph SVG path data for plain text.
 *
 * Used by the Write/Unwrite text transition: we need every glyph as a stroked
 * <path> with a known length so the animation can drive stroke-dashoffset
 * along each glyph in turn. opentype.js is the only sensible way to get this
 * in a browser; no system-font path is exposed by the web platform.
 *
 * Which face is used comes from `style.fontFamily`, resolved through
 * `fontRegistry` — the single place fonts are declared. Only bundled faces can
 * be drawn as outlines, since the web platform exposes no outline data for
 * system fonts, so an unknown family resolves to the default face.
 */
import { parse as parseFont, type Font } from 'opentype.js';
import { DEFAULT_TEXT_FONT, TEXT_FONTS, textFont } from './fontRegistry';

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

function resolveFontUrl(family: string, weight: Weight, style: Style): string {
  // URLs come from Vite imports (via the registry) so the bundler decides:
  //   editor build → hashed asset served from /slides/assets/<face>.<hash>
  //   standalone build → inlined as data: URL (assetsInlineLimit: 100MB)
  // Either way the runtime fetch finds the bytes without depending on a
  // sibling `fonts/` directory next to the HTML — which the single-file
  // standalone export doesn't have.
  const { variants } = textFont(family);
  if (weight === 'bold' && style === 'italic') return variants.boldItalic;
  if (weight === 'bold') return variants.bold;
  if (style === 'italic') return variants.italic;
  return variants.regular;
}

const fontCache = new Map<string, Promise<Font>>();

export function loadFont(family: string, weight: Weight, style: Style): Promise<Font> {
  // Keyed on the RESOLVED id, so every alias of an unshipped family shares one
  // entry instead of re-fetching the default face under each stored name.
  const key = `${textFont(family).id}|${weight}|${style}`;
  const hit = fontCache.get(key);
  if (hit) return hit;
  const url = resolveFontUrl(family, weight, style);
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
export function prewarmFonts(family: string = DEFAULT_TEXT_FONT): void {
  if (typeof document === 'undefined') return;
  loadFont(family, 'normal', 'normal');
  loadFont(family, 'bold', 'normal');
  loadFont(family, 'normal', 'italic');
  loadFont(family, 'bold', 'italic');
}

/**
 * Inject an `@font-face` per bundled face, so the HTML edit overlay renders in
 * the same font file opentype.js parses for the SVG path renderer. Without
 * this, edit mode falls back to whatever the system resolves `style.fontFamily`
 * to and the layout shifts visibly when entering / leaving edit mode.
 *
 * Each face is registered under an "<id> Edit" alias rather than its real
 * family name, so a system-installed copy of the same family at a different
 * version can never win over the bytes we measured.
 *
 * Idempotent: only injects once per page load.
 */
let fontFacesInjected = false;

/** CSS family the edit overlay must ask for to get the bundled bytes. */
export function editFontFamily(family: string | undefined): string {
  return `${textFont(family).id} Edit`;
}

/** `format()` hint from the asset extension — .ttf and .otf differ. */
function fontFormat(url: string): string {
  return /\.otf(\?|$)/i.test(url) ? 'opentype' : 'truetype';
}

export function injectFontFaces(): void {
  if (fontFacesInjected || typeof document === 'undefined') return;
  fontFacesInjected = true;
  const rule = (family: string, url: string, weight: number, style: Style) => `
    @font-face {
      font-family: '${family}';
      src: url(${url}) format('${fontFormat(url)}');
      font-weight: ${weight};
      font-style: ${style};
      font-display: block;
    }`;
  const style = document.createElement('style');
  style.setAttribute('data-bundled-edit-fonts', '');
  style.textContent = TEXT_FONTS.flatMap((font) => {
    const alias = `${font.id} Edit`;
    return [
      rule(alias, font.variants.regular, 400, 'normal'),
      rule(alias, font.variants.bold, 700, 'normal'),
      rule(alias, font.variants.italic, 400, 'italic'),
      rule(alias, font.variants.boldItalic, 700, 'italic'),
    ];
  }).join('\n');
  document.head.appendChild(style);
}

// Browsers round CSS font struts at each zoom/font size. Measure their actual
// baseline once, rather than assuming the ideal half-leading formula is exact.
const nativeBaselineCache = new Map<string, number>();
/**
 * The font's x-height in em.
 *
 * This is the metric that decides whether math looks the right size next to
 * prose. A math font and a text font can share an em and still disagree
 * wildly about how big a lowercase letter is — Libertinus Serif puts its
 * x-height at 0.429em, STIX Two Math at 0.479 — and the eye reads the
 * x-height, not the em. LaTeX packages scale the math font to the text font
 * for exactly this reason (`newtxmath`'s `libertine` option is that scaling);
 * `parseMathChunks` does the same with this number.
 */
export function xHeightEm(font: Font): number {
  const sx = font.tables.os2?.sxHeight;
  if (sx && font.unitsPerEm) return sx / font.unitsPerEm;
  // OS/2 sxHeight is optional, so fall back to measuring the glyph it
  // describes: the top of lowercase x above the baseline IS the x-height.
  const box = font.charToGlyph('x')?.getBoundingBox?.();
  if (box && Number.isFinite(box.y2) && font.unitsPerEm) return box.y2 / font.unitsPerEm;
  return 0.5;
}

export function nativeTextBaseline(
  fontSize: number, advance: number, weight: string, fontStyle: string, fontFamily: string | undefined,
): number {
  // Probe the SAME alias the edit overlay renders with. This used to name
  // `InterEdit`, which no @font-face declares (the aliases are "<id> Edit"),
  // so it measured a fallback face for every family and, since the readiness
  // check below could never pass, re-measured on every call.
  const family = editFontFamily(fontFamily);
  const key = `${family}|${fontSize}|${advance}|${weight}|${fontStyle}`;
  const cached = nativeBaselineCache.get(key);
  if (cached !== undefined) return cached;
  const probe = document.createElement('div');
  probe.style.cssText = `position:absolute;visibility:hidden;white-space:pre;margin:0;padding:0;border:0;font-family:'${family}';font-size:${fontSize}px;font-weight:${weight};font-style:${fontStyle};line-height:${advance}px;`;
  probe.textContent = 'x';
  const marker = document.createElement('span');
  marker.style.cssText = 'display:inline-block;width:0;height:0;padding:0;margin:0;';
  probe.appendChild(marker);
  document.body.appendChild(probe);
  const baseline = marker.getBoundingClientRect().top - probe.getBoundingClientRect().top;
  probe.remove();
  // Do not keep a fallback-font measurement made before the face is ready.
  if (document.fonts.check(`${fontStyle} ${weight} ${fontSize}px '${family}'`)) nativeBaselineCache.set(key, baseline);
  return baseline;
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

// -----------------------------------------------------------------------------
// samplePathD — equal-arc polyline sampling of an arbitrary d-string.
// Used by the cross-type morph (RenderMorph) to turn per-glyph path data into
// lerpable point lists. Same hidden-probe pattern as pathLengthFor, extended
// with getPointAtLength; results cached by (d, n) since the morph re-samples
// the same glyphs every animation frame.
// -----------------------------------------------------------------------------

/** Test seam: vitest runs in node where SVGPathElement.getTotalLength /
 *  getPointAtLength don't exist. Tests inject a deterministic sampler. */
type PathSampler = (d: string, n: number) => number[];
let customPathSampler: PathSampler | null = null;
export function setPathSamplerForTests(fn: PathSampler | null): void {
  customPathSampler = fn;
  samplePathCache.clear();
}

const samplePathCache = new Map<string, number[]>();
let samplerProbe: SVGPathElement | null = null;

/**
 * Sample a path d-string into `n` points at equal arc-length spacing
 * (endpoints included: sample k sits at arc `total * k / (n - 1)`).
 * Returns a flat [x0,y0,…,x(n-1),y(n-1)] array in the path's own
 * coordinate space, or [] when sampling isn't possible (no DOM and no
 * injected sampler, or a degenerate d).
 */
export function samplePathD(d: string, n: number): number[] {
  if (n < 2 || !d) return [];
  const key = `${n}|${d}`;
  const hit = samplePathCache.get(key);
  if (hit) return hit;
  let out: number[];
  if (customPathSampler) {
    out = customPathSampler(d, n);
  } else if (typeof document === 'undefined') {
    out = [];
  } else {
    if (!samplerProbe) {
      samplerProbe = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    }
    samplerProbe.setAttribute('d', d);
    try {
      const total = samplerProbe.getTotalLength();
      out = [];
      for (let k = 0; k < n; k++) {
        const p = samplerProbe.getPointAtLength((total * k) / (n - 1));
        out.push(p.x, p.y);
      }
    } catch {
      out = [];
    }
  }
  samplePathCache.set(key, out);
  return out;
}

// Per-(glyphIndex, fontSize) path-data cache, one per loaded Font. opentype's
// getPath is fast but we re-render the same text on every frame during a Write
// transition; an inner-loop hash beats recomputing.
//
// Keyed on the Font OBJECT, never its name. Glyph indices are private to a
// font file — Libertinus' `h` is glyph 73, which is Inter's `C` — so two fonts
// sharing a cache must never share a key. A name-based key did exactly that:
// opentype.js 2 moved `names.fullName` under `names.windows`, every font read
// as 'font', and whichever face drew a glyph index first owned it for all of
// them (an `h` typed in Libertinus came out as Inter's `C`).
const glyphCache = new WeakMap<Font, Map<string, { d: string; length: number }>>();

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
  let fontGlyphs = glyphCache.get(font);
  if (!fontGlyphs) {
    fontGlyphs = new Map();
    glyphCache.set(font, fontGlyphs);
  }

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

    const cacheKey = `${idx}|${fontSize}`;
    let entry = fontGlyphs.get(cacheKey);
    if (!entry) {
      const path = g.getPath(0, 0, fontSize);
      const d = path.toPathData(2);
      entry = { d, length: pathLengthFor(d) };
      fontGlyphs.set(cacheKey, entry);
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
