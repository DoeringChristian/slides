import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearLatexCache, isMathJaxReady, mathXHeightEm, preloadMathJax, texFragmentToSvg,
  texFragmentToSvgSync,
} from './latexToSvg';
import { MATH_FONTS } from '../utils/text/fontRegistry';

/**
 * The math pipeline, end to end.
 *
 * Nothing else in the suite renders math: the service lazy-imports MathJax, so
 * a migration or a font-package rename typechecks and passes every other test
 * while producing no equations at all. These tests actually convert TeX.
 *
 * They also pin the two things that selectable math fonts made load-bearing:
 * different fonts must produce different outlines, and the cache must be keyed
 * by font so a second font does not receive the first one's glyphs.
 */

const TEX = String.raw`f \sim \text{GP}(\mu, \Sigma) \quad \int_0^\infty`;

/** Glyph outlines, which is where the font actually shows up. */
const outlines = (svg: string) => [...svg.matchAll(/<path[^>]*\bd="([^"]*)"/g)].map((m) => m[1]);

describe('latexToSvg', () => {
  beforeEach(() => {
    clearLatexCache();
  });

  it('renders TeX to self-contained SVG outlines', async () => {
    const svg = await texFragmentToSvg(TEX, false, 'mathjax-newcm');
    expect(svg.startsWith('<svg')).toBe(true);
    expect(outlines(svg).length).toBeGreaterThan(5);
    // `fontCache: 'local'` defines each glyph once and places it with <use>.
    expect(svg).toContain('<defs>');
    expect(svg).toContain('<use');
    // No font is referenced at runtime — the outlines ARE the font. This is
    // why exports need no @font-face, and why CSS cannot restyle math.
    expect(svg).not.toContain('font-family');
  }, 30_000);

  it('gives different fonts different outlines', async () => {
    const [a, b, c] = await Promise.all([
      texFragmentToSvg(TEX, false, 'mathjax-newcm'),
      texFragmentToSvg(TEX, false, 'mathjax-termes'),
      texFragmentToSvg(TEX, false, 'mathjax-stix2'),
    ]);
    const first = [a, b, c].map((svg) => outlines(svg)[0]);
    expect(new Set(first).size, 'three fonts collapsed to fewer outline sets').toBe(3);
  }, 60_000);

  it('does not serve one font from another font\'s cache entry', async () => {
    // The regression this guards: the cache key was (display, tex) only, so
    // the second font returned the first font's SVG unchanged.
    const newcm = await texFragmentToSvg(TEX, false, 'mathjax-newcm');
    const termes = await texFragmentToSvg(TEX, false, 'mathjax-termes');
    expect(termes).not.toBe(newcm);
    // ...while a repeat of the same font is served from cache, identically.
    expect(await texFragmentToSvg(TEX, false, 'mathjax-newcm')).toBe(newcm);
  }, 60_000);

  it('reports readiness per font and renders synchronously once loaded', async () => {
    expect(isMathJaxReady('mathjax-pagella')).toBe(false);
    expect(texFragmentToSvgSync(TEX, false, 'mathjax-pagella')).toBeNull();
    await preloadMathJax('mathjax-pagella');
    expect(isMathJaxReady('mathjax-pagella')).toBe(true);
    const sync = texFragmentToSvgSync(TEX, false, 'mathjax-pagella');
    expect(sync).not.toBeNull();
    expect(outlines(sync!).length).toBeGreaterThan(5);
    // Loading one font must not claim readiness for another.
    expect(isMathJaxReady('mathjax-bonum')).toBe(false);
  }, 30_000);

  it('falls back to the default font for an unknown id rather than throwing', async () => {
    const unknown = await texFragmentToSvg(TEX, false, 'mathjax-nonexistent');
    const dflt = await texFragmentToSvg(TEX, false, undefined);
    expect(unknown).toBe(dflt);
  }, 30_000);

  it('renders display mode differently from inline', async () => {
    const inline = await texFragmentToSvg(String.raw`\sum_{i=0}^{n} i`, false, 'mathjax-newcm');
    const display = await texFragmentToSvg(String.raw`\sum_{i=0}^{n} i`, true, 'mathjax-newcm');
    expect(display).not.toBe(inline);
  }, 30_000);

  it('can load every registered math font', async () => {
    // Catches a renamed or unpublished package, which would otherwise surface
    // only when a user picked that font. A `tex` entry is excluded because it
    // has no MathJax data at all — it is drawn by the local TeX installation,
    // and fontRegistry.test.ts pins that it stays out of this path.
    for (const font of MATH_FONTS) {
      const svg = await texFragmentToSvg(String.raw`x^2`, false, font.id);
      expect(outlines(svg).length, `${font.id} produced no outlines`).toBeGreaterThan(0);
    }
  }, 180_000);
});

