/**
 * Render one formula twice — once by LaTeX with acmart's real preamble, once
 * by this app's own math renderer — at the same scale, cropped and padded to a
 * common canvas so the two PNGs can be subtracted in image space.
 *
 *   npx tsx scripts/mathfont/compare-render.mjs ["<formula>"] [--em=200] [--out=dir]
 *
 * Both sides are tight-cropped to their ink and anchored at the top-left of
 * that crop, which is the only alignment that does not require trusting either
 * side's idea of the baseline. The reported ink sizes are the measurement:
 * matching dimensions mean the two agree on glyph size and advance, and the
 * diff image then shows where the outlines themselves differ.
 *
 * Needs a TeX installation, `mutool`, `rsvg-convert` and ImageMagick. It is a
 * comparison harness, not part of the build — `build:mathfont` generates the
 * font and this checks it.
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { texFragmentToSvg } from '../../src/services/latexToSvg.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '../..');

const args = process.argv.slice(2);
const formula = args.find((a) => !a.startsWith('--'))
  ?? '\\int_\\Omega f(x)\\,dx = \\sum_{i=1}^{n} w_i f(x_i)';
const pxPerEm = Number((args.find((a) => a.startsWith('--em=')) || '--em=200').slice(5));
const outDir = resolve(REPO, (args.find((a) => a.startsWith('--out=')) || '--out=compare-out').slice(6));

/** TeX's point is 1/72.27 in, the PDF's is 1/72, so an em at 12pt is this. */
const BODY_PT = 12;
const EM_IN_BP = BODY_PT * 72 / 72.27;
const DPI = pxPerEm * 72 / EM_IN_BP;

const run = (cmd, argv, opts = {}) => execFileSync(cmd, argv, { encoding: 'utf8', ...opts });

function renderLatex(dir) {
  // A tight box, shipped out with the page origin ON the box's top-left, so
  // the PDF's page IS the formula with no margin to guess at.
  const doc = String.raw`\documentclass[${BODY_PT}pt]{article}
\usepackage[T1]{fontenc}
\usepackage[tt=false]{libertine}
\usepackage[libertine]{newtxmath}
\usepackage{amsmath}
\pagestyle{empty}
\begin{document}
\sbox0{$\displaystyle ${formula}$}%
\pdfpagewidth=\wd0
\pdfpageheight=\dimexpr\ht0+\dp0\relax
\hoffset=-1in \voffset=-1in
\shipout\box0
\end{document}
`;
  writeFileSync(`${dir}/ref.tex`, doc);
  run('pdflatex', ['-interaction=nonstopmode', '-halt-on-error', '-no-shell-escape', 'ref.tex'],
    { cwd: dir, stdio: ['ignore', 'pipe', 'pipe'] });
  run('mutool', ['draw', '-r', String(DPI), '-o', `${dir}/latex-raw.png`, `${dir}/ref.pdf`, '1']);
  return `${dir}/latex-raw.png`;
}

async function renderSlides(dir) {
  const svg = await texFragmentToSvg(formula, true, 'mathjax-newtx');
  // MathJax's viewBox is in units of 1/1000 em, which is what sets the scale.
  const vb = /viewBox="([-\d.]+) ([-\d.]+) ([-\d.]+) ([-\d.]+)"/.exec(svg);
  if (!vb) throw new Error('no viewBox in the rendered SVG');
  const [, , , w, h] = vb.map(Number);
  const widthPx = (w / 1000) * pxPerEm;
  const heightPx = (h / 1000) * pxPerEm;
  const sized = svg
    .replace(/\swidth="[^"]*"/, ` width="${widthPx.toFixed(2)}"`)
    .replace(/\sheight="[^"]*"/, ` height="${heightPx.toFixed(2)}"`);
  const file = `${dir}/slides.svg`;
  writeFileSync(file, sized.startsWith('<?xml') ? sized
    : `<?xml version="1.0" encoding="UTF-8"?>\n${sized}`);
  run('rsvg-convert', ['-b', 'white', '-o', `${dir}/slides-raw.png`, file]);
  return { png: `${dir}/slides-raw.png`, widthPx, heightPx };
}

const size = (png) => {
  const [w, h] = run('magick', ['identify', '-format', '%w %h', png]).trim().split(' ').map(Number);
  return { w, h };
};

async function main() {
  mkdirSync(outDir, { recursive: true });
  const work = `${outDir}/.work`;
  rmSync(work, { recursive: true, force: true });
  mkdirSync(work, { recursive: true });

  console.log(`formula : $${formula}$`);
  console.log(`scale   : ${pxPerEm} px/em  (LaTeX at ${DPI.toFixed(1)} dpi, ${BODY_PT}pt body)\n`);

  const latexPng = renderLatex(work);
  const slides = await renderSlides(work);

  // Flatten onto white and crop each to its own ink.
  const trimmed = {};
  for (const [side, src] of [['latex', latexPng], ['slides', slides.png]]) {
    const out = `${work}/${side}-trim.png`;
    run('magick', [src, '-background', 'white', '-alpha', 'remove', '-alpha', 'off',
      '-fuzz', '1%', '-trim', '+repage', out]);
    trimmed[side] = { png: out, ...size(out) };
    console.log(`${side.padEnd(7)} ink ${trimmed[side].w}x${trimmed[side].h} px`
      + `  = ${(trimmed[side].w / pxPerEm).toFixed(3)} x ${(trimmed[side].h / pxPerEm).toFixed(3)} em`);
  }

  const W = Math.max(trimmed.latex.w, trimmed.slides.w);
  const H = Math.max(trimmed.latex.h, trimmed.slides.h);
  const dw = trimmed.slides.w - trimmed.latex.w;
  const dh = trimmed.slides.h - trimmed.latex.h;
  console.log(`\ndifference: width ${dw > 0 ? '+' : ''}${dw}px `
    + `(${((dw / trimmed.latex.w) * 100).toFixed(2)}%), `
    + `height ${dh > 0 ? '+' : ''}${dh}px (${((dh / trimmed.latex.h) * 100).toFixed(2)}%)`);

  // Pad both to one canvas, ink anchored top-left, so a diff needs no resize.
  const finals = {};
  for (const side of ['latex', 'slides']) {
    const out = `${outDir}/${side}.png`;
    run('magick', [trimmed[side].png, '-background', 'white', '-gravity', 'NorthWest',
      '-extent', `${W}x${H}`, out]);
    finals[side] = out;
  }
  // A convenience diff; the two PNGs above are the deliverable.
  run('magick', ['composite', finals.latex, finals.slides, '-compose', 'difference',
    `${outDir}/diff.png`]);
  run('magick', [`${outDir}/diff.png`, '-auto-level', `${outDir}/diff-amplified.png`]);

  // `%[distortion]` with AE is already the FRACTION of pixels that differ,
  // not a count — dividing by the pixel total again reports a fake 0.00%.
  const fraction = Number(run('magick', [finals.latex, finals.slides, '-metric', 'AE', '-compare',
    '-format', '%[distortion]', 'info:']).trim());
  console.log(`\ncanvas  : ${W}x${H} px, ink anchored top-left in both`);
  console.log(`pixels differing: ${(fraction * 100).toFixed(2)}% of ${W * H}`);
  console.log(`\nwrote:\n  ${finals.latex}\n  ${finals.slides}\n  ${outDir}/diff.png\n  ${outDir}/diff-amplified.png`);
}

main().catch((e) => { console.error(String(e.message || e)); process.exit(1); });
