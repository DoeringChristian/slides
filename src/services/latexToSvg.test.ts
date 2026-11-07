import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearLatexCache, isMathJaxReady, preloadMathJax, texFragmentToSvg, texFragmentToSvgSync,
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
    // only when a user picked that font.
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
