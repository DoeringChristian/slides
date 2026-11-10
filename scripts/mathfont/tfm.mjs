/**
 * TFM (TeX Font Metric) parsing.
 *
 * TFM is where the numbers MathJax wants already live: per character a width,
 * height, depth and italic correction — exactly the first three slots and the
 * `ic` of a MathJax font entry — plus the `FONTDIMEN` parameters TeX itself
 * uses to lay math out (axis height, rule thickness, big-op spacing, …).
 * Taking them from here rather than measuring outlines means the deck is
 * spaced with the paper's own metrics.
 *
 * Format: Knuth, *TeX: The Program* §539ff. All dimensions are fix-words
 * (a signed 32-bit integer over 2^20) in units of the design size, which for
 * these fonts is the em — so the values drop straight into MathJax's em-based
 * table with no scaling.
 */

const FIX = 1 << 20;

/** Characters carry one of four tags; the last two chain to bigger glyphs. */
export const TAG = { NONE: 0, LIGKERN: 1, LIST: 2, EXT: 3 };

export function parseTfm(buffer) {
  const b = Buffer.from(buffer);
  const u16 = (i) => b.readUInt16BE(i);
  const fix = (i) => b.readInt32BE(i) / FIX;

  const lf = u16(0), lh = u16(2), bc = u16(4), ec = u16(6);
  const nw = u16(8), nh = u16(10), nd = u16(12), ni = u16(14);
  const nl = u16(16), nk = u16(18), ne = u16(20), np = u16(22);
  if (lf * 4 > b.length + 3) throw new Error('TFM truncated');

  // Section offsets, in bytes, in the order the format fixes them.
  let o = 24;
  const header = o;            o += lh * 4;
  const charInfo = o;          o += (ec - bc + 1) * 4;
  const widths = o;            o += nw * 4;
  const heights = o;           o += nh * 4;
  const depths = o;            o += nd * 4;
  const italics = o;           o += ni * 4;
  const ligKern = o;           o += nl * 4;
  const kerns = o;             o += nk * 4;
  const extens = o;            o += ne * 4;
  const params = o;

  const designSize = fix(header + 4);

  const chars = new Map();
  for (let c = bc; c <= ec; c++) {
    const p = charInfo + (c - bc) * 4;
    const wi = b[p];
    if (wi === 0) continue;            // width index 0 means "not present"
    const hi = b[p + 1] >> 4, di = b[p + 1] & 0xf;
    const ii = b[p + 2] >> 2, tag = b[p + 2] & 0x3;
    const rem = b[p + 3];
    chars.set(c, {
      width: fix(widths + wi * 4),
      height: hi ? fix(heights + hi * 4) : 0,
      depth: di ? fix(depths + di * 4) : 0,
      italic: ii ? fix(italics + ii * 4) : 0,
      tag,
      remainder: rem,
    });
  }

  // Extensible recipes: the four pieces TeX stacks to grow a delimiter.
  const extensible = [];
  for (let i = 0; i < ne; i++) {
    const p = extens + i * 4;
    extensible.push({ top: b[p] || 0, mid: b[p + 1] || 0, bot: b[p + 2] || 0, rep: b[p + 3] || 0 });
  }

  const param = [];
  for (let i = 0; i < np; i++) param.push(fix(params + i * 4));

  return { designSize, bc, ec, chars, extensible, param, ligKernCount: nl, kernCount: nk };
}

/**
 * Follow a character's `NEXTLARGER` chain.
 *
 * TeX grows `\big`…`\Bigg` delimiters by walking this chain before it falls
 * back to the extensible recipe, and MathJax's `size3`…`size6` variants are
 * the same idea, so the chain maps onto them in order.
 */
export function charList(tfm, code) {
  const seen = new Set();
  const out = [];
  let c = code;
  while (tfm.chars.has(c) && !seen.has(c)) {
    seen.add(c);
    const info = tfm.chars.get(c);
    if (info.tag !== TAG.LIST) break;
    c = info.remainder;
    out.push(c);
  }
  return out;
}

/** The extensible recipe for a character, or null when it has none. */
export function extensibleFor(tfm, code) {
  const info = tfm.chars.get(code);
  if (!info || info.tag !== TAG.EXT) return null;
  return tfm.extensible[info.remainder] || null;
}

/**
 * The math `FONTDIMEN` parameters, named.
 *
 * Slots 1–7 are shared by every font; a math-symbol font (OMS) adds 8–22 and
 * a math-extension font (OMX) adds 8–13. The names follow *The TeXbook*
 * Appendix G, which is also where MathJax's own parameter names come from.
 */
export function mathParams(tfm) {
  const p = (i) => tfm.param[i - 1] ?? 0;
  return {
    slant: p(1), space: p(2), stretch: p(3), shrink: p(4),
    xHeight: p(5), quad: p(6), extraSpace: p(7),
    // OMS (symbols)
    num1: p(8), num2: p(9), num3: p(10), denom1: p(11), denom2: p(12),
    sup1: p(13), sup2: p(14), sup3: p(15), sub1: p(16), sub2: p(17),
    supDrop: p(18), subDrop: p(19), delim1: p(20), delim2: p(21), axisHeight: p(22),
    // OMX (extension) — same slots, different meaning; the caller knows which
    // font it asked about.
    defaultRuleThickness: p(8), bigOpSpacing1: p(9), bigOpSpacing2: p(10),
    bigOpSpacing3: p(11), bigOpSpacing4: p(12), bigOpSpacing5: p(13),
  };
}
