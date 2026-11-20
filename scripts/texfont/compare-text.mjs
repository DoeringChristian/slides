/**
 * Pixel comparison of text: pdfLaTeX with acmart's font setup against this
 * app's own glyph layout, in the bundled `LinuxLibertineT` / `LinuxBiolinumT`
 * fonts.
 *
 *   npx tsx --import ./scripts/mathfont/asset-stub.mjs scripts/texfont/compare-text.mjs [--out=dir] [--px=60]
 *
 * Each sample is set by TeX in an \hbox and shipped out as a page exactly the
 * size of the box, so the page origin is the box's top-left and the baseline
 * sits at \ht.
 *
 * The reference is what TeX decided, drawn with TeX's own font data: MuPDF's
 * trace device lists every glyph pdfTeX placed — by glyph NAME, with its
 * origin — and each is drawn from the `.pfb` charstrings by this repo's Type
 * 1 interpreter, which shares no code with opentype.js or the OTF writer. Not
 * a viewer's rendering of the PDF: those load Type 1 through FreeType with
 * hinting, which snaps stems and alignment zones (MuPDF moves the crossbar of
 * "A" from 283 to 283.2 units) — a viewer's choice, not the font.
 *
 * So a differing pixel means the app chose a different glyph, put it
 * somewhere else, or drew a different outline. The app's side lays the same string out with
 * `textToGlyphPaths` — the function every slide's text goes through — onto a
 * page of the same size in the same units, baseline at the same height. Both
 * pages are rasterised by MuPDF at the same pixel size, so a differing pixel
 * is a difference in outline or position, not in anti-aliasing.
 *
 * Needs TeX Live (pdflatex, kpsewhich), `mutool` and ImageMagick.
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as opentypeModule from 'opentype.js';

// CommonJS under plain Node (a default export), ESM under the harness's
// loader (named exports): accept either.
const opentype = opentypeModule.default ?? opentypeModule;
import { textToGlyphPaths } from '../../src/utils/text/glyphPaths.ts';
import { comparePngs } from './pixels.mjs';
import { parseType1 } from '../mathfont/type1.mjs';
import { kpse } from './build.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '../..');
const args = process.argv.slice(2);
const opt = (name, dflt) => (args.find((a) => a.startsWith(`--${name}=`)) ?? `=${dflt}`).split('=')[1];
const OUT = resolve(REPO, opt('out', 'compare-out/text'));
/** Pixels per em of the raster. */
const PX = Number(opt('px', '60'));
/** Font size in TeX points; a large size so a sub-point error shows. */
const PT = 40;
/** One row of MuPDF's 17 x 15 anti-aliasing grid, in grey levels. */
const AA_STEP = Math.ceil(255 / 15);
/**
 * Largest geometric difference accepted, in 1/1000 em: what the coordinates
 * are written to (1/1000 bp at a 40 pt size is 0.025) plus TeX's own rounding
 * of the page (\ht in the log to 1/100000 pt, the PDF to 1/1000 bp).
 */
const GEOMETRY_TOLERANCE = 0.1;
const BP = PT * 72 / 72.27;

const STYLES = {
  rm: { tex: '\\rmfamily\\mdseries\\upshape', file: 'LinuxLibertineT-Regular' },
  it: { tex: '\\rmfamily\\mdseries\\itshape', file: 'LinuxLibertineT-Italic' },
  bf: { tex: '\\rmfamily\\bfseries\\upshape', file: 'LinuxLibertineT-Bold' },
  bi: { tex: '\\rmfamily\\bfseries\\itshape', file: 'LinuxLibertineT-BoldItalic' },
  sf: { tex: '\\sffamily\\mdseries\\upshape', file: 'LinuxBiolinumT-Regular' },
  sfit: { tex: '\\sffamily\\mdseries\\itshape', file: 'LinuxBiolinumT-Italic' },
  sfbf: { tex: '\\sffamily\\bfseries\\upshape', file: 'LinuxBiolinumT-Bold' },
  sfbi: { tex: '\\sffamily\\bfseries\\itshape', file: 'LinuxBiolinumT-BoldItalic' },
};

/** Strings exercising kerning pairs, f-ligatures, digits, accents, quotes. */
const TEXTS = [
  'AVATAR Wave Toy',
  'office affluent fjord shuffle',
  'Typography 0123456789',
  'Neural Radiance Fields',
  'éçàü ÅÆØ ß œ',
  '“Quoted” (paren) [x] {y}',
  'Kerning: LT Yo P. F, r.',
];

/** TeX escapes for the few characters LaTeX treats specially. */
const texEscape = (s) => s.replace(/[{}]/g, (c) => `\\${c}`);

const run = (cmd, argv, opts = {}) => execFileSync(cmd, argv, { encoding: 'utf8', ...opts });

