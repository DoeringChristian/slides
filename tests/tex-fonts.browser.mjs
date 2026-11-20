// The bundled text faces in a real browser, the generated acmart ones first.
//
// They are written by opentype.js plus a hand-built `kern` table
// (scripts/texfont), not by a font editor, so two things need a browser to
// prove: that Chrome's font sanitiser accepts every file at all — a rejected
// font loads as nothing and the edit overlay silently falls back — and that
// Chrome shapes them as the SVG renderer does (TeX's kerning and
// f-ligatures), so the edit overlay and the drawn text agree. Every other
// bundled face is measured too: the overlay kerns a face exactly when the
// registry says the renderer does, and the widths must agree either way.
import { isolatedBrowser } from './isolated-browser.mjs';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const evidence = process.env.BROWSER_GATE_EVIDENCE ?? '/tmp/tex-fonts-browser';
const browser = await isolatedBrowser(evidence);
try {
  await browser.navigate('/tests/canvas-fixture.html');
  const result = await browser.evaluate(`(async () => {
    const { TEXT_FONTS } = await import('/src/utils/text/fontRegistry.ts');
    const { loadFont, textToGlyphPaths } = await import('/src/utils/text/glyphPaths.ts');
    const faces = TEXT_FONTS;
    const rows = [];
    // Control: a font file from a font editor, loaded the same way. If this
    // fails too, the fault is the harness, not the generated fonts.
    const control = TEXT_FONTS.find((f) => f.id === 'Libertinus Serif');
    let controlLoaded = true, controlError = '';
    try { await new FontFace('probe-control', 'url(' + control.variants.regular + ')').load(); } catch (e) { controlLoaded = false; controlError = String(e); }
    const SAMPLE = 'AVATAR Wave Toy office affluent 0123';
    for (const font of faces) {
      for (const [variant, weight, style] of [['regular', 'normal', 'normal'], ['bold', 'bold', 'normal'], ['italic', 'normal', 'italic'], ['boldItalic', 'bold', 'italic']]) {
        const family = 'probe-' + font.id.replace(/ /g, '') + '-' + variant;
        const face = new FontFace(family, 'url(' + font.variants[variant] + ')');
        let loaded = true, error = '';
        try { await face.load(); document.fonts.add(face); } catch (e) { loaded = false; error = String(e); }
        const ctx = document.createElement('canvas').getContext('2d');
        ctx.font = '40px "' + family + '"';
        ctx.fontKerning = 'normal';
        const canvasWidth = loaded ? ctx.measureText(SAMPLE).width : NaN;
        // The edit overlay is DOM text, so measure that too.
        const span = document.createElement('span');
        span.style.cssText = 'position:absolute;white-space:pre;font-size:40px;font-kerning:normal;font-family:"' + family + '"';
        span.textContent = SAMPLE;
        document.body.appendChild(span);
        const browserWidth = loaded ? span.getBoundingClientRect().width : NaN;
        span.style.fontKerning = 'none';
        const unkernedBrowserWidth = loaded ? span.getBoundingClientRect().width : NaN;
        span.remove();
        const parsed = await loadFont(font.id, weight, style);
        const appWidth = textToGlyphPaths(SAMPLE, parsed, 40, 0, 0).endX;
        // Unkerned, unligated width: what a browser that ignored the tables
        // would measure — to show the tables are what makes the two agree.
        let plain = 0;
        for (const ch of SAMPLE) plain += parsed.charToGlyph(ch).advanceWidth * 40 / parsed.unitsPerEm;
        rows.push({ font: font.id, kerning: font.kerning, variant, loaded, error, browserWidth, unkernedBrowserWidth, canvasWidth, appWidth, plainWidth: plain });
      }
    }
    return { controlLoaded, controlError, rows };
  })()`);
  await writeFile(join(evidence, 'results.json'), JSON.stringify(result, null, 2));
  if (!result.controlLoaded) throw Error(`control font (Libertinus) did not load either: ${result.controlError}`);
  if (result.rows.length !== 16) throw Error(`expected 16 faces, got ${result.rows.length}`);
  for (const row of result.rows) {
    if (!row.loaded) throw Error(`${row.font} ${row.variant}: Chrome rejected the font: ${row.error}`);
    // The overlay kerns exactly when the registry says the renderer does;
    // either way the browser's width must be the renderer's.
    const overlay = row.kerning ? row.browserWidth : row.unkernedBrowserWidth;
    if (Math.abs(overlay - row.appWidth) > 0.05) {
      throw Error(`${row.font} ${row.variant}: the edit overlay sets ${overlay.toFixed(3)}px, the renderer ${row.appWidth.toFixed(3)}px`);
    }
    if (row.font.endsWith(' T') && Math.abs(row.plainWidth - row.appWidth) < 0.5) throw Error(`${row.font} ${row.variant}: kerning made no difference — is GPOS read?`);
  }
  console.log('PASS text fonts: all load in Chrome, and the edit overlay sets every face as the renderer does', result.rows.map((r) => (r.browserWidth - r.appWidth).toFixed(3)).join(' '));
} catch (error) {
  await writeFile(join(evidence, 'failure.txt'), error.stack ?? String(error));
  throw error;
} finally { await browser.close(); }
