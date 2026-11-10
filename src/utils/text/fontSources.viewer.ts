/**
 * `fontSources` with the payload removed, for the presentation-only build.
 *
 * A viewer export draws baked geometry: `bakeLayouts` resolves every text
 * element at export time and embeds the glyph outlines, so the player never
 * parses a font file and never runs TeX. Shipping the font data anyway cost
 * ~30 MB of MathJax glyph tables and ~5 MB of text faces in every exported
 * deck, to cover characters the deck does not contain.
 *
 * `vite.config.viewer.ts` aliases `fontSources` here. The exports keep their
 * shapes so `fontRegistry` — and the pickers, pairings and tests that read it
 * — are untouched; only the bytes are gone.
 *
 * What happens if a layout is missing: `loadFont` fetches an empty URL and
 * fails, `SVGTextPaths` catches that and falls back to `SVGTextContent`,
 * which renders through CSS with the browser's own serif or sans. Text stays
 * readable in the wrong face rather than disappearing. Math has no such
 * fallback — an unbaked formula shows its source — which is why
 * `exportStandaloneHtml` reports what it could not bake instead of leaving it
 * to be discovered by whoever opens the file.
 */

/** Same ids as the real module; every URL empty, so nothing is bundled. */
export const TEXT_FONT_FILES = {
  'Inter': { regular: '', bold: '', italic: '', boldItalic: '' },
  'Libertinus Serif': { regular: '', bold: '', italic: '', boldItalic: '' },
};

const unavailable = (what: string) => () => Promise.reject(
  new Error(`${what} is not bundled in the viewer build — this deck's text was baked at export time`),
);

export const MATH_FONT_MODULES: Record<string, () => Promise<Record<string, unknown>>> = {
  'mathjax-newtx': unavailable('MathJax font newtx'),
  'mathjax-newcm': unavailable('MathJax font newcm'),
  'mathjax-tex': unavailable('MathJax font tex'),
  'mathjax-modern': unavailable('MathJax font modern'),
  'mathjax-stix2': unavailable('MathJax font stix2'),
  'mathjax-termes': unavailable('MathJax font termes'),
  'mathjax-pagella': unavailable('MathJax font pagella'),
  'mathjax-bonum': unavailable('MathJax font bonum'),
  'mathjax-schola': unavailable('MathJax font schola'),
  'mathjax-dejavu': unavailable('MathJax font dejavu'),
  'mathjax-fira': unavailable('MathJax font fira'),
  'mathjax-asana': unavailable('MathJax font asana'),
};

export function loadMathFontRange(specifier: string): Promise<unknown> {
  return Promise.reject(new Error(`MathJax font ranges are not bundled in the viewer build: ${specifier}`));
}