/**
 * Regressions from the MathJax 4 migration. Each of these produced a visibly
 * broken slide while the whole suite stayed green, because every assertion
 * here is about something the OLD tests could not see.
 */
describe('the whole expression actually reaches the slide', () => {
  beforeEach(() => { clearLatexCache(); });

  /** Where glyphs are PLACED. `<defs>` is a cache and fills up regardless of
   *  how much of the expression was rendered, so counting paths there cannot
   *  tell a complete expression from a truncated one — which is exactly how a
   *  one-glyph render passed for a 285-character formula. */
  const placements = (svg: string) => (svg.match(/<use/g) ?? []).length;
  const roots = (svg: string) => (svg.match(/<svg/g) ?? []).length;

  // Every `\,`, `\quad` and binary operator is a potential line break.
  const LONG = String.raw`\mathcal{L}\,\mathscr{H}\,\mathfrak{g}\,\mathbb{R}^3\,\boldsymbol{\omega}\,\nabla\cdot\vec{E}\quad \sum_{i=1}^{N}\prod_k\oint\iint\quad \left\langle \frac{\partial^2 u}{\partial t^2}\right\rangle \le \sqrt[3]{\xi}`;

  it('returns ONE svg, because MathJax 4 would otherwise break inline math itself', async () => {
    const svg = await texFragmentToSvg(LONG, false, 'mathjax-newcm');
    // MathJax 4 breaks inline math at every opportunity and returns one <svg>
    // per chunk with <mjx-break> between them. A consumer reading "the" svg
    // then renders the FIRST chunk only: this expression came out as a lone
    // `L`. Our layout owns line breaking, so the whole thing must be one unit.
    expect(roots(svg)).toBe(1);
    expect(svg).not.toContain('mjx-break');
    // ~31 glyphs. The failure mode put this at 1.
    expect(placements(svg)).toBeGreaterThan(25);
  }, 30_000);

  it('loads the font ranges MathJax fetches on demand', async () => {
    // A MathJax 4 font keeps calligraphic, script, fraktur, double-struck and
    // the rest in ~40 separately loaded range modules. With no
    // `mathjax.asyncLoad` hook every one of these threw "MathJax retry" and
    // the expression fell back to its own source text.
    for (const tex of [String.raw`\mathcal{L}`, String.raw`\mathscr{H}`,
      String.raw`\mathfrak{g}`, String.raw`\mathbb{R}`, String.raw`\left\langle x\right\rangle`]) {
      const svg = await texFragmentToSvg(tex, false, 'mathjax-newcm');
      expect(placements(svg), tex).toBeGreaterThan(0);
    }
  }, 30_000);

  it('renders \\boldsymbol as a glyph rather than spelling out the macro', async () => {
    // `noundefined` turns an unregistered macro into its own name in red, so a
    // missing TeX extension looks like a font problem. Nine glyphs spelling
    // "boldsymbol" is not a bold omega.
    const bold = await texFragmentToSvg(String.raw`\boldsymbol{\omega}`, false, 'mathjax-newcm');
    expect(placements(bold)).toBe(1);
    expect(bold).not.toBe(await texFragmentToSvg(String.raw`\omega`, false, 'mathjax-newcm'));
  }, 30_000);

  it('states its size in a viewBox that needs no font metrics to read', async () => {
    // The width/height attributes are in `ex`, and one ex is the x-height of
    // whichever math font is selected — 0.442em for newcm, not the 0.5em the
    // layout used to assume, so equations came out 13% oversized with their
    // baselines pushed down to match. The viewBox is in MathJax's own unit of
    // 1/1000 em: no font metrics, no rounding, one uniform scale.
    const svg = await texFragmentToSvg(String.raw`x`, false, 'mathjax-newcm');
    const vb = svg.match(/viewBox="([^"]+)"/)?.[1].split(/\s+/).map(Number);
    const ex = Number(svg.match(/width="([\d.]+)ex"/)?.[1]);
    expect(vb).toHaveLength(4);
    expect(vb!.every(Number.isFinite)).toBe(true);
    // An em is 1000 units, and this font's ex is well under half of one.
    expect(vb![2] / ex).toBeGreaterThan(400);
    expect(vb![2] / ex).toBeLessThan(470);
  }, 30_000);
});

