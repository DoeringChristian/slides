import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MATH_FONT, DEFAULT_TEXT_FONT, FONT_FAMILIES, MATH_FONTS, TEXT_FONTS,
  isBundledTextFont, mathFont, resolveMathFont, textFont,
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
    expect(resolveMathFont('Libertinus Serif', undefined).id).toBe('mathjax-libertinus');
    expect(resolveMathFont('Inter', undefined).id).toBe('mathjax-modern');
    // A legacy family resolves through the default face's pairing.
    expect(resolveMathFont('Arial', undefined).id).toBe(textFont('Arial').defaultMathFont);
  });

  it('lets an explicit math font override the pairing', () => {
    expect(resolveMathFont('Libertinus Serif', 'mathjax-stix2').id).toBe('mathjax-stix2');
    // An unknown id must not win — it falls back rather than breaking layout.
    expect(resolveMathFont('Libertinus Serif', 'mathjax-nonexistent').id)
      .toBe('mathjax-libertinus');
    expect(mathFont('mathjax-nonexistent').id).toBe(DEFAULT_MATH_FONT);
  });

  it('marks exactly the fonts we vendor as unofficial', () => {
    // Official entries install from @mathjax/mathjax-<name>-font; unofficial
    // ones are built here, so the distinction drives how they are loaded.
    const unofficial = MATH_FONTS.filter((f) => !f.official).map((f) => f.id);
    expect(unofficial).toEqual(['mathjax-libertinus']);
  });
});
