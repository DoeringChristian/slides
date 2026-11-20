/**
 * Build OpenType text fonts from the exact Type 1 fonts and TeX metrics
 * acmart (SIGGRAPH, TOG) typesets with.
 *
 *   npm run build:texfont
 *
 * Output: `src/assets/fonts/LinuxLibertineT-*.otf` and `LinuxBiolinumT-*.otf`,
 * committed like the other bundled faces.
 *
 * Why not ship the OpenType Linux Libertine that TeX Live also carries? It is
 * not what acmart draws. acmart loads `\usepackage[T1]{fontenc}` and
 * `\usepackage[type1=true]{libertine}`, which sets the `LinLibertineT*.pfb`
 * Type 1 fonts through the `*-tlf-t1` virtual fonts. The OTFs next to them are
 * different releases (5.1.4–5.3.0) and 50–390 glyphs per style have different
 * outlines. So the bytes come from the files pdfTeX embeds:
 *
 *   outlines   the `.pfb` charstrings, unchanged (cubic Béziers in the same
 *              1000-unit em the OpenType CFF table uses)
 *   advances   the T1 TFM's widths, which is what TeX lays out with
 *   kerning    the T1 TFM's lig/kern program, as GPOS pair kerning
 *   ligatures  the same program's f-ligatures (ff fi fl ffi ffl), as `liga`
 *   space      the TFM's interword space (FONTDIMEN 2)
 *
 * The em is 16000 units, not the Type 1 fonts' 1000. Biolinum's outlines
 * carry fractional coordinates (`div` results like 504.9896), and CFF stores
 * a contour as integer steps from point to point; opentype.js rounds each
 * step on its own, so the error accumulates along a contour — 7.4 units by
 * the end of some Biolinum Italic glyphs, a visible shift. On a 16× grid,
 * snapped absolutely before writing, every step is exact and no point is
 * more than 1/32 of an original unit from TeX's.
 *
 * TeX's input ligatures (`--` → en dash, ``` `` ``` → “) are left out: a slide
 * is typed in Unicode, so they would rewrite what the author typed.
 *
 * Needs a TeX Live installation (`kpsewhich` on the PATH).
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as opentypeModule from 'opentype.js';

// CommonJS under plain Node (a default export), ESM under the harness's
// loader (named exports): accept either.
const opentype = opentypeModule.default ?? opentypeModule;
import { parseTfm, ligKern } from '../mathfont/tfm.mjs';
import { parseVf, soleGlyph } from '../mathfont/vf.mjs';
import { parseType1 } from '../mathfont/type1.mjs';
import { addSfntTable, gposKernTable } from './sfnt.mjs';

/** Units per original (1000-unit) em unit; see the header. */
export const GRID = 16;
/** CFF charstring integers stop at ±32767; glyphs that would not fit are
 *  left out (private-use ornaments over two ems wide). */
const CFF_LIMIT = 32000;

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '../..');
const OUT = resolve(REPO, 'src/assets/fonts');

/** The faces acmart sets, as `\rmfamily` and `\sffamily` in four styles. */
export const FACES = [
  {
    family: 'Linux Libertine T', file: 'LinuxLibertineT', otf: 'LinLibertine_R.otf',
    styles: {
      Regular: 'LinLibertineT-tlf-t1',
      Italic: 'LinLibertineTI-tlf-t1',
      Bold: 'LinLibertineTB-tlf-t1',
      BoldItalic: 'LinLibertineTBI-tlf-t1',
    },
  },
  {
    // Biolinum has no true italic in Type 1 at bold weight: libertine.sty's
    // bold italic sans IS the bold oblique, so that is what is shipped.
    family: 'Linux Biolinum T', file: 'LinuxBiolinumT', otf: 'LinBiolinum_R.otf',
    styles: {
      Regular: 'LinBiolinumT-tlf-t1',
      Italic: 'LinBiolinumTI-tlf-t1',
      Bold: 'LinBiolinumTB-tlf-t1',
      BoldItalic: 'LinBiolinumTBO-tlf-t1',
    },
  },
];

