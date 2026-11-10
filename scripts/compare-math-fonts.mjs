/**
 * Measure every registered math font against a real LaTeX render — by ink.
 *
 * The question this answers is "which published MathJax font should pair with
 * Libertinus Serif?", and the honest reference is the thing we are trying to
 * look like: acmart — the ACM/SIGGRAPH class — which sets Libertine text
 * against newtxmath.
 *
 * This script used to compare ADVANCE WIDTHS, and that was the wrong
 * measurement. Widths across these faces agree to within a few percent while
 * their outlines share barely half their ink, so the table ranked by a
 * quantity nobody looks at and picked a font that visibly did not match. It
 * now rasterises both sides at the same px-per-em, crops each formula to its
 * ink, and reports the fraction of ink that coincides at the best alignment —
 * searching the translation out so that a height mismatch is not charged
 * twice, once as itself and again as every glyph sliding off its counterpart.
 *
 * Two caveats worth knowing when reading the output:
 *
 *  - The two sides go through different rasterisers (ghostscript for the PDF,
 *    rsvg for our SVG), which costs every candidate the same few points at
 *    glyph edges. Fine for ranking, which is all this is for; it means the
 *    absolute numbers are a floor, not a verdict.
 *  - No package scores well, and none can. acmart draws only its digits and
 *    upright roman from Libertine; its math italic, Greek, operators and
 *    delimiters are newtx's own txfonts-derived Type 1 outlines, which exist
 *    in no OTF and therefore in no MathJax font. Matching the paper exactly
 *    means changing the paper (`\usepackage{unicode-math}` +
 *    `\setmathfont{Libertinus Math}`), not the deck.
 *
 *   node scripts/compare-math-fonts.mjs
 *
 * Needs pdflatex with libertine + newtxmath, plus ImageMagick and
 * rsvg-convert. Font packages come from node_modules, so `npm install` is
 * enough for the candidate side.
 */

import { execFileSync } from 'child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { mathjax } from '@mathjax/src/mjs/mathjax.js';
import { TeX } from '@mathjax/src/mjs/input/tex.js';
import { SVG } from '@mathjax/src/mjs/output/svg.js';
import { liteAdaptor } from '@mathjax/src/mjs/adaptors/liteAdaptor.js';
import { RegisterHTMLHandler } from '@mathjax/src/mjs/handlers/html.js';
import '@mathjax/src/mjs/input/tex/base/BaseConfiguration.js';
import '@mathjax/src/mjs/input/tex/ams/AmsConfiguration.js';
import '@mathjax/src/mjs/input/tex/boldsymbol/BoldsymbolConfiguration.js';

/**
 * One probe per glyph class, weighted by how much of a real equation it
 * occupies. Math italic carries the most weight because variables are what an
 * equation is mostly made of, and it is the first thing the eye reads.
 */
const PROBES = {
  'math italic': { tex: String.raw`EnergyRxyQ`, weight: 0.30 },
  'digits': { tex: String.raw`0123456789`, weight: 0.15 },
  'operators': { tex: String.raw`+-=<>\times\div\pm`, weight: 0.15 },
  'greek lower': { tex: String.raw`\alpha\beta\gamma\delta`, weight: 0.15 },
  'delimiters': { tex: String.raw`\left(\frac{a}{b}\right)`, weight: 0.10 },
  'upright latin': { tex: String.raw`\mathrm{EnergyRxyQ}`, weight: 0.05 },
  'greek upper': { tex: String.raw`\Gamma\Delta\Theta\Omega`, weight: 0.05 },
  'big ops': { tex: String.raw`\int\sum\prod`, weight: 0.05 },
};
const NAMES = Object.keys(PROBES);

/** Font ids, kept in step with MATH_FONTS in src/utils/text/fontRegistry.ts. */
const FONTS = [
  'newcm', 'tex', 'modern', 'stix2', 'termes',
  'pagella', 'bonum', 'schola', 'dejavu', 'fira', 'asana',
];

const PT_SIZE = 12;
const PX_PER_EM = 400;
const DENSITY = (PX_PER_EM * 72) / PT_SIZE;
/** Compared at a quarter scale: plenty of detail, and the search stays quick. */
const COMPARE_SCALE = 25;
/** Translations searched, in compare-scale pixels — 0.3em each way. */
const SEARCH = 30;