function typeset(dir, samples) {
  const pages = samples.map(({ style, text }) => String.raw`\sbox0{\fontsize{${PT}}{${PT}}\selectfont${STYLES[style].tex} ${texEscape(text)}}%
\typeout{BOX \the\wd0\space\the\ht0\space\the\dp0}%
\pdfpagewidth=\wd0 \pdfpageheight=\dimexpr\ht0+\dp0\relax
\shipout\box0`).join('\n');
  // acmart's pdfLaTeX font setup, verbatim (acmart.cls, `\if@ACM@newfonts`).
  writeFileSync(`${dir}/ref.tex`, String.raw`\documentclass{article}
\usepackage[utf8]{inputenc}
\usepackage[T1]{fontenc}
\usepackage[tt=false, type1=true]{libertine}
\usepackage[varqu]{zi4}
\usepackage[libertine]{newtxmath}
\hoffset=-1in \voffset=-1in \parindent=0pt
% Sentence spacing is paragraph layout, not the font: off, so ". " is one space.
\frenchspacing
\begin{document}
${pages}
\end{document}
`);
  run('pdflatex', ['-interaction=nonstopmode', '-halt-on-error', 'ref.tex'], { cwd: dir, stdio: ['ignore', 'pipe', 'pipe'] });
  const log = readFileSync(`${dir}/ref.log`, 'latin1');
  return [...log.matchAll(/^BOX ([\d.]+)pt\s*([\d.]+)pt\s*([\d.]+)pt/gm)]
    .map((m) => m.slice(1, 4).map((v) => Number(v) * 72 / 72.27));
}

const fonts = new Map();
function font(file) {
  if (!fonts.has(file)) {
    const b = readFileSync(`${REPO}/src/assets/fonts/${file}.otf`);
    fonts.set(file, opentype.parse(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)));
  }
  return fonts.get(file);
}

function appSvg({ style, text }, [w, h, d]) {
  const { glyphs, endX } = textToGlyphPaths(text, font(STYLES[style].file), BP, 0, h);
  const paths = glyphs.filter((g) => g.d)
    .map((g) => `<path transform="translate(${g.x} ${g.y})" d="${g.d}"/>`).join('');
  return {
    svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h + d}" viewBox="0 0 ${w} ${h + d}">`
      + `<rect width="100%" height="100%" fill="white"/>${paths}</svg>`,
    endX,
  };
}

/** Every glyph pdfTeX placed, per page: `{ font, glyph, x, y }` in bp, y up. */
function traceGlyphs(pdf) {
  const xml = run('mutool', ['draw', '-q', '-F', 'trace', '-o', '-', pdf], { maxBuffer: 1 << 28 });
  return xml.split('<page ').slice(1).map((page) => {
    const glyphs = [];
    const height = Number(/mediabox="[\d.-]+ [\d.-]+ [\d.-]+ ([\d.-]+)"/.exec(page)[1]);
    for (const span of page.split('<span ').slice(1)) {
      const fontName = /font="(?:[A-Z]{6}\+)?([^"]+)"/.exec(span)[1];
      const size = Number(/trm="([\d.]+)/.exec(span)[1]);
      for (const g of span.matchAll(/<g [^>]*glyph="([^"]+)" x="([\d.-]+)" y="([\d.-]+)"/g)) {
        glyphs.push({ font: fontName, size, glyph: g[1], x: Number(g[2]), y: Number(g[3]) });
      }
    }
    return { height, glyphs };
  });
}

const type1Fonts = new Map();
function type1(name) {
  if (!type1Fonts.has(name)) type1Fonts.set(name, parseType1(readFileSync(kpse(`${name}.pfb`))));
  return type1Fonts.get(name);
}

/** 1/1000 bp, the precision `textToGlyphPaths` writes. */
const n3 = (v) => (Math.round(v * 1000) / 1000).toString();

/** TeX's glyphs at TeX's positions, outlines from the `.pfb`, in bp. */
function referenceSvg(page, [w, h, d]) {
  const paths = page.glyphs.map((g) => {
    const outline = type1(g.font).glyphs.get(g.glyph);
    if (!outline) throw new Error(`${g.font} has no glyph ${g.glyph}`);
    const s = g.size / 1000;
    // Origin: PDF user space is y-up from the page bottom; the page is the
    // box, so the baseline is `height - y` from the top.
    const ox = g.x, oy = page.height - g.y;
    // Glyph-local coordinates under a translate — the shape the app emits —
    // because a rasteriser flattens a curve according to the numbers it is
    // given: the same outline written in absolute page coordinates comes out
    // a subsample different along some diagonals.
    let dpath = '';
    for (const c of outline.path) {
      if (c.op === 'Z') { dpath += 'Z'; continue; }
      const pts = [];
      for (let k = 0; k < c.args.length; k += 2) pts.push(`${n3(c.args[k] * s)} ${n3(-c.args[k + 1] * s)}`);
      dpath += c.op + pts.join(' ');
    }
    return `<path transform="translate(${ox} ${oy})" d="${dpath}"/>`;
  }).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h + d}" viewBox="0 0 ${w} ${h + d}">`
    + `<rect width="100%" height="100%" fill="white"/>${paths}</svg>`;
}