describe('wrapping a formula that does not fit', () => {
  beforeEach(() => { clearLatexCache(); });

  const roots = (svg: string) => (svg.match(/<svg/g) ?? []).length;
  const placements = (svg: string) => (svg.match(/<use/g) ?? []).length;
  /** Outer viewBox, in MathJax's own unit of 1/1000 em. */
  const box = (svg: string) => {
    const vb = svg.match(/viewBox="([-\d.]+) ([-\d.]+) ([\d.]+) ([\d.]+)"/);
    return { widthEm: Number(vb![3]) / 1000, heightEm: Number(vb![4]) / 1000 };
  };

  const LONG = String.raw`\mathcal{L}\,\mathfrak{g}\,\mathbb{R}^3\,\nabla\cdot\vec{E}\quad \sum_{i=1}^{N}\prod_k\oint\iint\quad \left\langle \frac{\partial^2 u}{\partial t^2}\right\rangle \le \sqrt[3]{\xi}\quad 0123456789`;

  it('leaves an unwrapped render exactly as it was', async () => {
    // The caller only asks for wrapping when the natural render overflows, so
    // every formula that fits must be untouched by this feature.
    const plain = await texFragmentToSvg(LONG, false, 'mathjax-stix2');
    expect(roots(plain)).toBe(1);
    expect(plain).not.toContain('mjx-break');
  }, 30_000);

  it('wraps DISPLAY math into one svg, at the width it was given', async () => {
    // MathJax breaks display math itself, with the continuation lines aligned
    // — the real TeX algorithm, better than anything we could do from outside
    // — and hands back a single taller svg.
    const natural = await texFragmentToSvg(LONG, true, 'mathjax-stix2');
    const wrapped = await texFragmentToSvg(LONG, true, 'mathjax-stix2', { widthEm: 12 });
    expect(roots(wrapped)).toBe(1);
    expect(placements(wrapped)).toBe(placements(natural));
    // Breaking happens at legal points only, so a subexpression that cannot
    // be broken — a fraction inside stretchy delimiters, a long root — can
    // still push a row past the asked-for width. Measured overshoot here is
    // ~7%; what matters is that it tracks the request instead of ignoring it.
    expect(box(wrapped).widthEm).toBeLessThan(12 * 1.15);
    expect(box(wrapped).widthEm).toBeLessThan(box(natural).widthEm * 0.7);
    expect(box(wrapped).heightEm).toBeGreaterThan(box(natural).heightEm);
  }, 30_000);

  it('narrower means taller', async () => {
    const wide = await texFragmentToSvg(LONG, true, 'mathjax-stix2', { widthEm: 20 });
    const narrow = await texFragmentToSvg(LONG, true, 'mathjax-stix2', { widthEm: 10 });
    expect(box(narrow).widthEm).toBeLessThan(box(wide).widthEm);
    expect(box(narrow).heightEm).toBeGreaterThan(box(wide).heightEm);
  }, 30_000);

  it('gives INLINE math back as break opportunities for the caller to flow', async () => {
    // Inline breaking ignores the requested width and breaks at EVERY legal
    // point, which is not a failure: MathJax is handing the host its break
    // opportunities. The text layout engine packs them into rows, because it
    // is the only thing that knows what else shares the line.
    const chunks = await texFragmentToSvg(LONG, false, 'mathjax-stix2', { widthEm: 12 });
    expect(roots(chunks)).toBeGreaterThan(1);
    // Nothing may be lost in the split — that was the original bug.
    const whole = await texFragmentToSvg(LONG, false, 'mathjax-stix2');
    expect(placements(chunks)).toBe(placements(whole));
  }, 30_000);

  it('keeps the glyph defs, which only the first chunk carries', async () => {
    // `fontCache: 'local'` emits each glyph once, in the first chunk, and
    // every later chunk <use>s an id defined there. Parsing chunks apart
    // would render everything after the first as empty.
    const chunks = await texFragmentToSvg(LONG, false, 'mathjax-stix2', { widthEm: 12 });
    expect(chunks.indexOf('<defs>')).toBeLessThan(chunks.indexOf('</svg>'));
  }, 30_000);

  it('caches wrapped and unwrapped renders apart', async () => {
    const plain = await texFragmentToSvg(LONG, true, 'mathjax-stix2');
    const wrapped = await texFragmentToSvg(LONG, true, 'mathjax-stix2', { widthEm: 10 });
    expect(wrapped).not.toBe(plain);
    // ...and a second width is not served the first one's result.
    const other = await texFragmentToSvg(LONG, true, 'mathjax-stix2', { widthEm: 18 });
    expect(other).not.toBe(wrapped);
  }, 30_000);

  it('restores the options afterwards, so the next formula is unwrapped', async () => {
    await texFragmentToSvg(LONG, false, 'mathjax-stix2', { widthEm: 8 });
    const after = await texFragmentToSvg(String.raw`a+b=c`, false, 'mathjax-stix2');
    expect(roots(after)).toBe(1);
    expect(after).not.toContain('mjx-break');
  }, 30_000);
});

