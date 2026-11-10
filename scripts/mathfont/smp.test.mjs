import { describe, expect, it } from 'vitest';
import { FontData } from '@mathjax/src/mjs/output/common/FontData.js';
import {
  SMP_RANGES, SMP_REMAP, SMP_GREEK_L, SMP_GREEK_U, VARIANT_SMP, smpCodepoint,
} from './smp.mjs';

/**
 * `smp.mjs` holds a copy of MathJax's styled-alphabet tables, because the
 * generator runs in plain Node against a TeX tree with no MathJax instance to
 * ask. A copy that drifts is the worst possible failure here: every bold and
 * italic glyph would be filed one codepoint off, or under a codepoint MathJax
 * never consults, and the font would load, render and silently fall back to
 * Termes for the whole alphabet. So the copy is checked against the original.
 */
describe('the styled-alphabet tables agree with the installed MathJax', () => {
  const MJ = FontData;

  it('maps each variant to the same block bases', () => {
    for (const [variant, ours] of Object.entries(VARIANT_SMP)) {
      const theirs = MJ.VariantSmp[variant];
      expect(theirs, `MathJax dropped the ${variant} variant`).toBeDefined();
      // A hole in the array is meaningful — `double-struck` has no Greek — so
      // compare the slots rather than the arrays' lengths.
      for (let i = 0; i < 6; i++) {
        expect(ours[i], `${variant}[${i}]`).toEqual(theirs[i]);
      }
    }
  });

  it('covers the same plain ranges, and the same holes in them', () => {
    expect(SMP_RANGES).toEqual(MJ.SmpRanges);
    expect(SMP_REMAP).toEqual(MJ.SmpRemap);
    expect(SMP_GREEK_U).toEqual(MJ.SmpRemapGreekU);
    expect(SMP_GREEK_L).toEqual(MJ.SmpRemapGreekL);
  });

  it('resolves a character exactly as MathJax would', () => {
    // MathJax builds the redirects by walking its ranges; this walks them the
    // same way and compares every character it would restyle, which is the
    // behaviour the generator depends on rather than the tables themselves.
    for (const variant of Object.keys(VARIANT_SMP)) {
      const expected = new Map();
      const remap = MJ.VariantSmp[variant];
      const greek = [null, null, MJ.SmpRemapGreekU, MJ.SmpRemapGreekL];
      for (const [i, lo, hi] of MJ.SmpRanges) {
        const base = remap[i];
        if (!base) continue;
        for (let n = lo; n <= hi; n++) {
          if (n === 0x3a2) continue;
          const smp = base + n - lo;
          expected.set(n, MJ.SmpRemap[smp] || smp);
        }
        if (greek[i]) {
          for (const n of Object.keys(greek[i]).map(Number)) expected.set(n, base + greek[i][n]);
        }
      }
      for (const n of Object.keys(remap[5] ?? {}).map(Number)) expected.set(n, remap[5][n]);
      for (const [code, want] of expected) {
        expect(smpCodepoint(variant, code), `${variant} U+${code.toString(16)}`).toBe(want);
      }
    }
  });

  it('leaves alone what no variant restyles', () => {
    // Punctuation and symbols keep their own codepoint in every variant, which
    // is why the generator files bold `+` at U+002B and not in the block.
    for (const code of [0x2b, 0x3d, 0x28, 0x2211, 0x222b, 0x3a2]) {
      expect(smpCodepoint('bold', code), `U+${code.toString(16)}`).toBeNull();
    }
    expect(smpCodepoint('no-such-variant', 0x41)).toBeNull();
  });

  it('sends italic h to the Planck constant', () => {
    // The one hole that bites in practice: U+1D455 was never assigned, and
    // the glyph belongs at U+210E.
    expect(smpCodepoint('italic', 0x68)).toBe(0x210e);
    expect(smpCodepoint('bold-italic', 0x68)).toBe(0x1d489);
  });
});