const kpseCache = new Map();
export function kpse(file) {
  if (!kpseCache.has(file)) {
    let p = '';
    try { p = execFileSync('kpsewhich', [file], { encoding: 'utf8' }).trim(); } catch { /* missing */ }
    if (!p) throw new Error(`kpsewhich cannot find ${file} — is TeX Live installed?`);
    kpseCache.set(file, p);
  }
  return kpseCache.get(file);
}

/** Adobe's glyph list plus TeX's additions: glyph name → codepoints. */
function loadGlyphList() {
  const map = new Map();
  for (const file of ['texglyphlist.txt', 'glyphlist.txt']) {
    for (const line of readFileSync(kpse(file), 'utf8').split('\n')) {
      if (!line || line.startsWith('#')) continue;
      const [name, codes] = line.split(';');
      if (!codes || map.has(name)) continue;
      // glyphlist.txt's own entries win over texglyphlist's, which redefines
      // some standard names for TeX's OT1 layout (e.g. `Delta`).
      const cps = codes.trim().split(/[\s,]+/).map((h) => parseInt(h, 16));
      if (file === 'glyphlist.txt' || !map.has(name)) map.set(name, cps);
    }
  }
  return map;
}

/** Unicode for a glyph name, or null: `uniXXXX`, `uXXXXX`, then the lists. */
export function nameToCodepoint(name, glyphList) {
  let m = /^uni([0-9A-F]{4})$/.exec(name);
  if (m) return parseInt(m[1], 16);
  m = /^u([0-9A-F]{4,6})$/.exec(name);
  if (m) return parseInt(m[1], 16);
  const cps = glyphList.get(name);
  return cps && cps.length === 1 ? cps[0] : null;
}

