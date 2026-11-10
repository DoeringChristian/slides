/**
 * Virtual font (`.vf`) parsing.
 *
 * newtxmath's math fonts are virtual: one TeX slot is drawn by picking a glyph
 * out of one of several real Type 1 fonts, often with a small horizontal shift
 * that corrects its side bearings. Skipping this layer and matching glyphs by
 * Unicode name gets the outlines right and the spacing subtly wrong, which is
 * exactly the kind of mismatch that makes a slide stop looking like the paper
 * — so the shifts are read here and baked into the emitted coordinates.
 *
 * Format: Knuth & Rokicki, *The DVI/VF format*. A VF is a preamble, a run of
 * font definitions, then one packet per character holding DVI commands.
 */

const SET_CHAR_0 = 0, SET1 = 128, SET_RULE = 132, PUT1 = 133, PUT_RULE = 137;
const NOP = 138, PUSH = 141, POP = 142;
const RIGHT1 = 143, W0 = 147, W1 = 148, X0 = 152, X1 = 153;
const DOWN1 = 157, Y0 = 161, Y1 = 162, Z0 = 166, Z1 = 167;
const FNT_NUM_0 = 171, FNT1 = 235;
const FNT_DEF1 = 243, PRE = 247, POST = 248;

export function parseVf(buffer) {
  const b = Buffer.from(buffer);
  let p = 0;
  const u8 = () => b[p++];
  const u16 = () => { const v = b.readUInt16BE(p); p += 2; return v; };
  const u24 = () => { const v = (b[p] << 16) | (b[p + 1] << 8) | b[p + 2]; p += 3; return v; };
  const u32 = () => { const v = b.readUInt32BE(p); p += 4; return v; };
  const i8 = () => b.readInt8(p++);
  const i16 = () => { const v = b.readInt16BE(p); p += 2; return v; };
  const i24 = () => { const v = (b.readInt8(p) << 16) | (b[p + 1] << 8) | b[p + 2]; p += 3; return v; };
  const i32 = () => { const v = b.readInt32BE(p); p += 4; return v; };
  const signed = (n) => (n === 1 ? i8() : n === 2 ? i16() : n === 3 ? i24() : i32());
  const unsigned = (n) => (n === 1 ? u8() : n === 2 ? u16() : n === 3 ? u24() : u32());

  if (u8() !== PRE) throw new Error('not a VF: no preamble');
  u8();                                  // identification byte
  // Not `p += u8()`: the compound assignment reads `p` before `u8()` advances
  // it, so the increment is lost and every offset after this drifts by one.
  const commentLength = u8();
  p += commentLength;
  u32();                                 // checksum
  const designSize = i32() / (1 << 20);

  const fonts = new Map();
  const chars = new Map();

  for (;;) {
    if (p >= b.length) break;
    const op = u8();
    if (op === POST) break;

    if (op >= FNT_DEF1 && op <= FNT_DEF1 + 3) {
      const num = unsigned(op - FNT_DEF1 + 1);
      u32();                              // checksum
      const scale = i32() / (1 << 20);
      const design = i32() / (1 << 20);
      const alen = u8(), llen = u8();
      const area = b.toString('latin1', p, p + alen); p += alen;
      const name = b.toString('latin1', p, p + llen); p += llen;
      fonts.set(num, { name, area, scale, design });
      continue;
    }

    // Character packet: short form (pl<=241) or long form (242).
    let pl, cc;
    if (op === 242) { pl = u32(); cc = u32(); i32(); }
    else if (op <= 241) { pl = op; cc = u8(); u24(); }
    else throw new Error(`unexpected VF opcode ${op}`);

    const end = p + pl;
    // Walk the packet's DVI program, tracking the pen and the current font.
    const items = [];
    let h = 0, v = 0, w = 0, x = 0, y = 0, z = 0, font = 0;
    const stack = [];
    while (p < end) {
      const c = b[p++];
      if (c >= SET_CHAR_0 && c < SET1) { items.push({ font, char: c, h, v }); continue; }
      if (c >= FNT_NUM_0 && c < FNT1) { font = c - FNT_NUM_0; continue; }
      if (c >= SET1 && c <= SET1 + 3) {
        const ch = unsigned(c - SET1 + 1);
        items.push({ font, char: ch, h, v });
        continue;
      }
      if (c >= PUT1 && c <= PUT1 + 3) {
        const ch = unsigned(c - PUT1 + 1);
        items.push({ font, char: ch, h, v, put: true });
        continue;
      }
      if (c >= RIGHT1 && c <= RIGHT1 + 3) { h += signed(c - RIGHT1 + 1) / (1 << 20); continue; }
      if (c >= DOWN1 && c <= DOWN1 + 3) { v += signed(c - DOWN1 + 1) / (1 << 20); continue; }
      if (c === W0) { h += w; continue; }
      if (c >= W1 && c <= W1 + 3) { w = signed(c - W1 + 1) / (1 << 20); h += w; continue; }
      if (c === X0) { h += x; continue; }
      if (c >= X1 && c <= X1 + 3) { x = signed(c - X1 + 1) / (1 << 20); h += x; continue; }
      if (c === Y0) { v += y; continue; }
      if (c >= Y1 && c <= Y1 + 3) { y = signed(c - Y1 + 1) / (1 << 20); v += y; continue; }
      if (c === Z0) { v += z; continue; }
      if (c >= Z1 && c <= Z1 + 3) { z = signed(c - Z1 + 1) / (1 << 20); v += z; continue; }
      if (c === PUSH) { stack.push([h, v, w, x, y, z]); continue; }
      if (c === POP) { [h, v, w, x, y, z] = stack.pop() || [0, 0, 0, 0, 0, 0]; continue; }
      if (c >= FNT1 && c <= FNT1 + 3) { font = unsigned(c - FNT1 + 1); continue; }
      if (c === SET_RULE || c === PUT_RULE) {
        const ht = i32() / (1 << 20), wd = i32() / (1 << 20);
        items.push({ rule: true, h, v, width: wd, height: ht });
        if (c === SET_RULE) h += wd;
        continue;
      }
      if (c === NOP) continue;
      // Anything else is a DVI command a VF packet is not allowed to use.
      throw new Error(`unexpected DVI command ${c} in VF packet for char ${cc}`);
    }
    p = end;
    chars.set(cc, items);
  }
  return { designSize, fonts, chars };
}

/**
 * The single glyph a VF slot draws, or null when the slot is not a plain
 * one-glyph mapping.
 *
 * Almost every newtxmath slot is "shift a little, set one character", which is
 * representable in MathJax as an outline with the shift folded in. A slot that
 * draws two glyphs or a rule is not, and the builder reports it rather than
 * guessing — composites are the one place where quietly dropping a piece would
 * look like a font bug rather than a missing feature.
 */
export function soleGlyph(items) {
  const drawn = items.filter((i) => !i.rule);
  const rules = items.filter((i) => i.rule);
  if (drawn.length !== 1 || rules.length > 0) return null;
  return drawn[0];
}
