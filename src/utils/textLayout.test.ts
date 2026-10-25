import { readFileSync } from 'node:fs';
import { parse } from 'opentype.js';
import { loadFont, textToGlyphPaths } from './glyphPaths';
import { describe, expect, it, vi } from 'vitest';
import { layoutSvgText, textRowMetrics } from './textLayout';
import { createShapeElement, createTextElement } from './slideFactory';
import { createBoundLabel, fitLabelToDoc } from './syncDependents';

vi.mock('./glyphPaths', async importOriginal => {
  const actual = await importOriginal<typeof import('./glyphPaths')>();
  const bytes = readFileSync(new URL('../assets/fonts/Inter-Regular.ttf', import.meta.url));
  const font = parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  return { ...actual, loadFont: async () => font };
});
const style = { ...createTextElement().style, fontSize: 24, align: 'left' as const, lineHeight: 1.2 };
const baselines = (doc: Awaited<ReturnType<typeof layoutSvgText>>) => [...new Set(doc.paths.map(p => p.transform.split(',')[1]))];

describe('shared native/SVG text rows', () => {
  it('uses the SVG baseline/advance, including heading-sized and empty struts', async () => {
    expect(textRowMetrics(24, 1.2).baseline).toBeCloseTo(19.2);
    expect(textRowMetrics(24, 1.2).advance).toBeCloseTo(30.72);
    expect(textRowMetrics(48, 1.2).advance).toBeCloseTo(61.44);
    const doc = await layoutSvgText('one\n\ntail', style, 100);
    for (const line of doc.lines) expect(line.yBottom - line.yTop).toBeCloseTo(30.72);
    expect(doc.height).toBeCloseTo(92.16);
  });
  it('wraps ordinary words and overlong tokens with the same row advance', async () => {
    for (const text of ['one two three four five', 'WWWWWWWWWWWW']) {
      const doc = await layoutSvgText(text, style, 100, new Set([0]));
      expect(baselines(doc)).toHaveLength(3);
      expect(doc.height).toBeCloseTo(92.16);
      expect(doc.lines).toHaveLength(1);
      expect(doc.lines[0].source).toBe(text);
    }
  });
  it('retains leading spaces and hangs trailing spaces for center alignment', async () => {
    const left = await layoutSvgText('  one', style, 100);
    expect(left.paths[2].transform).toMatch(/^translate\(13.50,/);
    const centered = { ...style, align: 'center' as const };
    const a = await layoutSvgText('one two', centered, 100);
    const b = await layoutSvgText('one two three', centered, 100);
    expect(b.paths.slice(0, 7).map(p => p.transform)).toEqual(a.paths.map(p => p.transform));
  });
  for (const align of ['left', 'center', 'right'] as const) it(`retains final spaces for ${align}, including before a source newline`, async () => {
    const plain = await layoutSvgText('one', { ...style, align }, 100);
    const spaced = await layoutSvgText('one  \ntail', { ...style, align }, 100);
    const x = (transform: string) => Number(transform.match(/translate\(([-\d.]+)/)![1]);
    expect(x(plain.paths[0].transform) - x(spaced.paths[0].transform)).toBeCloseTo(align === 'center' ? 6.75 : align === 'right' ? 13.5 : 0);
    expect(spaced.lines[0].source).toBe('one  ');
  });
  for (const space of ['\u2000', '\u2001', '\u2002', '\u2003', '\u2004', '\u2005', '\u2006', '\u2008', '\u2009', '\u200a', '\u205f', '\u3000']) {
    it(`breaks at U+${space.codePointAt(0)!.toString(16)} before a fitting word`, async () => {
      const text = `WW${space}WWW`;
      const doc = await layoutSvgText(text, style, 100, new Set([0]));
      const visible = doc.paths.filter(p => p.d);
      expect(visible).toHaveLength(5);
      expect(visible.slice(0, 2).every(p => p.transform.endsWith(',19.20)'))).toBe(true);
      expect(visible.slice(2).every(p => p.transform.endsWith(',49.92)'))).toBe(true);
      expect(doc.lines[0].source).toBe(text);
    });
  }
  for (const [space, firstRow] of [['\u00a0', 3], ['\u202f', 4], ['\u2007', 3]] as const) {
    it(`keeps nonbreaking U+${space.codePointAt(0)!.toString(16)} inside emergency-wrapped tokens`, async () => {
      const text = `WW${space}WWW`;
      const doc = await layoutSvgText(text, style, 100, new Set([0]));
      const visible = doc.paths.filter(p => p.d);
      expect(visible.filter(p => p.transform.endsWith(',19.20)'))).toHaveLength(firstRow);
      expect(doc.lines[0].source).toBe(text);
    });
  }
  it('retains typographic-space width in centered rows (unlike hanging ASCII space)', async () => {
    const centered = { ...style, align: 'center' as const };
    const ascii = await layoutSvgText('WW WWW', centered, 100);
    const em = await layoutSvgText('WW\u2003WWW', centered, 100);
    expect(ascii.paths[0].transform).toBe('translate(26.35,19.20)');
    expect(em.paths[0].transform).toBe('translate(14.35,19.20)');
  });
  const mixedSpaces = [
    { name: 'typographic then ASCII', text: 'WW\u2003 WWW', firstRow: 'WW\u2003 ', soft: true },
    { name: 'ASCII then typographic', text: 'WW \u2003WWW', firstRow: 'WW \u2003', soft: true },
    { name: 'alternating runs', text: 'WW\u2003 \u2009 WWW', firstRow: 'WW\u2003 \u2009 ', soft: true },
    { name: 'multi-character runs', text: 'WW\u2002\u2009  WWW', firstRow: 'WW\u2002\u2009  ', soft: true },
    { name: 'fitting final row', text: 'WW\u2003 ', firstRow: 'WW\u2003 ', soft: false },
    { name: 'fitting alternating final row', text: 'WW\u2003 \u2009 ', firstRow: 'WW\u2003 \u2009 ', soft: false },
    { name: 'explicit newline', text: 'WW\u2003 \ntail', firstRow: 'WW\u2003 ', soft: false },
    { name: 'NBSP after mixed boundary', text: 'WW\u2003 \u00a0WWW', firstRow: 'WW\u2003 ', soft: true },
    { name: 'NBSP before mixed boundary', text: 'WW\u00a0 \u2003WWW', firstRow: 'WW\u00a0 \u2003', soft: true },
  ];
  for (const align of ['left', 'center', 'right'] as const) for (const fixture of mixedSpaces) {
    it(`aligns ${fixture.name}, ${align}, without merging hanging and non-hanging units`, async () => {
      const font = await loadFont('normal', 'normal');
      const doc = await layoutSvgText(fixture.text, { ...style, align }, 100, new Set([0, 1]));
      const alignedText = fixture.soft ? fixture.firstRow.replace(/[ \t]+$/, '') : fixture.firstRow;
      const width = textToGlyphPaths(alignedText, font, 24, 0, 0).endX;
      const startX = (100 - width) * (align === 'center' ? 0.5 : align === 'right' ? 1 : 0);
      const expected = textToGlyphPaths(fixture.firstRow, font, 24, startX, 19.2).glyphs;
      expect(doc.paths.slice(0, expected.length).map(p => p.transform)).toEqual(
        expected.map(g => `translate(${g.x.toFixed(2)},${g.y.toFixed(2)})`),
      );
      // Every whitespace character remains a glyph unit and the original
      // source lines retain their exact UTF-16 contents, including NBSP.
      expect(doc.paths).toHaveLength(fixture.text.replace(/\n/g, '').length);
      expect(doc.lines.map(line => line.source)).toEqual(fixture.text.split('\n'));
      if (fixture.soft) expect(doc.paths[fixture.firstRow.length].transform).toMatch(/,49\.92\)$/);
    });
  }
  it('keeps a trailing ASCII space/tab run separate without changing tab source', async () => {
    // This checks token policy/source preservation, not native tab-stop widths.
    const text = 'WW\u2003 \tWWW';
    const doc = await layoutSvgText(text, { ...style, align: 'center' }, 100, new Set([0]));
    expect(doc.paths[0].transform).toBe('translate(14.35,19.20)');
    expect(doc.lines.map(line => line.source)).toEqual([text]);
  });
  it('keeps combining clusters and surrogate pairs on the same row', async () => {
    for (const cluster of ['W\u0301', '😀']) {
      const doc = await layoutSvgText(cluster.repeat(4), style, 15, new Set([0]));
      expect(doc.height).toBeCloseTo(4 * 30.72);
      expect(doc.lines[0].source).toBe(cluster.repeat(4));
    }
  });
  it('fits long-token rows without clipping or changing container baseline policy', async () => {
    const box = createShapeElement('rect', { width: 110, height: 40 });
    const label = { ...createBoundLabel(box), style, text: 'WWWWWWWWWWWW' };
    const doc = await layoutSvgText(label.text, style, 100);
    const fit = fitLabelToDoc(box, label, doc, { baselineHeight: 40, currentHeight: 40 });
    expect(fit.container?.height).toBe(103);
    expect(fit.label?.height).toBeCloseTo(92.16);
  });
});
