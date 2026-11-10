/**
 * Generate a MathJax SVG font from newtxmath — the math font acmart sets.
 *
 * Run `npm run build:mathfont`. Output lands in
 * `src/utils/text/generated/newtx/`, which is committed: the editor bundles it
 * like any other math font, so nothing is fetched or typeset at runtime and an
 * exported deck carries the outlines it needs.
 *
 * Why generate rather than approximate: acmart's math is `newtxmath`, whose
 * outlines are Type 1 and exist in no OpenType font, so no published MathJax
 * package can match it. But a MathJax font is not an OpenType font — it is a
 * table of `[height, depth, width, {p}]` with the path in 1000-unit em space,
 * and Type 1 charstrings are cubic Béziers already in that space. So the
 * conversion is a transcription of the paper's own curves.
 *
 * Where each number comes from:
 *   outlines  the real Type 1 fonts, via the virtual font that says which one
 *             draws each slot (and by how much to shift it)
 *   metrics   the logical font's TFM — the same width/height/depth/italic
 *             correction TeX lays out with
 *   params    the TFM's FONTDIMEN block, so MathJax positions fractions,
 *             limits and radicals with TeX's own parameters
 *
 * Codepoints are recovered two ways, each where it is reliable: the
 * Libertine-derived fonts name their glyphs in Unicode (`u1D465`), while the
 * txfonts-derived symbol and extension fonts use classic TeX names, for which
 * the LaTeX math declarations give slot → command → codepoint.
 */

import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeResolver, resolveLogicalFont, resolvePlainFont } from './resolve.mjs';
import { parseMathDeclarations, parseUnicodeMathTable, buildCodepointMap } from './texmap.mjs';
import { parseTfm, mathParams, charList, extensibleFor, TAG } from './tfm.mjs';
import { smpCodepoint } from './smp.mjs';
import { pathToSvg } from './type1.mjs';
import { GREEK_LOWER, GREEK_UPPER, LATIN_ITALIC, DIGIT_CODES } from './aliases.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '../..');
const OUT = resolve(REPO, 'src/utils/text/generated/newtx');

/** newtxmath's symbol-font roles, and the logical font bound to each. */
const ROLE_FONT = { letters: 'nxlmi03', symbols: 'ntxsy', largesymbols: 'ntxexx' };

/**
 * The same roles in the bold math series.
 *
 * `\SetSymbolFont{letters}{bold}{OML}{nxlmi}{b}{it}` and its siblings, which
 * `omlnxlmi.fd` resolves to these files. This is what `\boldsymbol` sets.
 */
const BOLD_ROLE_FONT = { letters: 'nxlbmi03', symbols: 'ntxbsy', largesymbols: 'ntxbexx' };

/**
 * MathJax's size chain for a stretchy character, in order.
 *
 * `sizeVariants` in the font class is `['normal', ...this]`: a delimiter's
 * `sizes[i]` is looked up in the i-th of those, so a glyph's position in this
 * list and its position in the emitted `sizes` array have to agree exactly or
 * `\left(` renders a different glyph than it measured.
 */
const SIZE_VARIANTS = ['smallop', 'largeop', 'size3', 'size4', 'size5', 'size6'];

/**
 * Where the pieces of an assembled delimiter are filed.
 *
 * A delimiter taller than its largest discrete size is built from a top, a
 * bottom, a repeatable middle and sometimes a joint — four glyphs that are not
 * characters anyone types, and for several of which Unicode has no codepoint
 * (newtx has two whole families of paren pieces, and nothing for the radical's
 * extender). MathJax reaches them only through the `stretch` array, so the key
 * just has to be stable and unoccupied: the extension font's own slot number,
 * lifted into Plane 15. Claiming U+239B PAREN LEFT TOP for one of two
 * different paren tops would be a false identity, and a private-use key says
 * what this is — an internal handle.
 */
const PIECE_BASE = 0xF0000;

/**
 * Classic TeX command names that unicode-math files under a different
 * spelling (it prefers explicit `\mup…`/`\mit…` forms for Greek, and some
 * plain-TeX names predate its table).
 */