const magick = (args) => execFileSync('magick', args, { encoding: 'utf8' }).trim();
const dims = (path) => {
  const [w, h] = magick(['identify', '-format', '%w %h', path]).split(' ').map(Number);
  return { w, h };
};

/** Ink-cropped PNG as a binary bitmap: 1 where there is ink. */
function bitmap(path) {
  const pgm = execFileSync('magick', [path, '-resize', `${COMPARE_SCALE}%`, '-colorspace', 'Gray',
    '-threshold', '50%', '-compress', 'none', 'pgm:-'], { maxBuffer: 1 << 28 }).toString('latin1');
  const fields = pgm.split(/\s+/).filter((s) => s.length && !s.startsWith('#'));
  const w = Number(fields[1]);
  const h = Number(fields[2]);
  const data = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) data[i] = fields[4 + i] === '0' ? 1 : 0;
  return { w, h, data };
}

/** Best intersection-over-union of two bitmaps over integer translations. */
function bestIoU(a, b) {
  let best = 0;
  const inkA = a.data.reduce((sum, v) => sum + v, 0);
  const inkB = b.data.reduce((sum, v) => sum + v, 0);
  for (let dy = -SEARCH; dy <= SEARCH; dy++) {
    for (let dx = -SEARCH; dx <= SEARCH; dx++) {
      let inter = 0;
      for (let y = 0; y < b.h; y++) {
        const ay = y + dy;
        if (ay < 0 || ay >= a.h) continue;
        const bRow = y * b.w;
        const aRow = ay * a.w;
        for (let x = 0; x < b.w; x++) {
          if (!b.data[bRow + x]) continue;
          const ax = x + dx;
          if (ax < 0 || ax >= a.w) continue;
          inter += a.data[aRow + ax];
        }
      }
      const iou = inter / (inkA + inkB - inter);
      if (iou > best) best = iou;
    }
  }
  return best;
}

/**
 * Typeset the probes with acmart's font setup, one ink-cropped page each.
 *
 * `preview` with `tightpage` crops every page to the ink of one formula, so no
 * trimming heuristic decides where a formula begins. amssymb is deliberately
 * absent: newtxmath already defines `\Bbbk` and loading both is fatal.
 */
function latexReference(dir) {
  writeFileSync(join(dir, 'ref.tex'), `\\documentclass[${PT_SIZE}pt]{article}
\\usepackage[T1]{fontenc}
\\usepackage[tt=false]{libertine}
\\usepackage[libertine]{newtxmath}
\\usepackage{amsmath,bm}
\\usepackage[active,tightpage]{preview}
\\setlength\\PreviewBorder{0pt}
\\begin{document}
${NAMES.map((n) => `\\begin{preview}$${PROBES[n].tex}$\\end{preview}`).join('\n')}
\\end{document}
`);
  execFileSync('pdflatex', ['-interaction=nonstopmode', '-halt-on-error', 'ref.tex'],
    { cwd: dir, stdio: 'ignore' });
  return NAMES.map((_, i) => {
    const png = join(dir, `ref-${i}.png`);
    magick(['-density', String(DENSITY), `${join(dir, 'ref.pdf')}[${i}]`,
      '-background', 'white', '-alpha', 'remove', '-colorspace', 'Gray', '-trim', '+repage', png]);
    return { path: png, ...dims(png) };
  });
}