/** `{ pfb, enc }` for a `--base` TFM name, from the face's dvips map file. */
function baseFontFiles(baseName) {
  const map = readFileSync(kpse('libertine.map'), 'utf8');
  const line = map.split('\n').find((l) => l.startsWith(`${baseName} `));
  if (!line) throw new Error(`${baseName} is not in libertine.map`);
  const enc = /<\[?([\w.-]+\.enc)/.exec(line)?.[1];
  const pfb = /<([\w.-]+\.pfb)/.exec(line)?.[1];
  if (!enc || !pfb) throw new Error(`cannot read the map line for ${baseName}`);
  return { pfb, enc };
}

/** A PostScript encoding vector: slot → glyph name. */
function parseEnc(text) {
  const body = text.replace(/%.*$/gm, '');
  const open = body.indexOf('[');
  return body.slice(open + 1, body.indexOf(']', open)).match(/\/[^\s/[\]]+/g).map((s) => s.slice(1));
}

/**
 * Everything one style needs: glyph outlines and widths keyed by name, the
 * T1 slot each name occupies, kerning and ligatures in names, and the TFM's
 * font dimensions in 1000-unit em.
 */
export function loadStyle(tfmName) {
  const tfm = parseTfm(readFileSync(kpse(`${tfmName}.tfm`)));
  const vf = parseVf(readFileSync(kpse(`${tfmName}.vf`)));
  if (vf.fonts.size !== 1) throw new Error(`${tfmName}: expected one base font`);
  const [baseDef] = vf.fonts.values();
  const { pfb, enc } = baseFontFiles(baseDef.name);
  const type1 = parseType1(readFileSync(kpse(pfb)));
  const encoding = parseEnc(readFileSync(kpse(enc), 'latin1'));
  const em = (v) => Math.round(v * 1000);

  // T1 slot → base glyph name, through the virtual font.
  const slotName = new Map();
  for (const [code] of tfm.chars) {
    const items = vf.chars.get(code);
    const sole = items && soleGlyph(items);
    if (!sole || sole.h || sole.v) continue; // composite or shifted: TeX-only
    const name = encoding[sole.char];
    if (name && name !== '.notdef' && type1.glyphs.has(name)) slotName.set(code, name);
  }

  const widths = new Map();
  for (const [code, name] of slotName) widths.set(name, em(tfm.chars.get(code).width));

  const kerns = [];
  const pairLigs = new Map(); // "a b" → result name
  for (const [code, name] of slotName) {
    for (const step of ligKern(tfm, code)) {
      const next = slotName.get(step.next);
      if (!next) continue;
      if (step.kern !== undefined) {
        const v = em(step.kern);
        if (v) kerns.push([name, next, v]);
      } else if (step.lig.op === 0 && slotName.has(step.lig.char)) {
        pairLigs.set(`${name} ${next}`, slotName.get(step.lig.char));
      }
    }
  }

  const p = tfm.param.map(em);
  return {
    tfmName, pfb, type1, slotName, widths, kerns, pairLigs,
    dims: { slant: tfm.param[0], space: p[1], stretch: p[2], shrink: p[3], xHeight: p[4], quad: p[5] },
  };
}

/**
 * The f-ligatures as whole sequences: TeX builds `ffi` in two steps
 * (f f → ff, ff i → ffi); OpenType wants f f i → ffi in one rule.
 * Only sequences of letters qualify — see the header for why.
 */
export function letterLigatures(style, codepointOf) {
  const isLetter = (n) => { const c = codepointOf(n); return c != null && /\p{L}/u.test(String.fromCodePoint(c)); };
  const out = [];
  for (const [pair, result] of style.pairLigs) {
    const [a, b] = pair.split(' ');
    if (!isLetter(a) || !isLetter(b)) continue;
    out.push({ sub: [a, b], by: result });
    // A third letter continuing the ligature just made.
    for (const [pair2, result2] of style.pairLigs) {
      const [x, c] = pair2.split(' ');
      if (x === result && isLetter(c)) out.push({ sub: [a, b, c], by: result2 });
    }
  }
  // Longer first: a shaper takes the first rule that matches.
  return out.sort((l, r) => r.sub.length - l.sub.length);
}

function toPath(commands) {
  const path = new opentype.Path();
  for (const c of commands) {
    const a = c.args.map((v) => Math.round(v * GRID));
    if (c.op === 'M') path.moveTo(a[0], a[1]);
    else if (c.op === 'L') path.lineTo(a[0], a[1]);
    else if (c.op === 'C') path.curveTo(a[0], a[1], a[2], a[3], a[4], a[5]);
    else if (c.op === 'Z') path.close();
  }
  return path;
}

function buildFont(face, styleName, style, glyphList) {
  const { type1 } = style;
  // Line metrics from the same release's OpenType sibling, so the edit
  // overlay's CSS line box sits where Libertinus' does. They decide only
  // where a line's baseline goes, never a glyph's shape or advance.
  const sibling = opentype.parse(readFileSync(kpse(face.otf)).buffer);

  const codepointOf = (name) => nameToCodepoint(name, glyphList);
  const fits = (name) => type1.glyphs.get(name).path.every((c) => c.args.every((v) => Math.abs(v * GRID) <= CFF_LIMIT));
  const tooLarge = [...type1.glyphs.keys()].filter((n) => !fits(n));
  // The spaces are synthesised below with TeX's interword width; the font's
  // own `space` and `uni00A0` must not ALSO be kept, or two glyphs share a
  // name and a codepoint — a duplicate cmap entry, which Chrome's font
  // sanitiser rejects by refusing the whole font.
  const SYNTHESISED = new Set(['.notdef', 'space', 'uni00A0']);
  const names = ['.notdef', ...[...type1.glyphs.keys()].filter((n) => !SYNTHESISED.has(n) && fits(n))];
  const claimed = new Map(); // codepoint → glyph name
  // T1 glyphs first: they are what TeX sets for these characters.
  for (const name of style.slotName.values()) {
    const cp = codepointOf(name);
    if (cp != null && !claimed.has(cp)) claimed.set(cp, name);
  }
  for (const name of names) {
    const cp = codepointOf(name);
    if (cp != null && !claimed.has(cp)) claimed.set(cp, name);
  }
  const unicodesOf = new Map();
  for (const [cp, name] of claimed) {
    if (!unicodesOf.has(name)) unicodesOf.set(name, []);
    unicodesOf.get(name).push(cp);
  }

  const glyphs = [];
  const index = new Map();
  for (const name of names) {
    const g = type1.glyphs.get(name);
    index.set(name, glyphs.length);
    glyphs.push(new opentype.Glyph({
      name,
      unicodes: unicodesOf.get(name) ?? [],
      advanceWidth: GRID * (style.widths.get(name) ?? Math.round(g?.width ?? 500)),
      path: g ? toPath(g.path) : new opentype.Path(),
    }));
  }
  // TeX's interword space is glue, not a glyph: its natural width is
  // FONTDIMEN 2, which the space character carries here.
  for (const [name, cp] of [['space', 0x20], ['uni00A0', 0xA0]]) {
    index.set(name, glyphs.length);
    glyphs.push(new opentype.Glyph({ name, unicodes: [cp], advanceWidth: GRID * style.dims.space, path: new opentype.Path() }));
  }

  const [weight, italic] = { Regular: [400, false], Italic: [400, true], Bold: [700, false], BoldItalic: [700, true] }[styleName];
  const font = new opentype.Font({
    familyName: face.family,
    styleName: styleName.replace('BoldItalic', 'Bold Italic'),
    unitsPerEm: 1000 * GRID,
    ascender: GRID * sibling.ascender * 1000 / sibling.unitsPerEm,
    descender: GRID * sibling.descender * 1000 / sibling.unitsPerEm,
    designer: 'Philipp H. Poll',
    copyright: 'Linux Libertine by Philipp H. Poll; Type 1 conversion by Bob Tennent. '
      + 'GPL with font exception and SIL Open Font License.',
    license: 'GPL-2.0-or-later WITH Font-exception-2.0 OR OFL-1.1',
    version: `TeX Live ${style.pfb} via ${style.tfmName}`,
    weightClass: weight,
    italicAngle: italic ? Math.atan(style.dims.slant) * -180 / Math.PI : 0,
    glyphs,
  });
  // One set of line metrics everywhere — hhea, OS/2 typo and OS/2 win —
  // so every platform's CSS line box agrees with `textRowMetrics`.
  const ascent = Math.round(font.ascender), descent = Math.round(-font.descender);
  font.tables.os2 = {
    ...(font.tables.os2 ?? {}),
    fsSelection: (italic ? 1 : 0) | (weight === 700 ? 32 : 0) | (!italic && weight !== 700 ? 64 : 0) | 128,
    sTypoAscender: ascent, sTypoDescender: -descent, sTypoLineGap: 0,
    usWinAscent: ascent, usWinDescent: descent,
    sxHeight: GRID * style.dims.xHeight,
  };

  for (const lig of letterLigatures(style, codepointOf)) {
    if (lig.sub.every((n) => index.has(n)) && index.has(lig.by)) {
      font.substitution.add('liga', { sub: lig.sub.map((n) => index.get(n)), by: index.get(lig.by) });
    }
  }

  const pairs = style.kerns
    .filter(([a, b]) => index.has(a) && index.has(b))
    .map(([a, b, v]) => [index.get(a), index.get(b), GRID * v]);
  const bytes = new Uint8Array(font.toArrayBuffer());
  return { bytes: addSfntTable(bytes, 'GPOS', gposKernTable(pairs)), glyphs: glyphs.length, kerns: pairs.length, tooLarge };
}

function main() {
  mkdirSync(OUT, { recursive: true });
  const glyphList = loadGlyphList();
  for (const face of FACES) {
    for (const [styleName, tfmName] of Object.entries(face.styles)) {
      const style = loadStyle(tfmName);
      const { bytes, glyphs, kerns, tooLarge } = buildFont(face, styleName, style, glyphList);
      const file = `${OUT}/${face.file}-${styleName}.otf`;
      writeFileSync(file, bytes);
      console.log(`${face.file}-${styleName}.otf  ${glyphs} glyphs, ${kerns} kerning pairs, `
        + `${(bytes.length / 1024).toFixed(0)} KiB  (${style.pfb} + ${tfmName})`
        + (tooLarge.length ? `; left out, too large for CFF: ${tooLarge.join(' ')}` : ''));
    }
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