const glyphsOf = (svg) => [...svg.matchAll(/<path transform="translate\(([^ ]+) ([^)]+)\)" d="([^"]+)"/g)]
  .map((m) => ({ x: Number(m[1]), y: Number(m[2]), points: m[3].match(/-?[\d.]+(?:e-?\d+)?/g).map(Number) }));

/**
 * The geometric comparison, in 1/1000 em: the same number of glyphs, each at
 * the same origin, each with the same outline points. This is the verdict;
 * the rasters show it.
 */
function geometry(appSvg, refSvg) {
  const a = glyphsOf(appSvg), r = glyphsOf(refSvg);
  const em = (v) => v / BP * 1000;
  if (a.length !== r.length) return { ok: false, why: `${a.length} glyphs, TeX set ${r.length}` };
  let origin = 0, outline = 0;
  for (let i = 0; i < a.length; i++) {
    origin = Math.max(origin, Math.abs(em(a[i].x - r[i].x)), Math.abs(em(a[i].y - r[i].y)));
    if (a[i].points.length !== r[i].points.length) return { ok: false, why: `glyph ${i} has a different outline` };
    a[i].points.forEach((v, k) => { outline = Math.max(outline, Math.abs(em(v - r[i].points[k]))); });
  }
  return { ok: origin <= GEOMETRY_TOLERANCE && outline <= GEOMETRY_TOLERANCE, origin, outline };
}

function main() {
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });
  const samples = Object.keys(STYLES).flatMap((style) => TEXTS.map((text) => ({ style, text })));
  const boxes = typeset(OUT, samples);
  if (boxes.length !== samples.length) throw new Error(`TeX shipped ${boxes.length} pages for ${samples.length} samples`);
  const traced = traceGlyphs(`${OUT}/ref.pdf`);

  const rows = [];
  samples.forEach((sample, i) => {
    const box = boxes[i];
    const { svg, endX } = appSvg(sample, box);
    const tag = `${String(i).padStart(2, '0')}-${sample.style}`;
    writeFileSync(`${OUT}/${tag}.svg`, svg);
    const refSvg = referenceSvg(traced[i], box);
    writeFileSync(`${OUT}/tex-${i + 1}.svg`, refSvg);
    const geo = geometry(svg, refSvg);
    // One resolution for both, and the box's top-left at the origin of both.
    const dpi = String(PX * 72 / BP);
    run('mutool', ['draw', '-q', '-r', dpi, '-c', 'gray', '-o', `${OUT}/${tag}-tex.pgm`, `${OUT}/tex-${i + 1}.svg`]);
    run('mutool', ['draw', '-q', '-r', dpi, '-c', 'gray', '-o', `${OUT}/${tag}-app.pgm`, `${OUT}/${tag}.svg`]);
    const cmp = comparePngs(`${OUT}/${tag}-tex.pgm`, `${OUT}/${tag}-app.pgm`, `${OUT}/${tag}-diff.png`);
    const advanceErr = (endX - box[0]) / BP * 1000; // in 1/1000 em
    rows.push({
      sample: `${sample.style.padEnd(5)} ${sample.text}`,
      geometry: geo.ok ? 'same' : (geo.why ?? 'DIFFERENT'),
      'origin Δ': geo.origin === undefined ? '' : +geo.origin.toFixed(3),
      'outline Δ': geo.outline === undefined ? '' : +geo.outline.toFixed(3),
      'advance Δ': +advanceErr.toFixed(3),
      px: `${cmp.width}x${cmp.height}`,
      'pixels ≠': cmp.differing,
      'max ≠': cmp.maxDelta,
    });
  });
  console.table(rows);
  // Geometry decides. The rasters are evidence: MuPDF anti-aliases on a
  // 17 x 15 sample grid per pixel, so geometry 0.002 px apart can flip one
  // sample (17 grey levels) at an edge, more often the larger the raster.
  const bad = rows.filter((r) => r.geometry !== 'same');
  const worstDelta = Math.max(...rows.map((r) => r['max ≠']));
  if (!bad.length) {
    console.log(`MATCH: every glyph is TeX's, at TeX's position, with TeX's outline, to ${GEOMETRY_TOLERANCE}/1000 em. `
      + `Rasters: largest pixel difference ${worstDelta}/255 (one anti-aliasing sample is ${AA_STEP}).`);
  } else {
    console.log(`MISMATCH in ${bad.length} sample(s): ${bad.map((r) => r.sample.trim()).join('; ')}`);
    process.exitCode = 1;
  }
  console.log(`Images: ${OUT}`);
}

main();
