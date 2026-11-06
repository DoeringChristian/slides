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
