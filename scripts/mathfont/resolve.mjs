/**
 * Resolve a newtxmath logical font to drawable glyphs.
 *
 * One TeX slot becomes one `{ unicode, path, width, height, depth, italic }`:
 * the metrics come from the logical font's TFM (the numbers TeX lays out
 * with), the outline from whichever real Type 1 font the virtual font points
 * at, and the virtual font's horizontal correction is folded into the
 * outline's coordinates because MathJax has nowhere else to put it.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { parseTfm } from './tfm.mjs';
import { parseVf, soleGlyph } from './vf.mjs';
import { parseType1 } from './type1.mjs';

/** `u1D465` / `uni222B` / `afii10017` style names → a codepoint. */
export function glyphNameToUnicode(name) {
  let m = /^u([0-9A-Fa-f]{4,6})$/.exec(name);
  if (m) return parseInt(m[1], 16);
  m = /^uni([0-9A-Fa-f]{4})$/.exec(name);
  if (m) return parseInt(m[1], 16);
  // A one-character name IS that character, per the Adobe Glyph List's own
  // rule. This is how upright Latin arrives — `\sin`, `\log` and anything in
  // `\mathrm` are built from glyphs named plainly `A`…`z`.
  if (/^[A-Za-z]$/.test(name)) return name.charCodeAt(0);
  return AGL[name] ?? null;
}

/**
 * The Adobe Glyph List entries these fonts actually use.
 *
 * Only the names that appear in newtx's math fonts are listed; a name that
 * resolves to nothing is reported by the builder rather than guessed at, so
 * this table growing is a visible event.
 */
export const AGL = {
  space: 0x20, exclam: 0x21, quotedbl: 0x22, numbersign: 0x23, dollar: 0x24,
  percent: 0x25, ampersand: 0x26, quoteright: 0x2019, parenleft: 0x28,
  parenright: 0x29, asterisk: 0x2A, plus: 0x2B, comma: 0x2C, hyphen: 0x2D,
  period: 0x2E, slash: 0x2F, zero: 0x30, one: 0x31, two: 0x32, three: 0x33,
  four: 0x34, five: 0x35, six: 0x36, seven: 0x37, eight: 0x38, nine: 0x39,
  colon: 0x3A, semicolon: 0x3B, less: 0x3C, equal: 0x3D, greater: 0x3E,
  question: 0x3F, at: 0x40, bracketleft: 0x5B, backslash: 0x5C,
  bracketright: 0x5D, asciicircum: 0x5E, underscore: 0x5F, quoteleft: 0x2018,
  braceleft: 0x7B, bar: 0x7C, braceright: 0x7D, asciitilde: 0x7E,
  minus: 0x2212, periodcentered: 0x22C5, multiply: 0x00D7, divide: 0x00F7,
  plusminus: 0x00B1, infinity: 0x221E, partialdiff: 0x2202, radical: 0x221A,
  summation: 0x2211, product: 0x220F, integral: 0x222B, Delta: 0x0394,
  Omega: 0x03A9, degree: 0x00B0, dagger: 0x2020, daggerdbl: 0x2021,
  section: 0x00A7, paragraph: 0x00B6, emdash: 0x2014, endash: 0x2013,
  dieresis: 0x00A8, acute: 0x00B4, grave: 0x0060, circumflex: 0x02C6,
  tilde: 0x02DC, macron: 0x00AF, breve: 0x02D8, dotaccent: 0x02D9,
  ring: 0x02DA, cedilla: 0x00B8, hungarumlaut: 0x02DD, ogonek: 0x02DB,
  caron: 0x02C7, dotlessi: 0x0131, sterling: 0x00A3, florin: 0x0192,
};

/** Locate a TeX file the way kpathsea would, inside an unpacked tree. */
export function makeResolver(roots) {
  // (imported at module scope below)
  const index = new Map();
  const walk = (dir) => {
    for (const entry of readdirSync(dir)) {
      const p = `${dir}/${entry}`;
      let st;
      try { st = statSync(p); } catch { continue; }
      if (st.isDirectory()) walk(p);
      else if (!index.has(entry)) index.set(entry, p);
    }
  };
  for (const r of roots) walk(r);
  return (file) => index.get(file) ?? null;
}