/** Render every probe with one MathJax font package, ink-cropped to match. */
async function renderFont(pkg, dir) {
  const mod = await import(`@mathjax/mathjax-${pkg}-font/mjs/svg.js`);
  // Each package exports exactly one class, named MathJax<Name>Font — the same
  // convention loadMathFontData() relies on in the app.
  const fontData = Object.entries(mod)
    .find(([key, value]) => key.startsWith('MathJax') && typeof value === 'function')[1];
  const doc = mathjax.document('', {
    InputJax: new TeX({ packages: ['base', 'ams', 'boldsymbol'] }),
    OutputJax: new SVG({ fontCache: 'local', fontData, linebreaks: { inline: false } }),
  });
  const out = [];
  for (const [i, name] of NAMES.entries()) {
    // First pass warms the glyph ranges (a missing one aborts the conversion by
    // throwing a retry signal); the second then completes in one attempt.
    await mathjax.handleRetriesFor(() => doc.convert(PROBES[name].tex, { display: false }));
    let svg = adaptor.innerHTML(doc.convert(PROBES[name].tex, { display: false }))
      // The same strip latexToSvg applies: liteAdaptor writes `data-latex`
      // unescaped, so a probe containing `<` is not well-formed XML.
      .replace(/ data-[\w-]+="[^"]*"/g, '');
    // Size from the viewBox, which is in MathJax's own unit of 1/1000 em; the
    // width/height attributes are in `ex` and would need font metrics.
    const vb = svg.match(/viewBox="([-\d.]+) ([-\d.]+) ([\d.]+) ([\d.]+)"/);
    svg = svg
      .replace(/width="[^"]*"/, `width="${((Number(vb[3]) / 1000) * PX_PER_EM).toFixed(2)}"`)
      .replace(/height="[^"]*"/, `height="${((Number(vb[4]) / 1000) * PX_PER_EM).toFixed(2)}"`);
    const svgPath = join(dir, `${pkg}-${i}.svg`);
    const rawPng = join(dir, `${pkg}-${i}.raw.png`);
    const png = join(dir, `${pkg}-${i}.png`);
    writeFileSync(svgPath, svg);
    execFileSync('rsvg-convert', ['-o', rawPng, svgPath]);
    magick([rawPng, '-background', 'white', '-alpha', 'remove', '-colorspace', 'Gray',
      '-trim', '+repage', png]);
    out.push({ path: png, ...dims(png) });
  }
  return { probes: out, xHeight: doc.outputJax.font.params.x_height };
}

const adaptor = liteAdaptor();

async function main() {
  const dir = mkdtempSync(join(tmpdir(), 'mathcmp-'));
  mkdirSync(dir, { recursive: true });
  let reference;
  try {
    reference = latexReference(dir);
  } catch {
    console.error('Needs pdflatex (with libertine + newtxmath) and ImageMagick to build the '
      + 'acmart reference. Nothing to compare against — stopping.');
    process.exit(1);
  }

  // Ranges are fetched by module specifier; without this hook every probe
  // using \mathfrak or \mathbb aborts.
  mathjax.asyncLoad = (name) => import(name.replace(/^(@mathjax\/[^/]+)\/js\//, '$1/mjs/'));
  RegisterHTMLHandler(adaptor);

  const refBitmaps = reference.map((r) => bitmap(r.path));
  const rows = [];
  for (const pkg of FONTS) {
    const { probes, xHeight } = await renderFont(pkg, dir);
    const per = probes.map((p, i) => bestIoU(refBitmaps[i], bitmap(p.path)));
    const score = NAMES.reduce((sum, name, i) => sum + per[i] * PROBES[name].weight, 0);
    rows.push({ pkg, per, score, xHeight });
  }
  rows.sort((a, b) => b.score - a.score);

  const col = (s) => String(s).padStart(8);
  console.log('ink shared with acmart (libertine + newtxmath), per glyph class,');
  console.log('at the best alignment. Higher is closer.\n');
  console.log('font'.padEnd(9) + NAMES.map((n) => col(n.slice(0, 7))).join('') + col('SCORE'));
  for (const r of rows) {
    console.log(r.pkg.padEnd(9)
      + r.per.map((v) => col(`${(v * 100).toFixed(0)}%`)).join('')
      + col(`${(r.score * 100).toFixed(1)}%`));
  }

  // The other half of looking right, and the one that is actually fixable: a
  // math font whose x-height disagrees with the text font's looks wrong at any
  // typeface similarity. textLayout scales math by the ratio, so this column
  // says how much rescaling each pairing asks for, not how wrong it will look.
  console.log('\nx-height in em (textLayout scales math to the text font\'s):');
  for (const r of rows) console.log(`   ${r.pkg.padEnd(9)} ${r.xHeight.toFixed(3)}`);
  console.log('\n   Libertinus Serif 0.429   Inter 0.546   (from the bundled OTF/TTF metrics)');
}

main().catch((err) => { console.error(err); process.exit(1); });
