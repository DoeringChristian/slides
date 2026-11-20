import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { parse } from 'opentype.js';
import { pathCommandsToD, samplePathD, setPathSamplerForTests, textToGlyphPaths, xHeightEm } from './glyphPaths';

// samplePathD normally measures via a hidden SVG <path> probe
// (getTotalLength / getPointAtLength), which node has no implementation
// for — tests inject a deterministic sampler through the seam instead.

afterEach(() => {
  setPathSamplerForTests(null);
});

describe('samplePathD', () => {
  test('delegates to the injected sampler and returns its points', () => {
    setPathSamplerForTests((d, n) => {
      // Fake equal-arc sampling of a horizontal 10-unit segment.
      const out: number[] = [];
      for (let k = 0; k < n; k++) out.push((10 * k) / (n - 1), d.length);
      return out;
    });
    const pts = samplePathD('M 0 0 L 10 0', 3);
    expect(pts).toEqual([0, 12, 5, 12, 10, 12]);
  });

  test('caches by (d, n) — the sampler runs once per distinct key', () => {
    const sampler = vi.fn((_d: string, n: number) => new Array(2 * n).fill(0));
    setPathSamplerForTests(sampler);
    const first = samplePathD('M 0 0 L 1 1', 4);
    const second = samplePathD('M 0 0 L 1 1', 4);
    expect(second).toBe(first); // same cached array
    expect(sampler).toHaveBeenCalledTimes(1);
    // Different n or d → separate cache entries.
    samplePathD('M 0 0 L 1 1', 5);
    samplePathD('M 0 0 L 2 2', 4);
    expect(sampler).toHaveBeenCalledTimes(3);
  });

  test('degenerate inputs return empty without touching the sampler', () => {
    const sampler = vi.fn(() => [0, 0]);
    setPathSamplerForTests(sampler);
    expect(samplePathD('', 8)).toEqual([]);
    expect(samplePathD('M 0 0', 1)).toEqual([]);
    expect(sampler).not.toHaveBeenCalled();
  });

  test('without DOM and without an injected sampler it degrades to []', () => {
    // afterEach cleared the sampler; explicitly ensure none is set.
    setPathSamplerForTests(null);
    expect(samplePathD('M 0 0 L 5 5', 4)).toEqual([]);
  });
});

describe('xHeightEm', () => {
  const load = (file: string) => {
    const bytes = readFileSync(new URL(`../../assets/fonts/${file}`, import.meta.url));
    return parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  };

  /**
   * These are the numbers that size every equation against its prose, so a
   * font-file swap that moves them should be a deliberate, visible change
   * rather than a silent reflow of every deck.
   */
  test.each([
    ['Inter-Regular.ttf', 0.5459],
    ['LibertinusSerif-Regular.otf', 0.4290],
  ])('reads %s from the real metrics', (file, expected) => {
    expect(xHeightEm(load(file))).toBeCloseTo(expected, 4);
  });

  test('the two bundled faces disagree enough for the scaling to matter', () => {
    // 27% apart. A math font sized for one looks wrong against the other,
    // which is the whole reason parseMathChunks rescales.
    const inter = xHeightEm(load('Inter-Regular.ttf'));
    const libertinus = xHeightEm(load('LibertinusSerif-Regular.otf'));
    expect(inter / libertinus).toBeGreaterThan(1.2);
  });

  test('measures the x glyph when OS/2 omits sxHeight', () => {
    const real = load('LibertinusSerif-Regular.otf');
    const withoutTable = {
      tables: { os2: {} },
      unitsPerEm: real.unitsPerEm,
      charToGlyph: (c: string) => real.charToGlyph(c),
    } as unknown as Parameters<typeof xHeightEm>[0];
    // The top of lowercase x IS the x-height, so the fallback must land close
    // to the metric it replaces rather than on the 0.5 last resort.
    expect(xHeightEm(withoutTable)).toBeCloseTo(xHeightEm(real), 2);
  });

  test('falls back to half an em when there is nothing to measure', () => {
    const empty = {
      tables: { os2: {} },
      unitsPerEm: 1000,
      charToGlyph: () => undefined,
    } as unknown as Parameters<typeof xHeightEm>[0];
    expect(xHeightEm(empty)).toBe(0.5);
  });
});