/**
 * Load one logical (virtual) math font and return its drawable slots.
 *
 * `find` maps a bare filename to a path. Base fonts are cached across calls
 * because newtxmath's logical fonts share them.
 */
export function resolveLogicalFont(name, find, baseCache = new Map()) {
  const tfmPath = find(`${name}.tfm`);
  const vfPath = find(`${name}.vf`);
  if (!tfmPath) throw new Error(`missing ${name}.tfm`);
  if (!vfPath) throw new Error(`missing ${name}.vf`);

  const tfm = parseTfm(readFileSync(tfmPath));
  const vf = parseVf(readFileSync(vfPath));

  const base = (fontNum) => {
    const def = vf.fonts.get(fontNum);
    if (!def) return null;
    if (!baseCache.has(def.name)) {
      const p = find(`${def.name}.pfb`);
      baseCache.set(def.name, p ? parseType1(readFileSync(p)) : null);
    }
    return baseCache.get(def.name) ? { def, font: baseCache.get(def.name) } : null;
  };

  const slots = new Map();
  const problems = [];
  for (const [code, metrics] of tfm.chars) {
    const items = vf.chars.get(code);
    if (!items) { problems.push({ code, why: 'no VF packet' }); continue; }
    const sole = soleGlyph(items);
    if (!sole) { problems.push({ code, why: 'composite slot' }); continue; }
    const b = base(sole.font);
    if (!b) { problems.push({ code, why: `base font ${sole.font} unavailable` }); continue; }
    const gname = b.font.encoding[sole.char];
    if (!gname) { problems.push({ code, why: `no encoding for char ${sole.char} in ${b.def.name}` }); continue; }
    const glyph = b.font.glyphs.get(gname);
    if (!glyph) { problems.push({ code, why: `${b.def.name}:${gname} not in font` }); continue; }
    const unicode = glyphNameToUnicode(gname);
    slots.set(code, {
      unicode, glyphName: gname, baseFont: b.def.name,
      path: glyph.path, shift: sole.h * 1000, vshift: sole.v * 1000,
      width: metrics.width, height: metrics.height, depth: metrics.depth,
      italic: metrics.italic, tag: metrics.tag, remainder: metrics.remainder,
    });
  }
  return { name, tfm, vf, slots, problems };
}

/**
 * Load a plain (non-virtual) Type 1 font, keyed by codepoint.
 *
 * newtxmath binds its `operators` symbol font to the *text* face, which is
 * where upright math gets its digits, `+`, `=`, parentheses and uppercase
 * Greek — the characters a formula is held together by. There is no virtual
 * font in the way, so the glyph's own charstring gives the advance width and
 * its outline gives the height and depth, which is how TeX's own TFMs for
 * these faces were derived in the first place.
 *
 * `accept(codepoint)` decides what is worth taking: a text face carries
 * thousands of glyphs, and a math font has no use for most of them.
 */
export function resolvePlainFont(file, find, accept = () => true) {
  const path = find(file);
  if (!path) throw new Error(`missing ${file}`);
  const font = parseType1(readFileSync(path));
  const slots = new Map();
  for (const [name, glyph] of font.glyphs) {
    const unicode = glyphNameToUnicode(name);
    if (unicode == null || !accept(unicode)) continue;
    const box = bounds(glyph.path);
    if (!box) continue;
    if (slots.has(unicode)) continue;
    slots.set(unicode, {
      unicode, glyphName: name, baseFont: file.replace(/\.pfb$/, ''),
      path: glyph.path, shift: 0, vshift: 0,
      width: glyph.width / 1000,
      // Height and depth are the ink above and below the baseline, in em.
      height: Math.max(0, box[3]) / 1000,
      depth: Math.max(0, -box[1]) / 1000,
      italic: 0, tag: 0, remainder: 0,
    });
  }
  return { name: file, slots };
}

function bounds(path) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const c of path) {
    for (let i = 0; i + 1 < c.args.length; i += 2) {
      const x = c.args[i], y = c.args[i + 1];
      if (x < x0) x0 = x; if (x > x1) x1 = x;
      if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
  }
  return x0 === Infinity ? null : [x0, y0, x1, y1];
}