describe('output is well-formed XML, which the layout parses strictly', () => {
  beforeEach(() => {
    clearLatexCache();
  });

  /**
   * The condition that broke: an unescaped `<` or `>` inside an attribute
   * value. `parseMathChunks` parses with `image/svg+xml`, so one of these
   * anywhere in the markup produced a parsererror, no chunks, and a formula
   * that silently showed its own TeX source instead of glyphs. Checked by
   * pattern rather than by parsing because vitest runs in node here, where
   * there is no DOMParser, and @xmldom is only a transitive dependency.
   */
  const unescapedInAttr = (svg: string) => svg.match(/="[^"]*[<>][^"]*"/g) ?? [];

  it.each([
    ['an inequality', 'a < b'],
    ['the other inequality', 'x > 0'],
    ['both, inside a set', String.raw`\{x : x<1\}`],
    ['a chain', 'a < b < c'],
    ['angle brackets around a macro', String.raw`\langle x \rangle < \epsilon`],
  ])('escapes nothing into an attribute for %s', async (_what, tex) => {
    const svg = await texFragmentToSvg(tex, false, 'mathjax-newcm');
    expect(unescapedInAttr(svg)).toEqual([]);
    // And it really rendered, rather than coming back empty and well-formed.
    expect(outlines(svg).length).toBeGreaterThan(2);
  }, 30_000);

  it('still renders the comparison glyph itself', async () => {
    // The fix drops attributes, so the proof it dropped only metadata is that
    // `a < b` has one more glyph than `ab` — the relation sign.
    const withRel = await texFragmentToSvg('a < b', false, 'mathjax-newcm');
    const without = await texFragmentToSvg('ab', false, 'mathjax-newcm');
    expect(outlines(withRel).length).toBe(outlines(without).length + 1);
  }, 30_000);

  it('keeps the attributes the renderers actually read', async () => {
    const svg = await texFragmentToSvg(String.raw`\frac{a}{b} < c`, false, 'mathjax-newcm');
    // Geometry and references survive; only the data-* annotations go.
    expect(svg).toMatch(/<use[^>]*(xlink:)?href="#/);
    expect(svg).toMatch(/viewBox="/);
    expect(svg).toMatch(/transform="/);
    expect(svg).toMatch(/<rect/); // the fraction bar
    expect(svg).not.toMatch(/\sdata-[\w-]+=/);
  }, 30_000);
});

describe('the x-height that sizes math against prose', () => {
  /**
   * `parseMathChunks` scales math by textXHeight / mathXHeight. If this ever
   * returns undefined for a loaded font the scaling silently becomes 1 and
   * every equation goes back to being sized by the em — the exact defect this
   * replaced, and invisible to every other test in the suite.
   */
  it('is undefined before the font loads and a real number after', async () => {
    // A fresh module instance, because `clearLatexCache` deliberately keeps
    // the loaded documents — by this point in the file every font is loaded.
    vi.resetModules();
    const fresh = await import('./latexToSvg');
    expect(fresh.mathXHeightEm('mathjax-termes')).toBeUndefined();
    await fresh.texFragmentToSvg('x', false, 'mathjax-termes');
    expect(fresh.mathXHeightEm('mathjax-termes')).toBeCloseTo(0.441, 3);
  }, 30_000);

  it('is per font, not one number for all of them', async () => {
    await Promise.all([
      texFragmentToSvg('x', false, 'mathjax-termes'),
      texFragmentToSvg('x', false, 'mathjax-stix2'),
    ]);
    const termes = mathXHeightEm('mathjax-termes');
    const stix2 = mathXHeightEm('mathjax-stix2');
    expect(termes).toBeDefined();
    expect(stix2).toBeDefined();
    // 0.441 vs 0.479: an 8.6% size difference between two faces that share an
    // em. Pairing one where the other was expected is visible at a glance.
    expect(stix2! / termes!).toBeGreaterThan(1.05);
  }, 30_000);

  it('resolves an unknown id the same way rendering does', async () => {
    await texFragmentToSvg('x', false, undefined);
    // Falls through mathFont() to the default face, so the scale and the
    // glyphs can never come from different fonts.
    expect(mathXHeightEm('mathjax-nonexistent')).toBe(mathXHeightEm(undefined));
  }, 30_000);
});