const CLASSIC_NAMES = (() => {
  const t = {};
  const greekLower = ['alpha','beta','gamma','delta','epsilon','zeta','eta','theta','iota','kappa','lambda','mu','nu','xi','omicron','pi','rho','varsigma','sigma','tau','upsilon','phi','chi','psi','omega'];
  greekLower.forEach((n, i) => { t['\\' + n] = 0x03B1 + i; });
  Object.assign(t, {
    '\\varepsilon': 0x03F5, '\\vartheta': 0x03D1, '\\varpi': 0x03D6,
    '\\varrho': 0x03F1, '\\varphi': 0x03D5, '\\varkappa': 0x03F0,
  });
  const greekUpper = ['Alpha','Beta','Gamma','Delta','Epsilon','Zeta','Eta','Theta','Iota','Kappa','Lambda','Mu','Nu','Xi','Omicron','Pi','Rho','Sigma','Tau','Upsilon','Phi','Chi','Psi','Omega'];
  greekUpper.forEach((n, i) => { t['\\' + n] = 0x0391 + i; });
  Object.assign(t, {
    '\\sqrtsign': 0x221A, '\\coprod': 0x2210, '\\bigvee': 0x22C1,
    '\\bigwedge': 0x22C0, '\\biguplus': 0x2A04, '\\bigcap': 0x22C2,
    '\\bigcup': 0x22C3, '\\intop': 0x222B, '\\prod': 0x220F,
    '\\sum': 0x2211, '\\bigotimes': 0x2A02, '\\bigoplus': 0x2A01,
    '\\bigodot': 0x2A00, '\\ointop': 0x222E, '\\bigsqcup': 0x2A06,
    '\\smallint': 0x222B, '\\lgroup': 0x27EE, '\\rgroup': 0x27EF,
    '\\bracevert': 0x23AA, '\\arrowvert': 0x23D0, '\\Arrowvert': 0x2016,
    '\\lmoustache': 0x23B0, '\\rmoustache': 0x23B1,
  });
  return t;
})();

function log(...a) { console.log(...a); }

/**
 * The codepoint a math command stands for.
 *
 * newtxmath routes its big operators through an `…op` alias — `\sum` is
 * `\DOTSI\sumop\slimits@`, and it is `\sumop` that carries the slot. The
 * alias is not in unicode-math's table, so stripping the suffix and asking
 * again is what connects `\sumop` to U+2211 and therefore to newtx's own
 * summation rather than the one LaTeX's defaults point at. The length guard
 * keeps `\top` from being read as `\t`.
 */
function codepointForCommand(name, unicodeMath) {
  if (name.length === 1) return name.charCodeAt(0);
  const direct = unicodeMath.get(name)?.code ?? CLASSIC_NAMES[name];
  if (direct != null) return direct;
  if (/op$/.test(name) && name.length >= 6) {
    const base = name.slice(0, -2);
    return unicodeMath.get(base)?.code ?? CLASSIC_NAMES[base] ?? null;
  }
  return null;
}

/** Build `role -> slot -> codepoint` from the LaTeX + newtx declarations. */
function slotCodepoints(texRoots, find) {
  const umPath = find('unicode-math-table.tex');
  const unicodeMath = umPath ? parseUnicodeMathTable(umPath) : new Map();
  const sources = ['fontmath.ltx', 'newtxmath.sty'].map(find).filter(Boolean);
  if (!sources.length) throw new Error('found neither fontmath.ltx nor newtxmath.sty');

  const bySlot = { letters: new Map(), symbols: new Map(), largesymbols: new Map(), operators: new Map() };
  const commands = new Map();
  const fenceDecls = new Map();
  const noCodepoint = [];
  // Sources in increasing authority. `fontmath.ltx` is LaTeX's own set and
  // newtxmath overrides parts of it, so a binding from the package outranks
  // the inherited one for the same character — which is how `\sum` ends up on
  // newtx's taller summation rather than the slot LaTeX puts it at.
  sources.forEach((src, rank) => {
    const decls = parseMathDeclarations(src);
    const note = (name, info) => commands.set(name, { ...info, rank: rank + 1 });
    for (const [name, info] of decls.symbols) note(name, info);
    for (const [name, info] of decls.radicals) {
      note(name, { ...info.small, mathClass: '\\mathradical' });
      if (info.large) note(`${name}@large`, { ...info.large, mathClass: '\\mathradical' });
      fenceDecls.set(name, { ...info, rank: rank + 1, kind: 'radical' });
    }
    for (const [name, info] of decls.delimiters) {
      note(name, { ...info.small, mathClass: '\\mathopen' });
      note(`${name}@large`, { ...info.large, mathClass: '\\mathopen' });
      fenceDecls.set(name, { ...info, rank: rank + 1, kind: 'delimiter' });
    }
  });
  // Record slot -> codepoints per symbol-font role.
  //
  // Keyed by SLOT, not by codepoint: several commands legitimately share a
  // codepoint (an alias, or a delimiter's small and large forms), and
  // inverting a codepoint-keyed map would silently drop every slot but one.
  //
  // And a slot maps to a SET of codepoints, not one, because the relation runs
  // both ways: TeX draws `\Vert`, `\parallel`, `\lVert` and `\rVert` with the
  // one `bardbl` glyph in `ntxsy` slot 0x6B, and Unicode gives the first two
  // different characters (U+2016 and U+2225). Keeping a single claim per slot
  // let whichever declaration was read first take the glyph and left the other
  // character with none — `\Vert` had no glyph at all for exactly this reason.
  for (const [name, info] of commands) {
    const role = bySlot[info.font];
    if (!role || info.slot == null) continue;
    const bare = name.replace(/@large$/, '');
    const code = codepointForCommand(bare, unicodeMath);
    if (code == null) { noCodepoint.push(bare); continue; }
    if (!role.has(info.slot)) role.set(info.slot, new Map());
    const claims = role.get(info.slot);
    // Keep the HIGHEST-ranked claim on a codepoint: a later source overrides
    // an earlier one (see `sources`).
    const prev = claims.get(code);
    if (!prev || info.rank > prev.rank) claims.set(code, { code, rank: info.rank });
  }
  // The stretchy characters, keyed by codepoint. A fence is not a symbol-font
  // slot but a PAIR — the ordinary-size sign and the start of a size chain in
  // the extension font — so it cannot ride along in `bySlot`, and the pair is
  // the whole point: the chain is what `\left(` grows through.
  const fences = new Map();
  const noFenceCodepoint = [];
  for (const [name, info] of fenceDecls) {
    const code = codepointForCommand(name, unicodeMath);
    if (code == null) { noFenceCodepoint.push(name); continue; }
    const prev = fences.get(code);
    if (prev && prev.rank > info.rank) continue;
    fences.set(code, { ...info, name });
  }
  return { bySlot, unicodeMath, commands, fences, noCodepoint, noFenceCodepoint };
}

