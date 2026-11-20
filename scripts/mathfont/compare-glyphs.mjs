/**
 * Glyph-by-glyph comparison of math: what pdfLaTeX's acmart draws against
 * what this app's MathJax setup draws, for the same formulas.
 *
 *   npx tsx --import ./scripts/mathfont/asset-stub.mjs scripts/mathfont/compare-glyphs.mjs [--out=dir] [--verbose]
 *
 * LAYOUT is not compared — MathJax places glyphs by its own rules, which is
 * a known and accepted difference. What is compared is each GLYPH: that the
 * app draws the same outline TeX draws, at the same size relative to the body
 * em. For every glyph TeX placed (from MuPDF's trace of the PDF: font, glyph
 * name, size) the outline is read from that font's `.pfb`; for every glyph
 * the app placed (from the SVG, with the transform chain resolved) the
 * outline is its path data. Each TeX glyph is paired with the app glyph whose
 * outline matches best, and is reported as
 *
 *   same       same outline (to the 0.1-unit precision the font data is
 *              written to) at the same size
 *   size       same outline, different size — e.g. a script set at 70%
 *              where TeX sets it at 73.3%
 *   DIFFERENT  no app glyph has this outline: the app drew another glyph
 *
 * Needs TeX Live with acmart, and `mutool`.
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { texFragmentToSvg } from '../../src/services/latexToSvg.ts';
import { parseType1 } from './type1.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '../..');
const args = process.argv.slice(2);
const OUT = resolve(REPO, (args.find((a) => a.startsWith('--out=')) ?? '--out=compare-out/math-glyphs').slice(6));
const VERBOSE = args.includes('--verbose');

/** Outline match tolerance, in 1/1000 of the glyph's own em: the font data
 *  is written to 0.1 unit, plus float noise. */
const SHAPE_TOLERANCE = 0.15;
/** For a mark made of several TeX glyphs: pdfTeX writes positions inside a
 *  text run as whole thousandths of the font size and corrects the drift
 *  only once it reaches a unit, so a non-integer gap (a thin space is 166.67
 *  units) reads 419 then 420 where TeX had 419.67 twice. */
const COMPOSITE_TOLERANCE = 1;
/** Size match tolerance, relative. */
const SIZE_TOLERANCE = 0.002;

/** [formula, display] — chosen to put every glyph class at every script level. */
const FORMULAS = [
  ['abcdefghijklmnopqrstuvwxyz', false],
  ['ABCDEFGHIJKLMNOPQRSTUVWXYZ', false],
  ['\\alpha\\beta\\gamma\\delta\\epsilon\\varepsilon\\zeta\\eta\\theta\\vartheta\\iota\\kappa\\lambda\\mu\\nu\\xi\\pi\\varpi\\rho\\varrho\\sigma\\varsigma\\tau\\upsilon\\phi\\varphi\\chi\\psi\\omega', false],
  ['\\Gamma\\Delta\\Theta\\Lambda\\Xi\\Pi\\Sigma\\Upsilon\\Phi\\Psi\\Omega', false],
  ['0123456789', false],
  ['+-=<>\\le\\ge\\times\\cdot\\pm\\mp\\ne\\approx\\equiv\\sim\\propto', false],
  ['\\to\\leftarrow\\Rightarrow\\mapsto\\in\\subset\\cup\\cap\\forall\\exists\\partial\\nabla\\infty', false],
  ['(a)[b]\\{c\\}|d|\\langle e\\rangle', false],
  ['x^{2} y_{i} z_{i}^{n} a^{b^{c}} e^{-x^{2}}', false],
  ['x_{a b c}^{x y z} \\alpha_{\\beta}^{\\gamma} A_{0 1}^{2 3}', false],
  ['\\frac{a+b}{c-d} \\tfrac{1}{2}', false],
  ['\\sum_{i=1}^{n} \\prod_{k} \\int_{0}^{1} \\oint', false],
  ['\\sum_{i=1}^{n} \\prod_{k} \\int_{0}^{1} \\oint', true],
  ['\\mathcal{ABCLRF} \\mathbb{RNZ} \\mathbf{xyzAB} \\boldsymbol{\\alpha\\beta x}', false],
  ['\\sin\\cos\\log\\exp\\max\\mathrm{d}x', false],
  ['\\hat{a}\\tilde{b}\\bar{c}\\vec{v}\\dot{x}', false],
  ['f\'(x) = \\sqrt{x}', false],
  ['g\'\'(t) \\quad x_{\\alpha\\Gamma}^{\\Omega\\omega} \\quad e^{i\\pi} \\quad x_{\\mathbf{y}}^{\\mathcal{L}}', false],
  ['\\boldsymbol{\\nabla}_{\\boldsymbol{x}} \\quad \\mathbf{A}^{\\mathbf{-1}} \\quad \\mathbb{E}_{x}[f]', false],
  ['\\left( \\frac{a}{b} \\right) \\left[ \\frac{a}{\\frac{b}{c}} \\right] \\left\\{ x \\right\\}', true],
  ['\\bigl( \\Bigl( \\biggl( \\Biggl( x', false],
  ['\\sqrt{2} \\sqrt{\\frac{a}{b}} \\sqrt[3]{x}', true],
  ['\\lim_{x \\to 0} \\max_{k} \\log_{2} n \\quad \\binom{n}{k}', true],
  ['a_1, \\ldots, a_n \\cdots \\quad \\|x\\| \\quad |y| \\quad x \\mid y', false],
  ['\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}', true],
  ['\\leq\\geq\\ll\\gg\\subseteq\\supseteq\\neq\\simeq\\cong\\perp\\parallel\\otimes\\oplus\\circ\\bullet\\star\\ast\\dagger', false],
  ['\\hbar\\ell\\Re\\Im\\aleph\\emptyset\\angle\\triangle\\neg\\top\\bot\\vee\\wedge\\setminus\\cdot', false],
  ['\\frac{\\partial L}{\\partial \\theta_{i}} = \\sum_{j} w_{ij}^{(t)} x_{j}', true],
];

