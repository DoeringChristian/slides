/**
 * Where a styled letter actually lives in a MathJax font.
 *
 * `\mathbf{x}` does not look up `x` in a "bold" table. MathJax builds each
 * variant's char map with a redirect — `bold[0x78] = {smp: 0x1D431}` — and
 * then looks the *redirected* codepoint up in that same variant. So a bold
 * glyph has to be filed under U+1D431 MATHEMATICAL BOLD SMALL X, and a table
 * keyed by plain `x` is simply never consulted for `\mathbf`.
 *
 * The three tables below are MathJax's own (`FontData.VariantSmp`,
 * `SmpRanges`, `SmpRemap`, `SmpRemapGreekU/L` in
 * `@mathjax/src/mjs/output/common/FontData.js`). They are copied rather than
 * imported because this script runs in plain Node against a TeX tree, with no
 * bundler and no MathJax instance — but `newtxFont.test.ts` asserts the copy
 * still agrees with the installed MathJax, so a divergence fails the suite
 * rather than quietly misfiling every bold glyph.
 */

/** Per variant: [LatinUC, Latinlc, GreekUC, Greeklc, digits, extras]. */
export const VARIANT_SMP = {
  bold: [0x1d400, 0x1d41a, 0x1d6a8, 0x1d6c2, 0x1d7ce, { 0x3dc: 0x1d7ca, 0x3dd: 0x1d7cb }],
  italic: [0x1d434, 0x1d44e, 0x1d6e2, 0x1d6fc],
  'bold-italic': [0x1d468, 0x1d482, 0x1d71c, 0x1d736],
  script: [0x1d49c, 0x1d4b6],
  'bold-script': [0x1d4d0, 0x1d4ea],
};

/** The plain ranges that get redirected, and which slot of the above they use. */
export const SMP_RANGES = [
  [0, 0x41, 0x5a],
  [1, 0x61, 0x7a],
  [2, 0x391, 0x3a9],
  [3, 0x3b1, 0x3c9],
  [4, 0x30, 0x39],
];

/**
 * Alphanumerics Unicode had already encoded elsewhere when the Mathematical
 * Alphanumeric block was added, so the block leaves a hole. Italic `h` is the
 * one that bites: U+1D455 is unassigned and the glyph belongs at U+210E
 * PLANCK CONSTANT.
 */
export const SMP_REMAP = {
  0x1d455: 0x210e, 0x1d49d: 0x212c, 0x1d4a0: 0x2130, 0x1d4a1: 0x2131,
  0x1d4a3: 0x210b, 0x1d4a4: 0x2110, 0x1d4a7: 0x2112, 0x1d4a8: 0x2133,
  0x1d4ad: 0x211b, 0x1d4ba: 0x212f, 0x1d4bc: 0x210a, 0x1d4c4: 0x2134,
  0x1d506: 0x212d, 0x1d50b: 0x210c, 0x1d50c: 0x2111, 0x1d515: 0x211c,
  0x1d51d: 0x2128, 0x1d53a: 0x2102, 0x1d53f: 0x210d, 0x1d545: 0x2115,
  0x1d547: 0x2119, 0x1d548: 0x211a, 0x1d549: 0x211d, 0x1d551: 0x2124,
};

/** Offsets past the Greek base for the variant letters, nabla and partial. */
export const SMP_GREEK_U = { 0x2207: 0x19, 0x03f4: 0x11 };
export const SMP_GREEK_L = {
  0x3d1: 0x1b, 0x3d5: 0x1d, 0x3d6: 0x1f, 0x3f0: 0x1c,
  0x3f1: 0x1e, 0x3f5: 0x1a, 0x2202: 0x19,
};

const GREEK_EXTRAS = [null, null, SMP_GREEK_U, SMP_GREEK_L];

/**
 * The codepoint a plain character's styled form is filed under, or null when
 * the character is not an alphanumeric the variant restyles — punctuation and
 * symbols keep their own codepoint in every variant.
 */
export function smpCodepoint(variant, code) {
  const remap = VARIANT_SMP[variant];
  if (!remap) return null;
  for (const [i, lo, hi] of SMP_RANGES) {
    const base = remap[i];
    if (!base) continue;
    if (code >= lo && code <= hi) {
      // U+03A2 is the hole where final sigma's capital would be; the ranges
      // above walk over it, so an offset computed across it would be wrong.
      if (code === 0x3a2) return null;
      const smp = base + code - lo;
      return SMP_REMAP[smp] ?? smp;
    }
    const extras = GREEK_EXTRAS[i];
    if (extras && Object.hasOwn(extras, code)) return base + extras[code];
  }
  const extra = remap[5];
  if (extra && Object.hasOwn(extra, code)) return extra[code];
  return null;
}