/**
 * One MathJax entry: `[height, depth, width, {p, ic}]`, with the virtual
 * font's horizontal correction baked into the coordinates.
 *
 * `axis` re-centres the glyph, which the operators and delimiters need. TeX's
 * extension font hangs them below the baseline (a small height and a large
 * depth) and centres them on the math axis when it lays out — Appendix G's
 * rule for `\mathop`. MathJax instead expects the data to arrive already
 * centred: Termes' integral is h=1.097 d=0.597, whose midpoint is exactly its
 * 0.25 axis. Emitting TeX's own numbers unchanged would hand MathJax a glyph
 * it centres a second time, so the shift is applied here and the height and
 * depth are restated about the axis. The outline itself is untouched apart
 * from the translation.
 */
function entryFor(slot, axis = null) {
  let height = slot.height;
  let depth = slot.depth;
  let dy = slot.vshift;
  if (axis !== null) {
    const extent = slot.height + slot.depth;
    height = extent / 2 + axis;
    depth = extent / 2 - axis;
    dy += (height - slot.height) * 1000;
  }
  const extra = { p: pathToSvg(slot.path, slot.shift, dy) };
  if (slot.italic > 0.0005) extra.ic = round(slot.italic);
  return [round(height), round(depth), round(slot.width), extra];
}

const round = (v) => Math.round(v * 100000) / 100000;

const hex = (v) => `0x${v.toString(16).toUpperCase()}`;

/**
 * Our internal variant keys are JS identifiers; MathJax's are not.
 * `bold-italic` cannot name an export, and `-largeop` cannot name a file, so
 * the three spellings are kept apart deliberately rather than by accident.
 */
const MATHJAX_VARIANT = {
  boldItalic: 'bold-italic',
  calligraphic: '-tex-calligraphic', boldCalligraphic: '-tex-bold-calligraphic',
  smallop: '-smallop', largeop: '-largeop',
  size3: '-size3', size4: '-size4', size5: '-size5', size6: '-size6',
};
const FILE_NAME = { boldItalic: 'bold-italic', boldCalligraphic: 'bold-calligraphic' };

const DELIMITER_TYPE = `/** MathJax's stretchy-character entry.\n`
  + ` *\n`
  + ` *  \`sizes\` are total extents in em, one per discrete size, looked up at\n`
  + ` *  this codepoint in the font's \`sizeVariants\` in the same order;\n`
  + ` *  \`variants\` overrides that index when the sizes do not start at the\n`
  + ` *  normal variant. \`stretch\` is [top, extender, bottom] and optionally a\n`
  + ` *  middle joint, as codepoints in the normal variant. \`HDW\` gives the\n`
  + ` *  assembled height, depth and width, and \`c\` redirects the glyph lookup\n`
  + ` *  to another codepoint. */\n`
  + `type MathJaxDelimiter = {\n`
  + `  dir: 'v' | 'h';\n`
  + `  sizes?: number[];\n`
  + `  variants?: number[];\n`
  + `  stretch?: number[];\n`
  + `  HDW?: number[];\n`
  + `  c?: number;\n`
  + `};\n\n`;