const run = (cmd, argv, opts = {}) => execFileSync(cmd, argv, { encoding: 'utf8', maxBuffer: 1 << 28, ...opts });
const kpse = (file) => run('kpsewhich', [file]).trim();

// ── TeX ─────────────────────────────────────────────────────────────────────

function typeset(dir) {
  const pages = FORMULAS.map(([f, display]) => `\\sbox0{$${display ? '\\displaystyle ' : ''}${f}$}\\shipout\\box0`).join('\n');
  writeFileSync(`${dir}/ref.tex`, String.raw`\documentclass[sigconf]{acmart}
\settopmatter{printacmref=false,printfolios=false}\setcopyright{none}
\renewcommand\footnotetextcopyrightpermission[1]{}
\begin{document}
${pages}
\end{document}
`);
  run('pdflatex', ['-interaction=nonstopmode', 'ref.tex'], { cwd: dir, stdio: ['ignore', 'pipe', 'pipe'] });
  const xml = run('mutool', ['draw', '-q', '-F', 'trace', '-o', '-', `${dir}/ref.pdf`]);
  return xml.split('<page ').slice(1, FORMULAS.length + 1).map((page) => {
    const glyphs = [];
    for (const span of page.split('<span ').slice(1)) {
      const font = /font="(?:[A-Z]{6}\+)?([^"]+)"/.exec(span)[1];
      const size = Number(/trm="([\d.]+)/.exec(span)[1]);
      for (const g of span.matchAll(/<g [^>]*glyph="([^"]+)" x="([\d.-]+)" y="([\d.-]+)"/g)) {
        glyphs.push({ font, size, glyph: g[1], x: Number(g[2]), y: Number(g[3]) });
      }
    }
    // Glyphs TeX lays at one origin, in one font and size, are one mark on
    // the page: `\mapsto` is the bar `\mapstochar` (zero width) and the
    // arrow. MathJax draws such a mark as one glyph, so compare it as one.
    const merged = [];
    for (const g of glyphs) {
      const prev = merged.at(-1);
      if (prev && prev.font === g.font && prev.size === g.size && prev.x === g.x && prev.y === g.y) {
        prev.parts.push(g.glyph);
      } else merged.push({ ...g, parts: [g.glyph] });
    }
    return merged;
  });
}

/** The body size the trace's sizes are relative to: acmart sigconf, 9 pt. */
const BODY_BP = 9 * 72 / 72.27;

const type1Fonts = new Map();
/**
 * The outline of a TeX mark — one glyph, or a run of glyphs drawn as one
 * mark (`''` is two primes, `\ldots` three periods) — in the first glyph's
 * units, each piece offset by where TeX put it.
 */
function texOutline(run) {
  const [first] = run;
  return run.flatMap((g) => {
    if (!type1Fonts.has(g.font)) type1Fonts.set(g.font, parseType1(readFileSync(kpse(`${g.font}.pfb`))));
    const dx = (g.x - first.x) / first.size * 1000;
    return g.parts.flatMap((glyph) => {
      const t1 = type1Fonts.get(g.font).glyphs.get(glyph);
      if (!t1) throw new Error(`${g.font}.pfb has no glyph ${glyph}`);
      return t1.path.filter((c) => c.op !== 'Z').flatMap((c) => c.args.map((v, i) => (i % 2 === 0 ? v + dx : v)));
    });
  });
}

// ── the app ─────────────────────────────────────────────────────────────────

/** 2-D affine [a b c d e f], composed left to right as SVG does. */
const mul = (m, n) => [
  m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5],
];
function parseTransform(attr) {
  let m = [1, 0, 0, 1, 0, 0];
  for (const [, fn, raw] of attr.matchAll(/(\w+)\(([^)]*)\)/g)) {
    const v = raw.split(/[\s,]+/).filter(Boolean).map(Number);
    if (fn === 'translate') m = mul(m, [1, 0, 0, 1, v[0], v[1] ?? 0]);
    else if (fn === 'scale') m = mul(m, [v[0], 0, 0, v[1] ?? v[0], 0, 0]);
    else if (fn === 'matrix') m = mul(m, v);
    else throw new Error(`transform ${fn} not handled`);
  }
  return m;
}

