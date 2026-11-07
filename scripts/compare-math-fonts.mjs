/**
 * Measure every registered math font against a real LaTeX render.
 *
 * The question this answers is "which published MathJax font should pair with
 * Libertinus Serif?", and the honest reference is the thing we are trying to
 * look like: acmart — the ACM/SIGGRAPH class — which sets Libertine text
 * against newtxmath. Guessing by family name gets it wrong. Termes is a Times
 * clone and newtxmath is Times-based, yet MathJax's Termes sets italic Greek
 * 25% wider than newtxmath does, which is precisely where an equation stops
 * matching the paper it came from.
 *
 * Widths are compared in EM, which needs no normalisation: a MathJax SVG's
 * viewBox is in 1/1000 em, and a LaTeX page rendered at a known point size
 * converts directly. Nothing here depends on rasterisation or on trimming
 * whitespace, so the numbers are stable.
 *
 *   node scripts/compare-math-fonts.mjs
 *
 * Needs pdflatex with libertine + newtxmath for the reference row; without a
 * TeX installation it falls back to the recorded measurements below and says
 * so. Font packages come from node_modules, so `npm install` is enough.
 */

import { execFileSync } from 'child_process';
import { mkdtempSync, writeFileSync } from 'fs';
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
 * Three probes, chosen because they isolate the places math fonts disagree:
 * italic Greek (the widest spread between faces), lining figures, and the
 * alphabet variants that live in separately loaded glyph ranges.
 */
const PROBES = {
  'greek run': String.raw`\alpha\beta\gamma\delta\varepsilon\vartheta\varphi`,
  digits: String.raw`0123456789`,
  'L/g/R': String.raw`\mathcal{L}\mathfrak{g}\mathbb{R}`,
};

/** Measured from acmart's own font setup; regenerated when pdflatex exists. */
const RECORDED_REFERENCE = { 'greek run': 3.667, digits: 4.633, 'L/g/R': 1.976 };

/** Font ids, kept in step with MATH_FONTS in src/utils/text/fontRegistry.ts. */
const FONTS = [
  'newcm', 'tex', 'modern', 'stix2', 'termes',
  'pagella', 'bonum', 'schola', 'dejavu', 'fira', 'asana',
];

const PT_SIZE = 12;
/** 7200 dpi = 100 px per pt, so one em of a 12pt face is 1200 px. */
const DENSITY = 7200;
const PX_PER_EM = (DENSITY / 72) * PT_SIZE;

/**
 * Typeset the probes with acmart's font setup and read each page's width.
 *
 * `preview` with `tightpage` crops every page to the ink of one formula, so
 * the page width IS the formula width and no trimming heuristic is involved.
 * amssymb is deliberately absent: newtxmath already defines `\Bbbk` and
 * loading both is a fatal redefinition.
 */
function latexReference() {
  const dir = mkdtempSync(join(tmpdir(), 'mathcmp-'));
  const body = Object.values(PROBES).map((tex) => `\\begin{preview}$${tex}$\\end{preview}`).join('\n');
  writeFileSync(join(dir, 'ref.tex'), `\\documentclass[${PT_SIZE}pt]{article}
\\usepackage[T1]{fontenc}
\\usepackage[tt=false]{libertine}
\\usepackage[libertine]{newtxmath}
\\usepackage{amsmath,bm}
\\usepackage[active,tightpage]{preview}
\\setlength\\PreviewBorder{0pt}
\\begin{document}
${body}
\\end{document}
`);
  execFileSync('pdflatex', ['-interaction=nonstopmode', '-halt-on-error', 'ref.tex'], { cwd: dir, stdio: 'ignore' });
  const sizes = execFileSync('magick', ['identify', '-format', '%W\n', '-density', String(DENSITY), 'ref.pdf'], { cwd: dir })
    .toString().trim().split('\n');
  return Object.fromEntries(Object.keys(PROBES).map((name, i) => [name, Number(sizes[i]) / PX_PER_EM]));
}

/** Width of each probe in em, as this font's MathJax package renders it. */
async function measureFont(pkg, adaptor) {
  const mod = await import(`@mathjax/mathjax-${pkg}-font/mjs/svg.js`);
  // Each package exports exactly one class, named MathJax<Name>Font — the
  // same convention loadMathFontData() relies on in the app.
  const fontData = Object.entries(mod).find(([k, v]) => k.startsWith('MathJax') && typeof v === 'function')[1];
  const doc = mathjax.document('', {
    InputJax: new TeX({ packages: ['base', 'ams', 'boldsymbol'] }),
    OutputJax: new SVG({ fontCache: 'local', fontData, linebreaks: { inline: false } }),
  });
  const widths = {};
  for (const [name, tex] of Object.entries(PROBES)) {
    // First pass warms the glyph ranges (a missing one aborts the conversion
    // by throwing a retry signal); the second then completes in one attempt.
    await mathjax.handleRetriesFor(() => doc.convert(tex, { display: false }));
    const html = adaptor.innerHTML(doc.convert(tex, { display: false }));
    widths[name] = Number(html.match(/viewBox="[-\d.]+ [-\d.]+ ([\d.]+) /)[1]) / 1000;
  }
  return widths;
}

async function main() {
  let reference = RECORDED_REFERENCE;
  let live = false;
  try {
    reference = latexReference();
    live = true;
  } catch {
    console.log('pdflatex/magick unavailable — using the recorded acmart reference.\n');
  }

  // Ranges are fetched by module specifier; without this hook every probe
  // using \mathfrak or \mathbb aborts.
  mathjax.asyncLoad = (name) => import(name.replace(/^(@mathjax\/[^/]+)\/js\//, '$1/mjs/'));
  const adaptor = liteAdaptor();
  RegisterHTMLHandler(adaptor);

  const names = Object.keys(PROBES);
  const rows = [];
  for (const pkg of FONTS) {
    const widths = await measureFont(pkg, adaptor);
    const error = names.reduce((sum, n) => sum + Math.abs(widths[n] - reference[n]) / reference[n], 0) / names.length;
    rows.push({ pkg, widths, error: error * 100 });
  }
  rows.sort((a, b) => a.error - b.error);

  const col = (s) => String(s).padStart(10);
  console.log(`widths in em — reference is acmart (libertine + newtxmath)${live ? '' : ', recorded'}\n`);
  console.log('font'.padEnd(10) + names.map(col).join('') + col('mean err'));
  console.log('acmart'.padEnd(10) + names.map((n) => col(reference[n].toFixed(3))).join(''));
  for (const r of rows) {
    console.log(r.pkg.padEnd(10) + names.map((n) => col(r.widths[n].toFixed(3))).join('') + col(`${r.error.toFixed(1)}%`));
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
