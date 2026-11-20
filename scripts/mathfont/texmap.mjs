/**
 * The bridge from "what a character means" to "which slot draws it".
 *
 * MathJax keys its font data by Unicode codepoint; TeX keys its by
 * (symbol font, slot). Two files shipped with the packages close the gap, so
 * none of it has to be hand-authored:
 *
 *   - `unicode-math-table.tex` maps every math command to a codepoint, e.g.
 *     `\alpha` → U+03B1. This is unicode-math's own table, the same one
 *     `\setmathfont` uses.
 *   - `newtxmath.sty` declares which symbol font and slot each command comes
 *     from, e.g. `\DeclareMathSymbol{\alpha}{\mathalpha}{letters}{11}`.
 *
 * Composing them gives U+03B1 → (letters, slot 11) → nxlmi's slot 11 → an
 * outline and its metrics. The declarations name symbol fonts by role
 * (`letters`, `symbols`, `largesymbols`, `operators`), and those roles are the
 * same whichever text face newtxmath is configured for, so reading them all
 * without evaluating the package's conditionals is safe — a slot that really
 * does differ between modes shows up as a conflict and is reported.
 */

import { readFileSync } from 'node:fs';

/** TeX number: decimal, `"` hex, `'` octal, or a backtick character. */
export function texNumber(raw) {
  const s = String(raw).trim();
  if (/^"[0-9A-Fa-f]+$/.test(s)) return parseInt(s.slice(1), 16);
  if (/^'[0-7]+$/.test(s)) return parseInt(s.slice(1), 8);
  if (/^`\\?(.)$/.test(s)) return /^`\\?(.)$/.exec(s)[1].charCodeAt(0);
  if (/^-?\d+$/.test(s)) return Number(s);
  return null;
}

/** `\UnicodeMathSymbol{"0003B1}{\alpha}{\mathalpha}{…}` → command ⇄ codepoint. */
export function parseUnicodeMathTable(path) {
  const text = readFileSync(path, 'utf8');
  const byCommand = new Map();
  const re = /\\UnicodeMathSymbol\{"([0-9A-Fa-f]+)\}\{\s*(\\[A-Za-z@]+)\s*\}\{\s*(\\[A-Za-z@]+)\s*\}/g;
  let m;
  while ((m = re.exec(text))) {
    const code = parseInt(m[1], 16);
    const command = m[2];
    // First declaration wins: the table lists the canonical name first.
    if (!byCommand.has(command)) byCommand.set(command, { code, mathClass: m[3] });
  }
  return byCommand;
}

/**
 * Pull the math declarations out of a `.sty`.
 *
 * Handles both the plain LaTeX forms and newtx's `\re@…` wrappers, which take
 * the same arguments. Commented-out lines are skipped — newtx leaves a lot of
 * alternatives in place behind `%`.
 */
export function parseMathDeclarations(path) {
  const text = readFileSync(path, 'utf8')
    .split('\n')
    .map((l) => l.replace(/(^|[^\\])%.*$/, '$1'))   // strip comments, keep \%
    .join('\n');

  const symbols = new Map();      // command or char -> {font, slot, mathClass}
  const delimiters = new Map();   // command or char -> {small:{font,slot}, large:{font,slot}}
  const radicals = new Map();
  const accents = new Map();
  const conflicts = [];

  // One braced argument. The `\\s*` BETWEEN arguments is not cosmetic: LaTeX
  // breaks these declarations across lines (`\\DeclareMathDelimiter{\\uparrow}`
  // then `{\\mathrel}{symbols}{"22}{largesymbols}{"78}` on the next), and a
  // pattern that demands the arguments be adjacent silently sees 6 of
  // `fontmath.ltx`'s 34 delimiters.
  const arg = '\\s*\\{\\s*([^{}]*?)\\s*\\}';
  const decl = (name, args) =>
    new RegExp(`\\\\(?:re@)?Declare${name}${arg.repeat(args)}`, 'g');
  const sym = decl('MathSymbol', 4);
  const del = decl('MathDelimiter', 6);
  const rad = decl('MathRadical', 5);
  const acc = decl('MathAccent', 4);
  // `\\` cannot be a braced argument, so LaTeX declares it by expansion:
  // `\expandafter\DeclareMathDelimiter\@backslashchar{...}{...}{...}{...}{...}`.
  // Without this the one delimiter TeX draws from a different pair of slots
  // than Termes would silently keep Termes' glyphs.
  const delBackslash = new RegExp(
    `\\\\expandafter\\\\(?:re@)?DeclareMathDelimiter\\\\@backslashchar${arg.repeat(5)}`, 'g');

  let m;
  while ((m = sym.exec(text))) {
    const [, name, mathClass, font, slotRaw] = m;
    const slot = texNumber(slotRaw);
    if (slot === null || /^#/.test(name)) continue;    // macro definition, not a declaration
    const prev = symbols.get(name);
    if (prev && (prev.font !== font || prev.slot !== slot)) {
      conflicts.push({ name, from: prev, to: { font, slot } });
    }
    symbols.set(name, { font, slot, mathClass });
  }
  const addDelimiter = (name, sfont, sslot, lfont, lslot) => {
    if (/^#/.test(name)) return;
    const small = { font: sfont, slot: texNumber(sslot) };
    const large = { font: lfont, slot: texNumber(lslot) };
    if (small.slot === null || large.slot === null) return;
    delimiters.set(name, { small, large });
  };
  while ((m = del.exec(text))) {
    const [, name, , sfont, sslot, lfont, lslot] = m;
    addDelimiter(name, sfont, sslot, lfont, lslot);
  }
  while ((m = delBackslash.exec(text))) {
    const [, , sfont, sslot, lfont, lslot] = m;
    addDelimiter('\\\\', sfont, sslot, lfont, lslot);
  }
  // A radical names two fonts and two slots, exactly like a delimiter: the
  // small sign and the start of the size chain. Reading only the small pair
  // leaves `\sqrt` unable to grow.
  while ((m = rad.exec(text))) {
    const [, name, sfont, sslot, lfont, lslot] = m;
    if (/^#/.test(name)) continue;
    const small = { font: sfont, slot: texNumber(sslot) };
    const large = { font: lfont, slot: texNumber(lslot) };
    if (small.slot === null) continue;
    radicals.set(name, {
      font: small.font, slot: small.slot,
      small, large: large.slot === null ? null : large,
    });
  }
  while ((m = acc.exec(text))) {
    const [, name, , font, slotRaw] = m;
    if (/^#/.test(name)) continue;
    const slot = texNumber(slotRaw);
    if (slot !== null) accents.set(name, { font, slot });
  }
  return { symbols, delimiters, radicals, accents, conflicts };
}

/**
 * Join the two tables into `codepoint -> {font, slot, …}`.
 *
 * A declaration whose name is a single character (`\DeclareMathSymbol{0}…`)
 * carries its own codepoint; a command needs unicode-math to supply one.
 * Anything unmatched is returned in `unmapped` so the builder can say what it
 * could not place rather than quietly dropping it.
 */
export function buildCodepointMap(decls, unicodeMath) {
  const byCode = new Map();
  const unmapped = [];
  const place = (code, info, name) => {
    if (code === null || code === undefined) return;
    const prev = byCode.get(code);
    // Prefer the first binding; later duplicates are alternates.
    if (!prev) byCode.set(code, { ...info, name, code });
  };
  for (const [name, info] of decls.symbols) {
    if (name.length === 1) { place(name.charCodeAt(0), info, name); continue; }
    const um = unicodeMath.get(name);
    if (um) place(um.code, info, name);
    else unmapped.push(name);
  }
  return { byCode, unmapped };
}