/** Every glyph the SVG draws: its outline points (font units) and scale. */
function appGlyphs(svg) {
  const defs = new Map([...svg.matchAll(/<path id="([^"]+)" d="([^"]*)"/g)].map((m) => [m[1], m[2]]));
  const stack = [[1, 0, 0, 1, 0, 0]];
  const glyphs = [];
  for (const [tag] of svg.matchAll(/<\/?[a-z]+[^>]*?\/?>/g)) {
    if (tag.startsWith('</')) { if (/^<\/(g|svg)>/.test(tag)) stack.pop(); continue; }
    const t = /transform="([^"]*)"/.exec(tag);
    const m = t ? mul(stack.at(-1), parseTransform(t[1])) : stack.at(-1);
    if (/^<(g|svg)\b/.test(tag) && !tag.endsWith('/>')) { stack.push(m); continue; }
    if (tag.startsWith('<use')) {
      const ref = /xlink:href="#([^"]+)"/.exec(tag)[1];
      const d = defs.get(ref) ?? '';
      // Absolute M/L/C/Q data; every number is a coordinate.
      const points = (d.match(/-?[\d.]+(?:e-?\d+)?/g) ?? []).map(Number);
      // Font units are 1/1000 em; the glyph's em relative to the body's is
      // the matrix's scale (MathJax works in 1000-unit em throughout).
      glyphs.push({ ref, points, scale: Math.hypot(m[0], m[1]) });
    }
  }
  return glyphs;
}

// ── comparison ──────────────────────────────────────────────────────────────

/** Outline deviation after aligning the first points, in glyph units. */
function shapeDelta(a, b) {
  if (a.length !== b.length || !a.length) return Infinity;
  let worst = 0;
  for (let i = 0; i < a.length; i += 2) {
    worst = Math.max(worst, Math.abs((a[i] - a[0]) - (b[i] - b[0])), Math.abs((a[i + 1] - a[1]) - (b[i + 1] - b[1])));
  }
  return worst;
}

async function main() {
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });
  const pages = typeset(OUT);
  const tally = { same: 0, size: 0, DIFFERENT: 0 };
  const problems = [];
  for (let i = 0; i < FORMULAS.length; i++) {
    const [formula, display] = FORMULAS[i];
    const svg = await texFragmentToSvg(formula, display, 'mathjax-newtx');
    writeFileSync(`${OUT}/${String(i).padStart(2, '0')}.svg`, svg);
    const app = appGlyphs(svg);
    const used = new Set();
    const texGlyphs = pages[i];
    for (let t = 0; t < texGlyphs.length;) {
      const tex = texGlyphs[t];
      // A run of up to three glyphs in one font, size and baseline may be one
      // mark the app draws as a single glyph; take the longest run that
      // matches, else the glyph alone.
      let best = null;
      let taken = 1;
      for (let n = 3; n >= 1; n--) {
        const run = texGlyphs.slice(t, t + n);
        if (run.length < n || run.some((g) => g.font !== tex.font || g.size !== tex.size || g.y !== tex.y)) continue;
        const outline = texOutline(run);
        let bestHere = null;
        app.forEach((g, k) => {
          if (used.has(k)) return;
          const delta = shapeDelta(outline, g.points);
          if (!bestHere || delta < bestHere.delta) bestHere = { k, delta, g };
        });
        const tolerance = n > 1 ? COMPOSITE_TOLERANCE : SHAPE_TOLERANCE;
        if (bestHere && bestHere.delta <= tolerance) { best = { ...bestHere, ok: true }; taken = n; break; }
        if (n === 1) best = bestHere;
      }
      const texScale = tex.size / BODY_BP;
      const label = `${tex.font}/${texGlyphs.slice(t, t + taken).map((g) => g.parts.join('+')).join(' ')}@${texScale.toFixed(4)}`;
      t += taken;
      if (!best?.ok) {
        tally.DIFFERENT++;
        problems.push(`DIFFERENT  ${label} in $${formula}$ — closest app glyph ${best ? `${best.g.ref} (Δ ${best.delta.toFixed(1)})` : 'none'}`);
        continue;
      }
      used.add(best.k);
      const ratio = best.g.scale / texScale;
      if (Math.abs(ratio - 1) > SIZE_TOLERANCE) {
        tally.size++;
        problems.push(`size       ${label} drawn at ${best.g.scale.toFixed(4)} (${((ratio - 1) * 100).toFixed(1)}%)`);
      } else {
        tally.same++;
        if (VERBOSE) console.log(`same       ${label}`);
      }
    }
  }
  for (const p of problems) console.log(p);
  const total = tally.same + tally.size + tally.DIFFERENT;
  console.log(`\n${total} glyphs TeX drew: ${tally.same} same, ${tally.size} wrong size, ${tally.DIFFERENT} different glyph.`);
  if (tally.size || tally.DIFFERENT) process.exitCode = 1;
}

main().catch((e) => { console.error(e); process.exit(1); });
