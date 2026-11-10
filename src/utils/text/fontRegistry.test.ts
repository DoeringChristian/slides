import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MATH_FONT, DEFAULT_TEXT_FONT, FONT_FAMILIES, MATH_FONTS, TEXT_FONTS,
  isBundledTextFont, mathFont, resolveMathFont, textFont,
  type MathFontDef,
} from './fontRegistry';
import { DEFAULT_TEXT_STYLE } from '../constants';

/**
 * The registry is the single place fonts are declared, so these tests guard
 * the invariants that make that true: no entry may be half-registered, the
 * defaults must point at real entries, and the one literal that deliberately
 * lives outside the registry must not drift from it.
 */
describe('font registry', () => {
  it('gives every text font four variants and a real math pairing', () => {
    for (const font of TEXT_FONTS) {
      for (const variant of ['regular', 'bold', 'italic', 'boldItalic'] as const) {
        // Vite resolves these to URLs (hashed) or data: URIs (standalone).
        expect(font.variants[variant], `${font.id}.${variant}`).toBeTruthy();
      }
      expect(font.cssStack, `${font.id} cssStack must name the family`).toContain(font.id);
      expect(font.notice.length, `${font.id} needs an attribution notice`).toBeGreaterThan(20);
      expect(MATH_FONTS.map((m) => m.id), `${font.id} pairs with an unknown math font`)
        .toContain(font.defaultMathFont);
    }
  });

  it('has unique ids and no duplicate asset reuse within a face', () => {
    expect(new Set(TEXT_FONTS.map((f) => f.id)).size).toBe(TEXT_FONTS.length);
    expect(new Set(MATH_FONTS.map((f) => f.id)).size).toBe(MATH_FONTS.length);
    for (const font of TEXT_FONTS) {
      const urls = Object.values(font.variants);
      expect(new Set(urls).size, `${font.id} reuses one file for several variants`)
        .toBe(urls.length);
    }
  });

  it('points both defaults at registered entries', () => {
    expect(TEXT_FONTS.map((f) => f.id)).toContain(DEFAULT_TEXT_FONT);
    expect(MATH_FONTS.map((f) => f.id)).toContain(DEFAULT_MATH_FONT);
  });

  // constants.ts is a leaf that node-side code imports, so it cannot pull in
  // the registry's binary font assets and keeps a literal instead. This is the
  // guard that the literal stays correct.
  it('agrees with the default text style in constants', () => {
    expect(DEFAULT_TEXT_STYLE.fontFamily).toBe(DEFAULT_TEXT_FONT);
    expect(isBundledTextFont(DEFAULT_TEXT_STYLE.fontFamily)).toBe(true);
  });

  it('offers exactly the bundled families in the picker', () => {
    expect([...FONT_FAMILIES]).toEqual(TEXT_FONTS.map((f) => f.id));
    for (const family of FONT_FAMILIES) expect(isBundledTextFont(family)).toBe(true);
  });

  it('resolves unshipped families to the default rather than failing', () => {
    // Decks predating the registry store CSS names we never had outlines for;
    // they were already rendered in the default face.
    for (const legacy of ['Arial', 'Helvetica', 'Times New Roman', '', undefined]) {
      expect(textFont(legacy).id, `${legacy}`).toBe(DEFAULT_TEXT_FONT);
      expect(isBundledTextFont(legacy)).toBe(false);
    }
    expect(textFont('Libertinus Serif').id).toBe('Libertinus Serif');
  });

  it('falls back to the text font pairing when no math font is set', () => {
    // The point of the pairing: picking Libertinus text must not leave
    // equations in a different face.
    expect(resolveMathFont('Libertinus Serif', undefined).id)
      .toBe(textFont('Libertinus Serif').defaultMathFont);
    expect(resolveMathFont('Inter', undefined).id).toBe('mathjax-newcm');
    // A legacy family resolves through the default face's pairing.
    expect(resolveMathFont('Arial', undefined).id).toBe(textFont('Arial').defaultMathFont);
  });

  it('lets an explicit math font override the pairing', () => {
    expect(resolveMathFont('Libertinus Serif', 'mathjax-stix2').id).toBe('mathjax-stix2');
    // An unknown id must not win — it falls back rather than breaking layout,
    // and it falls back to the PAIRING, not to the global default.
    expect(resolveMathFont('Libertinus Serif', 'mathjax-nonexistent').id)
      .toBe(textFont('Libertinus Serif').defaultMathFont);
    expect(mathFont('mathjax-nonexistent').id).toBe(DEFAULT_MATH_FONT);
  });

  it('gives every math font a blurb and a loader', () => {
    for (const font of MATH_FONTS as readonly MathFontDef[]) {
      expect(font.blurb.length, `${font.id} needs a blurb`).toBeGreaterThan(10);
      expect(typeof font.load, `${font.id} has no loader`).toBe('function');
      // Ids double as MathJax's own font names, which map onto the npm
      // packages @mathjax/mathjax-<name>-font.
      expect(font.id, `${font.id} is not package-shaped`).toMatch(/^mathjax-[a-z0-9]+$/);
    }
  });

  it('does not offer font extensions as font choices', () => {
    // mathjax-euler layers onto a chosen font via fontExtensions; listing it
    // as a choice would promise a complete face it is not.
    expect(MATH_FONTS.map((f) => f.id)).not.toContain('mathjax-euler');
  });

  it('pairs Libertinus with newtxmath itself, not a stand-in', () => {
    // acmart sets Libertine text against newtxmath, and newtxmath is now
    // generated rather than approximated, so the SIGGRAPH pairing is the real
    // face. Before this it was Termes — the closest published stand-in, which
    // still shared only about a third of its ink with a real acmart render.
    expect(textFont('Libertinus Serif').defaultMathFont).toBe('mathjax-newtx');
  });
});