describe('textToGlyphPaths glyph cache', () => {
  const load = (file: string) => {
    const b = readFileSync(new URL(`../../assets/fonts/${file}`, import.meta.url));
    return parse(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
  };

  test('never hands one font a glyph cached from another', () => {
    // Glyph indices are per font file: Libertinus' `h` and Inter's `C` are
    // both glyph 73. The cache used to be keyed on a font name opentype.js 2
    // no longer exposes, so every font read as 'font' and an `h` typed in
    // Libertinus after Inter had drawn a `C` came out as that `C`.
    const inter = load('Inter-Regular.ttf');
    const libertinus = load('LibertinusSerif-Regular.otf');
    expect(inter.charToGlyphIndex('C')).toBe(libertinus.charToGlyphIndex('h'));

    const interC = textToGlyphPaths('C', inter, 24, 0, 0).glyphs[0].d;
    const libertinusH = textToGlyphPaths('h', libertinus, 24, 0, 0).glyphs[0].d;
    expect(libertinusH).not.toBe(interC);
    expect(libertinusH).toBe(pathCommandsToD(libertinus.charToGlyph('h').getPath(0, 0, 24).commands));
  });
});

describe('textToGlyphPaths shaping', () => {
  const load = (file: string) => {
    const b = readFileSync(new URL(`../../assets/fonts/${file}`, import.meta.url));
    return parse(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
  };
  const libertine = load('LinuxLibertineT-Regular.otf');

  test('kerns a pair by moving its SECOND glyph', () => {
    // It used to add the (A, V) kern after placing V, so V sat unkerned and
    // the glyph after it moved instead.
    const a = libertine.charToGlyph('A'), v = libertine.charToGlyph('V');
    const kern = libertine.getKerningValue(a, v);
    expect(kern).toBeLessThan(0); // TeX's TFM kerns A–V; the font carries it
    const scale = 40 / libertine.unitsPerEm;
    const [, second] = textToGlyphPaths('AV', libertine, 40, 0, 0).glyphs;
    expect(second.x).toBeCloseTo((a.advanceWidth! + kern) * scale, 9);
  });

  test('sets the f-ligatures as one glyph each, as TeX does', () => {
    for (const word of ['ff', 'fi', 'fl', 'ffi', 'ffl']) {
      expect(textToGlyphPaths(word, libertine, 40, 0, 0).glyphs, word).toHaveLength(1);
    }
    expect(textToGlyphPaths('office', libertine, 40, 0, 0).glyphs).toHaveLength(4); // o ffi c e
  });

  test('leaves a font whose ligatures cannot be read unshaped, without throwing', () => {
    const inter = load('Inter-Regular.ttf');
    expect(() => textToGlyphPaths('office', inter, 40, 0, 0)).not.toThrow();
  });
});

describe('pathCommandsToD', () => {
  test('writes a coordinate within float noise of an integer as that integer', () => {
    // opentype.js's own toPathData rounds 32.00000000000001 by building the
    // string "1.06e-14e+3" and emits NaN, which drops the rest of the glyph.
    const d = pathCommandsToD([
      { type: 'M', x: 0, y: 0 },
      { type: 'C', x1: 32.00000000000001, y1: -0.1594, x2: 31.99999999999999, y2: -0.9963, x: 31.7609, y: -1.2354 },
      { type: 'Z' },
    ] as never);
    expect(d).toBe('M0 0C32 -0.159 32 -0.996 31.761 -1.235Z');
  });

  test('keeps a closing segment, however short', () => {
    // toPathData's optimiser drops a final lineto within one output unit of
    // the contour's start — a pixel at render size.
    const d = pathCommandsToD([
      { type: 'M', x: 0, y: 0 }, { type: 'L', x: 10, y: 0 }, { type: 'L', x: 0.5, y: 0.5 }, { type: 'Z' },
    ] as never);
    expect(d).toBe('M0 0L10 0L0.5 0.5Z');
  });
});