function main() {
  const args = process.argv.slice(2);
  const rootArg = args.find((a) => a.startsWith('--texmf='));
  const roots = rootArg ? [rootArg.slice('--texmf='.length)] : defaultRoots();
  if (!roots.length) {
    console.error('No TeX tree found. Pass --texmf=<dir> pointing at an unpacked newtx, or run `npm run build:mathfont -- --download`.');
    process.exit(1);
  }
  log('Indexing', roots.join(', '));
  const find = makeResolver(roots);

  const { bySlot, fences, noFenceCodepoint } = slotCodepoints(roots, find);
  log('Declarations give codepoints for',
    Object.entries(bySlot).map(([k, v]) => `${k}:${v.size}`).join(' '));
  log('Stretchy characters declared:', fences.size,
    noFenceCodepoint.length ? `(${noFenceCodepoint.length} with no codepoint)` : '');

  // ── load the logical math fonts, medium and bold ───────────────────────────
  const baseCache = new Map();
  const fonts = {};
  const boldFonts = {};
  for (const [role, name] of Object.entries(ROLE_FONT)) {
    fonts[role] = resolveLogicalFont(name, find, baseCache);
    log(`  ${role.padEnd(13)} ${name}: ${fonts[role].slots.size} slots, ${fonts[role].problems.length} problems`);
  }
  for (const [role, name] of Object.entries(BOLD_ROLE_FONT)) {
    try {
      boldFonts[role] = resolveLogicalFont(name, find, baseCache);
      log(`  ${(role + ' (bold)').padEnd(13)} ${name}: ${boldFonts[role].slots.size} slots, ${boldFonts[role].problems.length} problems`);
    } catch (error) {
      log(`  (no bold ${role}: ${error.message})`);
    }
  }

  // ── assign slots to codepoints ────────────────────────────────────────────
  // A slot's codepoint comes from its glyph name when that name is a Unicode
  // one, and otherwise from the declaration that binds the slot. The first
  // covers the Libertine-derived letters, the second the txfonts-derived
  // symbols whose names are classic TeX ones.
  const chars = {
    normal: new Map(), bold: new Map(),
    italic: new Map(), boldItalic: new Map(),
    script: new Map(), calligraphic: new Map(), boldCalligraphic: new Map(),
    smallop: new Map(), largeop: new Map(),
    size3: new Map(), size4: new Map(), size5: new Map(), size6: new Map(),
  };
  const placed = [];
  const unplaced = [];
  const delimiters = new Map();

  // `axisCentred` marks the variants whose glyphs TeX positions about the math
  // axis rather than the baseline; see entryFor.
  const axisCentred = new Set(['smallop', 'largeop', 'size3', 'size4', 'size5', 'size6']);

  /**
   * Claim a codepoint for a slot, strongest evidence winning.
   *
   * Two slots can legitimately claim one codepoint, and picking the wrong one
   * is invisible in the data and obvious on the slide. `ntxexx` carries eight
   * integrals — sloped and upright, text and display — and LaTeX's inherited
   * `\intop` binding points at the upright one while newtxmath's own default
   * is sloped ("default is sloped", newtxmath.sty). The font settles it: a
   * glyph the font itself names `uni222B` is that character, where a slot
   * binding is only where some package happened to put it. So NAMED beats
   * every declaration, which in turn beats UPRIGHT — the upright faces have no
   * virtual font and no TFM, so their metrics are measured rather than
   * declared and they only ever fill a gap.
   */
  const NAMED = 10, UPRIGHT = 1;
  /** A declaration's authority is its source's rank; see `slotCodepoints`. */
  const declaredLevel = (entry) => 1 + (entry?.rank ?? 0);
  const strength = new Map();
  const place = (variant, code, slot, why, evidence) => {
    if (code == null) { unplaced.push({ slot, why }); return; }
    const key = `${variant}:${code}`;
    if ((strength.get(key) ?? 0) >= evidence) return;
    strength.set(key, evidence);
    chars[variant].set(code, slot);
    placed.push({ variant, code, why, evidence });
  };

  /**
   * Every codepoint a slot should be filed under, with its evidence.
   *
   * The glyph's own name says what the character IS; the declarations say what
   * else TeX draws with it. Both are wanted — the name so a contested
   * codepoint goes to the right slot, the declarations so every character TeX
   * spells with this glyph has one.
   */
  const targetsFor = (role, slotNum, slot) => {
    const out = [];
    if (slot.unicode != null) out.push({ code: slot.unicode, evidence: NAMED });
    for (const claim of bySlot[role].get(slotNum)?.values() ?? []) {
      if (claim.code !== slot.unicode) out.push({ code: claim.code, evidence: declaredLevel(claim) });
    }
    return out;
  };

  // letters: italic Latin + Greek + digits, named in Unicode by the font
  for (const [slotNum, slot] of fonts.letters.slots) {
    // `.alt`/`.oldstyle` glyphs have no codepoint and are alternates MathJax
    // has no variant for; they are listed, not guessed at.
    const targets = targetsFor('letters', slotNum, slot);
    if (!targets.length) { unplaced.push({ font: 'letters', slot: slotNum, name: slot.glyphName }); continue; }
    for (const { code, evidence } of targets) {
      const variant = slot.baseFont === 'stxscr' ? 'script'
        : (LATIN_ITALIC.has(code) || GREEK_LOWER.has(code)) ? 'italic' : 'normal';
      place(variant, code, slot, 'letters', evidence);
    }
  }
  /**
   * The calligraphic capitals, which the symbol font keeps at the ASCII letter
   * positions.
   *
   * TeX's OMS encoding puts `\mathcal A`…`\mathcal Z` in slots 0x41…0x5A, and
   * `txsys` names them `A`…`Z` — plainly, because within that encoding those
   * slots ARE the letters. Read through the Adobe Glyph List's rule that a
   * one-character name is that character, the font appears to claim U+0041
   * LATIN CAPITAL LETTER A for a swash calligraphic A, outranking the real
   * upright A from Libertine because a glyph name outranks a declaration.
   * That is how `\sin`, `\max` and `\mathrm{A}` came out calligraphic.
   *
   * MathJax keys its own calligraphic variants by the same plain codepoints,
   * so the slot number is the codepoint — only the variant was wrong.
   */
  const isCalligraphic = (slotNum) => slotNum >= 0x41 && slotNum <= 0x5A;

  // symbols: classic TeX names, so the declarations carry the codepoints
  for (const [slotNum, slot] of fonts.symbols.slots) {
    if (isCalligraphic(slotNum)) {
      place('calligraphic', slotNum, slot, 'symbols/calligraphic', NAMED);
      continue;
    }
    const targets = targetsFor('symbols', slotNum, slot);
    if (!targets.length) { unplaced.push({ font: 'symbols', slot: slotNum, name: slot.glyphName }); continue; }
    // Script capitals live in their own MathJax variant.
    const variant = slot.baseFont === 'stxscr' ? 'script' : 'normal';
    for (const { code, evidence } of targets) {
      place(variant, code, slot, 'symbols', evidence);
      // A symbol-font operator is the text-size one; MathJax calls that smallop.
      if (slot.tag === TAG.LIST) place('smallop', code, slot, 'symbols/list', evidence);
    }
  }
  // ── stretchy characters: the size chain, then the assembly recipe ────────
  //
  // `\left(` does not scale a paren. TeX walks a NEXTLARGER chain of
  // separately drawn parens until one is tall enough, and when it runs out it
  // builds one from a top, a bottom and a repeated middle. MathJax does the
  // same thing, and its `delimiters` table is where it reads the chain:
  // `sizes[i]` is the total extent of the i-th size, and the glyph for it is
  // looked up at the SAME codepoint in `sizeVariants[i]` — normal, then
  // smallop, largeop, size3…size6.
  //
  // That coupling is the whole reason this pass exists. The size tables and
  // the `sizes` array have to be generated together from one walk of one
  // chain, because a `sizes` array that promises seven sizes while the
  // variants hold four does not degrade — it indexes into whatever glyph
  // happens to be there. Inheriting Termes' table over newtx's glyphs did
  // exactly that: Termes says `(` has a 1.169 em size, MathJax looked it up in
  // `-largeop`, and found the top hook of an assembled paren sitting alone.
  //
  // The chain also ends differently than the operators' does. An operator
  // chains text size → display size and stops. A delimiter chains through four
  // or five sizes and then hits a character tagged EXT, which is not a size at
  // all but the recipe holder. Treating it as one is what produced the hook.
  const FENCE = 20;
  const claimedBySize = new Set();
  const extFont = fonts.largesymbols;
  /** File an assembly piece and return the codepoint it is reachable at. */
  const pieceOf = (slotNum) => {
    if (!slotNum) return 0;
    const slot = extFont.slots.get(slotNum);
    if (!slot) return 0;
    claimedBySize.add(slotNum);
    const code = PIECE_BASE + slotNum;
    place('normal', code, slot, 'fence/piece', FENCE);
    return code;
  };
  const skippedFences = [];
  for (const [code, decl] of fences) {
    if (decl.large?.font !== 'largesymbols') {
      skippedFences.push(`${decl.name}(${decl.large?.font ?? 'no large'})`);
      continue;
    }
    // Walk the chain, stopping at the EXT character that holds the recipe.
    const chain = [decl.large.slot, ...charList(extFont.tfm, decl.large.slot)];
    const discrete = [];
    let recipe = null;
    for (const slotNum of chain) {
      claimedBySize.add(slotNum);
      const r = extensibleFor(extFont.tfm, slotNum);
      if (r) { recipe = r; break; }
      discrete.push(slotNum);
    }

    // Size 0 is the ordinary character, already placed by the passes above.
    // Reading it back rather than re-deriving it is what keeps `sizes[0]`
    // equal to the glyph MathJax will actually find at index 0.
    const small = chars.normal.get(code);
    const sizes = [];
    const variantIndex = [];
    if (small) { sizes.push(small.height + small.depth); variantIndex.push(0); }
    discrete.slice(0, SIZE_VARIANTS.length).forEach((slotNum, k) => {
      const slot = extFont.slots.get(slotNum);
      if (!slot) return;
      place(SIZE_VARIANTS[k], code, slot, `fence/${decl.name}`, FENCE);
      sizes.push(slot.height + slot.depth);
      variantIndex.push(k + 1);
    });

    const rec = { dir: 'v' };
    if (sizes.length) {
      rec.sizes = sizes;
      // Only when the sizes do not start at the normal variant: a fence with
      // no ordinary-size form (`\lgroup`) would otherwise have MathJax look
      // its smallest size up in `normal`, where there is nothing.
      if (variantIndex.some((v, i) => v !== i)) rec.variants = variantIndex;
    }
    if (recipe) {
      const [top, rep, bot, mid] = [recipe.top, recipe.rep, recipe.bot, recipe.mid].map(pieceOf);
      rec.stretch = mid ? [top, rep, bot, mid] : [top, rep, bot];
      // For a vertical assembly MathJax recomputes height and depth from the
      // space it has to fill and takes only the width from here — the pieces'
      // width, which is the assembled delimiter's width. The height and depth
      // are its fallback when the caller gives no height/depth split, so they
      // come from the ordinary-size glyph.
      const repSlot = extFont.slots.get(recipe.rep) ?? extFont.slots.get(recipe.top);
      rec.HDW = [
        round(small ? small.height : 0.75),
        round(small ? small.depth : 0.25),
        round(repSlot ? repSlot.width : 0),
      ];
    }
    if (!rec.sizes && !rec.stretch) { skippedFences.push(`${decl.name}(empty)`); continue; }
    if (rec.sizes) rec.sizes = rec.sizes.map(round);
    delimiters.set(code, rec);
  }
  // Codepoints Unicode duplicates. MathJax's TeX input emits U+27E8 for
  // `\langle` and U+2223 for `\mid`, but a deck can also carry the characters
  // these alias, and a fence that grows in newtx beside one that grows in
  // Termes is visible. `c` points the size lookup at the codepoint whose
  // glyphs were generated, so no glyph is duplicated.
  for (const [alias, canonical] of [
    [0x2329, 0x27E8], [0x232A, 0x27E9], [0x2223, 0x7C], [0x2225, 0x2016],
  ]) {
    const rec = delimiters.get(canonical);
    if (rec && !delimiters.has(alias)) delimiters.set(alias, { ...rec, c: canonical });
  }
  log(`  ${'delimiters'.padEnd(13)} ${delimiters.size} stretchy characters`
    + (skippedFences.length ? `; skipped ${skippedFences.join(' ')}` : ''));

  // largesymbols: the big operators.
  //
  // TeX stores an operator at its text size and chains to the display size
  // with NEXTLARGER, which is exactly MathJax's smallop/largeop pair. Walk the
  // chain so the display integral is the one acmart actually sets — the glyph
  // whose absence started all of this.
  //
  // Slots the fence pass took are skipped: a delimiter's chain and an
  // operator's mean different things, and this loop would read a paren's
  // five-step chain as if its last step were a display-size operator.
  for (const [slotNum, slot] of fonts.largesymbols.slots) {
    if (claimedBySize.has(slotNum)) continue;
    const targets = targetsFor('largesymbols', slotNum, slot);
    if (!targets.length) { unplaced.push({ font: 'largesymbols', slot: slotNum, name: slot.glyphName }); continue; }
    const chain = charList(fonts.largesymbols.tfm, slotNum);
    const biggest = chain.length ? fonts.largesymbols.slots.get(chain[chain.length - 1]) : slot;
    for (const { code, evidence } of targets) {
      place('smallop', code, slot, 'largesymbols/base', evidence);
      if (biggest) place('largeop', code, biggest, 'largesymbols/chain', evidence);
    }
  }

  // ── the operators role: upright math, from the faces acmart sets it in ───
  //
  // newtxmath binds `operators` to the text face, so uppercase Greek comes
  // from newtx's upright math roman and the digits, binary operators and
  // parentheses from Libertine itself. Without these a formula renders its
  // variables from newtxmath and everything holding them together from
  // whatever font MathJax falls back to, which is visible at a glance.
  const MATH_PUNCTUATION = new Set([
    0x00D7, 0x00F7, 0x00B1, 0x2212, 0x2013, 0x2014, 0x2018, 0x2019, 0x2032, 0x2033,
  ]);
  const wantedUpright = (code) =>
    (code >= 0x21 && code <= 0x7E) || MATH_PUNCTUATION.has(code)
    || (code >= 0x0391 && code <= 0x03A9);
  for (const file of ['LibertineMathRM.pfb', 'LinLibertineT.pfb']) {
    let upright;
    try {
      upright = resolvePlainFont(file, find, wantedUpright);
    } catch (error) {
      log(`  (skipped ${file}: ${error.message})`);
      continue;
    }
    let taken = 0;
    for (const [code, slot] of upright.slots) {
      const before = chars.normal.size;
      place('normal', code, slot, `operators/${upright.name}`, UPRIGHT);
      if (chars.normal.size > before) taken++;
    }
    log(`  ${'operators'.padEnd(13)} ${file}: ${upright.slots.size} candidates, ${taken} filled a gap`);
  }

  // ── bold math ─────────────────────────────────────────────────────────────
  //
  // `\mathbf{x}` does not look up `x` in a bold table. MathJax rewrites each
  // variant's map with a redirect — `bold[0x78] = {smp: 0x1D431}` — and then
  // looks the redirected codepoint up in that same variant, so a bold glyph
  // has to be filed under U+1D431 MATHEMATICAL BOLD SMALL X. A table keyed by
  // plain `x` is simply never read, which is why bold math was falling through
  // to Termes however complete the medium series was. `smpCodepoint` is that
  // rewrite, and it also carries Unicode's holes: italic `h` belongs at U+210E
  // PLANCK CONSTANT, because U+1D455 was never assigned.
  //
  // The bold-italic letters need none of it — `nxlbmi03`'s own glyph names are
  // already the bold-italic codepoints (`u1D468` for bold italic A), so the
  // font states where each glyph goes.
  if (boldFonts.letters) {
    for (const [code, slot] of boldFonts.letters.slots) {
      // `stxscr` is the same script face in both series — not a bold font, so
      // taking it here would promise a bold script it cannot draw.
      if (slot.baseFont === 'stxscr') continue;
      const targets = slot.unicode != null
        ? [{ code: slot.unicode, evidence: NAMED }]
        : targetsFor('letters', code, slot)
          .map((t) => ({ ...t, code: smpCodepoint('bold-italic', t.code) }))
          .filter((t) => t.code != null);
      if (!targets.length) { unplaced.push({ font: 'letters(bold)', slot: code, name: slot.glyphName }); continue; }
      for (const { code: target, evidence } of targets) {
        place('boldItalic', target, slot, 'letters(bold)', evidence);
      }
    }
  }
  if (boldFonts.symbols) {
    for (const [code, slot] of boldFonts.symbols.slots) {
      if (slot.baseFont === 'stxscr') continue;
      if (isCalligraphic(code)) {
        place('boldCalligraphic', code, slot, 'symbols(bold)/calligraphic', NAMED);
        continue;
      }
      const targets = targetsFor('symbols', code, slot);
      if (!targets.length) { unplaced.push({ font: 'symbols(bold)', slot: code, name: slot.glyphName }); continue; }
      for (const { code: plain, evidence } of targets) {
        // A symbol keeps its own codepoint in every variant; only the
        // alphanumerics are restyled through the Mathematical Alphanumeric block.
        place('bold', smpCodepoint('bold', plain) ?? plain, slot, 'symbols(bold)', evidence);
      }
    }
  }
  // Upright bold: `\mathbf` is the bold TEXT face (newtxmath sets
  // `\DeclareMathAlphabet{\mathbf}{\tx@enc}{\rmdefaultB}{\bold@wt}{n}`), with
  // bold uppercase Greek from newtx's own bold math roman.
  // `LibertineMathBRM` already names its glyphs by the codepoint they belong
  // at — `u1D6AA` is MATHEMATICAL BOLD CAPITAL GAMMA — where the text face
  // names them plainly and needs the mapping. Filtering both on plain
  // codepoints found nothing in the math roman, which is where every bold
  // Greek letter lives.
  const SMP_BLOCK = (code) => code >= 0x1D400 && code <= 0x1D7FF;
  const wantedBold = (code) => wantedUpright(code) || SMP_BLOCK(code);
  for (const file of ['LibertineMathBRM.pfb', 'LinLibertineTB.pfb']) {
    let upright;
    try {
      upright = resolvePlainFont(file, find, wantedBold);
    } catch (error) {
      log(`  (skipped ${file}: ${error.message})`);
      continue;
    }
    let taken = 0;
    for (const [code, slot] of upright.slots) {
      const target = SMP_BLOCK(code) ? code : (smpCodepoint('bold', code) ?? code);
      const before = chars.bold.size;
      place('bold', target, slot, `mathbf/${upright.name}`, UPRIGHT);
      if (chars.bold.size > before) taken++;
    }
    log(`  ${'mathbf'.padEnd(13)} ${file}: ${upright.slots.size} candidates, ${taken} filled a gap`);
  }

  log('\nPlaced', placed.length, 'entries;', unplaced.length, 'slots had no codepoint');
  const counts = Object.fromEntries(Object.entries(chars).map(([k, v]) => [k, v.size]));
  log('Per variant:', JSON.stringify(counts));

  // ── params from the TFMs ──────────────────────────────────────────────────
  const symParams = mathParams(fonts.symbols.tfm);
  const extParams = mathParams(fonts.largesymbols.tfm);
  const params = {
    x_height: symParams.xHeight,
    quad: symParams.quad,
    num1: symParams.num1, num2: symParams.num2, num3: symParams.num3,
    denom1: symParams.denom1, denom2: symParams.denom2,
    sup1: symParams.sup1, sup2: symParams.sup2, sup3: symParams.sup3,
    sub1: symParams.sub1, sub2: symParams.sub2,
    sup_drop: symParams.supDrop, sub_drop: symParams.subDrop,
    delim1: symParams.delim1, delim2: symParams.delim2,
    axis_height: symParams.axisHeight,
    rule_thickness: extParams.defaultRuleThickness,
    big_op_spacing1: extParams.bigOpSpacing1, big_op_spacing2: extParams.bigOpSpacing2,
    big_op_spacing3: extParams.bigOpSpacing3, big_op_spacing4: extParams.bigOpSpacing4,
    big_op_spacing5: extParams.bigOpSpacing5,
  };
  // The thickness of the radical's own top arm, which is what MathJax draws
  // the vinculum over the radicand with: `msqrt` places the surd with its
  // bbox top at the rule's top and fills `surd_height` downwards, so the two
  // only meet flush if this is the arm.
  //
  // TeX states it rather than leaving it to be measured: a radical's TFM
  // *height* is the arm, which is why `radicalbig` is listed at h=0.056 with a
  // depth of 1.172 — the sign hangs below the baseline and only the arm is
  // above it. Confirmed against the outline, whose ink stops at y=56.
  const radical = fonts.largesymbols.slots.get(fences.get(0x221A)?.large?.slot);
  if (radical) params.surd_height = radical.height;
  else log('  (no radical: surd_height left to the inherited value)');

  // ── emit ──────────────────────────────────────────────────────────────────
  for (const k of Object.keys(params)) params[k] = round(params[k]);
  mkdirSync(OUT, { recursive: true });
  const header = (what) => `// GENERATED by scripts/mathfont/build.mjs — do not edit.\n`
    + `// ${what}\n// Source: newtxmath (LPPL 1.3) / txfonts, via their Type 1 outlines and TFM metrics.\n\n`;

  const CHAR_TYPE = `/** MathJax's glyph entry: height, depth and width in em, then the outline\n`
    + ` *  in 1000-unit em space and the italic correction. */\n`
    + `type MathJaxChar = [number, number, number, { p: string; ic?: number }];\n\n`;

  for (const [variant, table] of Object.entries(chars)) {
    const body = [...table.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([code, slot]) => {
        const e = entryFor(slot, axisCentred.has(variant) ? params.axis_height : null);
        const extra = Object.entries(e[3]).map(([k, v]) => `${k}: ${k === 'p' ? JSON.stringify(v) : v}`).join(', ');
        return `  0x${code.toString(16).toUpperCase()}: [${e[0]}, ${e[1]}, ${e[2]}, { ${extra} }],`;
      }).join('\n');
    writeFileSync(`${OUT}/${FILE_NAME[variant] ?? variant}.ts`,
      `${header(`MathJax '${MATHJAX_VARIANT[variant] ?? variant}' variant, ${table.size} characters`)}${CHAR_TYPE}`
      + `export const ${variant}: Record<number, MathJaxChar> = {\n${body}\n};\n`);
  }
  writeFileSync(`${OUT}/delimiters.ts`,
    `${header(`${delimiters.size} stretchy characters: TeX's size chains and extensible recipes`)}`
    + DELIMITER_TYPE
    + `export const delimiters: Record<number, MathJaxDelimiter> = {\n`
    + [...delimiters.entries()].sort((a, b) => a[0] - b[0]).map(([code, rec]) => {
      const fields = Object.entries(rec).map(([k, v]) => {
        if (k === 'dir') return `dir: ${JSON.stringify(v)}`;
        if (Array.isArray(v)) return `${k}: [${v.map((n) => (k === 'sizes' || k === 'HDW' ? n : hex(n))).join(', ')}]`;
        return `${k}: ${k === 'c' ? hex(v) : v}`;
      });
      return `  ${hex(code)}: { ${fields.join(', ')} },`;
    }).join('\n')
    + `\n};\n`);
  writeFileSync(`${OUT}/params.ts`,
    `${header("newtxmath's TeX FONTDIMEN parameters, in em")}`
    + `export const params: Record<string, number> = ${JSON.stringify(params, null, 2)};\n`);
  writeFileSync(`${OUT}/meta.json`, JSON.stringify({
    generated: new Date().toISOString().slice(0, 10),
    variants: counts,
    delimiters: delimiters.size,
    unplacedSlots: unplaced.length,
    params,
  }, null, 2) + '\n');

  log('\nWrote', OUT);
  log('Unplaced sample:', unplaced.slice(0, 10).map((u) => `${u.font}:${u.slot}${u.name ? '(' + u.name + ')' : ''}`).join(' '));
}

function defaultRoots() {
  const guesses = [];
  try {

    const p = execSync('kpsewhich -var-value=TEXMFDIST', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    if (p && existsSync(p)) guesses.push(p);
  } catch { /* no TeX installation; the caller must pass --texmf or --download */ }
  const vendored = resolve(REPO, 'vendor/newtx');
  if (existsSync(vendored)) guesses.unshift(vendored);
  return guesses;
}

main();