describe('the viewer build drops the bytes without changing the registry', () => {
  // A presentation export draws outlines baked at export time, so it needs no
  // font files and no MathJax — 35 MB of the old 39 MB export was data for
  // characters the deck did not contain. vite.config.viewer.ts aliases
  // `fontSources` and `mathjaxEngine` to same-shaped empties. These assertions
  // are what keeps "same-shaped" true: a face or math font added to one module
  // and not the other would fail silently, in exported decks only.
  it('offers the same font ids in both source modules', async () => {
    const real = await import('./fontSources');
    const viewer = await import('./fontSources.viewer');
    expect(Object.keys(viewer.TEXT_FONT_FILES).sort())
      .toEqual(Object.keys(real.TEXT_FONT_FILES).sort());
    expect(Object.keys(viewer.MATH_FONT_MODULES).sort())
      .toEqual(Object.keys(real.MATH_FONT_MODULES).sort());
  });

  it('covers every registered face and math font', async () => {
    const { TEXT_FONT_FILES, MATH_FONT_MODULES } = await import('./fontSources');
    for (const font of TEXT_FONTS) {
      expect(Object.keys(TEXT_FONT_FILES), `${font.id} has no files`).toContain(font.id);
    }
    for (const font of MATH_FONTS as readonly MathFontDef[]) {
      expect(Object.keys(MATH_FONT_MODULES), `${font.id} has no module`).toContain(font.id);
    }
  });

  it('exposes the same API surface from both MathJax engine modules', async () => {
    const real = await import('../../services/mathjaxEngine');
    const viewer = await import('../../services/mathjaxEngine.viewer');
    expect(typeof viewer.buildMathJaxDocument).toBe(typeof real.buildMathJaxDocument);
  });

  it('fails loudly rather than rendering nothing when asked for a font it dropped', async () => {
    const viewer = await import('./fontSources.viewer');
    await expect(viewer.MATH_FONT_MODULES['mathjax-stix2']()).rejects.toThrow(/viewer build/);
    await expect(viewer.loadMathFontRange('@mathjax/x/js/svg/dynamic/calligraphic.js'))
      .rejects.toThrow(/viewer build/);
  });
});
