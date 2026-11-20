import { describe, expect, it } from 'vitest';
import { MathJaxNewtxFont } from './newtxFont';
import { largeop } from './generated/newtx/largeop';
import { smallop } from './generated/newtx/smallop';
import { normal } from './generated/newtx/normal';
import { bold } from './generated/newtx/bold';
import { italic } from './generated/newtx/italic';
import { boldItalic } from './generated/newtx/bold-italic';
import { calligraphic } from './generated/newtx/calligraphic';
import { boldCalligraphic } from './generated/newtx/bold-calligraphic';
import { script } from './generated/newtx/script';
import { size3 } from './generated/newtx/size3';
import { size4 } from './generated/newtx/size4';
import { delimiters } from './generated/newtx/delimiters';
import { params } from './generated/newtx/params';

/**
 * These guard the generated font, which `npm run build:mathfont` produces from
 * a TeX installation. The data is committed, so a regeneration that silently
 * changed shape — or a merge that dropped a variant — would otherwise only
 * show up as equations quietly rendering in Termes again.
 */
describe('the generated newtxmath font', () => {
  it('carries acmart’s display integral, not a published stand-in’s', () => {
    // The glyph that started this: Termes' display integral spans 1.694 em
    // against newtxmath's 2.207, so a 23% shorter integral is exactly what
    // "it still doesn't match, integral signs for example" looked like.
    const int = largeop[0x222B];
    expect(int, 'U+222B missing from largeop').toBeDefined();
    const extent = int[0] + int[1];
    expect(extent).toBeGreaterThan(2.1);
    expect(extent).toBeLessThan(2.3);
    // Display size must actually be bigger than text size, or the chain walk
    // picked the wrong end of NEXTLARGER.
    const small = smallop[0x222B];
    expect(small[0] + small[1]).toBeLessThan(extent);
  });

  it('centres operators on the math axis the way MathJax expects', () => {
    // TeX's extension font hangs these below the baseline and centres them at
    // layout time; MathJax wants them pre-centred. Getting this wrong puts
    // every big operator at the wrong height, so it is worth pinning.
    for (const code of [0x222B, 0x2211, 0x220F]) {
      const e = largeop[code];
      if (!e) continue;
      const centre = (e[0] - e[1]) / 2;
      expect(centre, `U+${code.toString(16)} centre`).toBeCloseTo(params.axis_height, 3);
    }
  });

  it('uses newtxmath’s own TeX parameters', () => {
    // These come from the TFM FONTDIMEN block, so they are the numbers TeX
    // itself lays out with rather than MathJax's defaults.
    expect(params.axis_height).toBeGreaterThan(0.2);
    expect(params.axis_height).toBeLessThan(0.3);
    expect(params.rule_thickness).toBeGreaterThan(0);
    expect(params.x_height).toBeGreaterThan(0.3);
  });

  it('gives every entry a well-formed outline and em metrics', () => {
    for (const [name, table] of Object.entries({ normal, italic, largeop, smallop })) {
      expect(Object.keys(table).length, `${name} is empty`).toBeGreaterThan(0);
      for (const [code, entry] of Object.entries(table)) {
        const where = `${name} U+${Number(code).toString(16)}`;
        expect(entry.length, `${where} arity`).toBe(4);
        const [h, d, w, extra] = entry;
        for (const [label, v] of [['height', h], ['depth', d], ['width', w]] as const) {
          expect(Number.isFinite(v), `${where} ${label} not finite`).toBe(true);
          // Everything is in em; a value past this means a unit slipped.
          expect(Math.abs(v), `${where} ${label} out of range`).toBeLessThan(10);
        }
        // MathJax prepends the initial moveto, so the data must start with a
        // coordinate. A leading `M` here renders as `d="MM…"`, which is
        // invalid: the glyph silently does not draw.
        expect(extra.p, `${where} must not carry a leading command`).toMatch(/^-?[\d.]/);
        expect(extra.p, `${where} path has stray characters`).not.toMatch(/[^MLC0-9 .-]/);
        expect(extra.p, `${where} uses Z, which MathJax's data never does`).not.toMatch(/Z/);
      }
    }
  });

  it('files bold math where \\mathbf will actually look for it', () => {
    // MathJax reaches a styled letter through the Mathematical Alphanumeric
    // block: `\mathbf{x}` becomes a lookup of U+1D431, never of `x`. A bold
    // table keyed by plain letters is complete, correct and never read — which
    // is how bold math fell through to Termes while every medium glyph matched.
    for (const [code, what] of [
      [0x1D400, 'bold A'], [0x1D41A, 'bold a'], [0x1D7CE, 'bold 0'],
      [0x1D6AA, 'bold Gamma'], [0x1D6C2, 'bold alpha'],
    ] as const) {
      expect(bold[code], `${what} (U+${code.toString(16).toUpperCase()})`).toBeDefined();
    }
    for (const [code, what] of [
      [0x1D468, 'bold italic A'], [0x1D482, 'bold italic a'],
      [0x1D489, 'bold italic h'], [0x1D736, 'bold italic alpha'],
    ] as const) {
      expect(boldItalic[code], `${what} (U+${code.toString(16).toUpperCase()})`).toBeDefined();
    }
    // Bold has to be bolder: the stroke shows up as a wider advance.
    expect(bold[0x1D400][2]).toBeGreaterThan(normal[0x41][2]);
  });

  it('keeps the calligraphic capitals out of the upright variant', () => {
    // TeX's symbol font puts `\mathcal A`…`\mathcal Z` at the ASCII letter
    // slots and names them `A`…`Z`, so read through the Adobe Glyph List's
    // one-character rule the font appears to claim U+0041 for a swash
    // calligraphic A — and a glyph name outranks a declaration here, so it won.
    // `\sin`, `\max` and `\mathrm{A}` all came out calligraphic.
    expect(calligraphic[0x41], 'calligraphic A').toBeDefined();
    expect(normal[0x41], 'upright A').toBeDefined();
    expect(normal[0x41][2], 'upright A took the calligraphic glyph')
      .not.toBeCloseTo(calligraphic[0x41][2], 3);
    // Libertine's upright capitals are narrower than the swash ones; the
    // direction is the tell.
    expect(normal[0x41][2]).toBeLessThan(calligraphic[0x41][2]);
  });

  it('keeps every delimiter size in step with the variant it is looked up in', () => {
    // This is the invariant the whole delimiters table exists to hold. An
    // entry says a character has N sizes and how tall each is; MathJax looks
    // the i-th up at the SAME codepoint in the i-th of `sizeVariants`. Get the
    // two out of step and nothing degrades — the lookup returns whatever glyph
    // happens to sit at that index. Inheriting Termes' table over newtx's
    // glyphs did exactly that: Termes promises `(` a 1.169 em size, so MathJax
    // asked `-largeop` for it and drew the top hook of an assembled paren.
    const CLASS = MathJaxNewtxFont as unknown as {
      defaultChars: Record<string, Record<number, [number, number, number, unknown]>>;
      defaultSizeVariants: string[];
    };
    const sizeVariants = CLASS.defaultSizeVariants;
    expect(sizeVariants[0], 'size 0 is the ordinary glyph').toBe('normal');
    expect(sizeVariants.length).toBeGreaterThanOrEqual(3);

    let checked = 0;
    for (const [key, delim] of Object.entries(delimiters)) {
      const code = delim.c ?? Number(key);
      const where = `U+${Number(key).toString(16).toUpperCase()}`;
      for (const [i, extent] of (delim.sizes ?? []).entries()) {
        const variant = sizeVariants[delim.variants ? delim.variants[i] : i];
        expect(variant, `${where} size ${i} has no variant`).toBeDefined();
        const entry = CLASS.defaultChars[variant]?.[code];
        expect(entry, `${where} size ${i} has no glyph in ${variant}`).toBeDefined();
        expect(entry[0] + entry[1], `${where} size ${i} in ${variant} is the wrong glyph`)
          .toBeCloseTo(extent, 3);
        checked++;
      }
      // Every piece of an assembly has to resolve, or the delimiter grows into
      // a gap. 0 is MathJax's "no such piece", which is legitimate — an up
      // arrow has no bottom.
      for (const piece of delim.stretch ?? []) {
        if (!piece) continue;
        expect(CLASS.defaultChars.normal[piece], `${where} stretch piece U+${piece.toString(16)}`)
          .toBeDefined();
      }
    }
    expect(checked, 'no delimiter sizes were checked').toBeGreaterThan(50);
  });

  it('gives the radical a size chain and an assembly, and a flush vinculum', () => {
    const surd = delimiters[0x221A];
    expect(surd, 'U+221A missing from the delimiters table').toBeDefined();
    expect(surd.sizes?.length, '\\sqrt cannot grow').toBeGreaterThan(3);
    expect(surd.stretch, '\\sqrt cannot be assembled past its largest size').toBeDefined();
    // `msqrt` places the sign with its bbox top at the rule's top and fills
    // `surd_height` downwards, so the two meet flush only if this is the
    // thickness of the sign's own arm. TeX states that as the glyph's height.
    expect(params.surd_height).toBeGreaterThan(0);
    expect(params.surd_height).toBeCloseTo(params.rule_thickness, 3);
  });

  it('overlays newtxmath onto Termes rather than replacing its coverage', () => {
    const chars = (MathJaxNewtxFont as unknown as {
      defaultChars: Record<string, Record<number, unknown>>;
    }).defaultChars;
    // Our glyph wins where we have one. The key is MathJax's internal variant
    // name, hyphen and all; a plain 'largeop' would be a table nothing reads.
    expect(chars['-largeop'], 'MathJax renamed its largeop variant').toBeDefined();
    expect(chars['-largeop'][0x222B]).toBe(largeop[0x222B]);
    // ...and Termes still covers what newtxmath has no glyph for, so a
    // formula using an arrow or a rare symbol does not come out blank.
    expect(Object.keys(chars.normal).length).toBeGreaterThan(Object.keys(normal).length);
    // The delimiters table overlays per codepoint for the same reason: the
    // stretchy characters newtxmath does not declare — the wide accents,
    // `\overbrace`, the arrows MathJax grows sideways — keep Termes' chains,
    // whose glyphs are still present because the overlay only ever adds.
    const delims = (MathJaxNewtxFont as unknown as {
      defaultDelimiters: Record<number, unknown>;
    }).defaultDelimiters;
    expect(delims[0x28], 'our paren chain').toBe(delimiters[0x28]);
    expect(delims[0x302], 'Termes\u2019 wide circumflex was dropped').toBeDefined();
    expect(delimiters[0x302], 'newtx declares no wide circumflex').toBeUndefined();
  });

  it('survives the base constructor’s dynamic-range pass', () => {
    // The static table is not the last word on what a variant holds. `FontData`
    // installs `defaultChars`, then `defineDynamicCharacters` writes a
    // load-descriptor over every codepoint a dynamic range declares, and
    // `getChar` deletes any non-array entry and fetches Termes' range instead.
    // A glyph of ours inside a declared range is therefore destroyed on first
    // use, with no error anywhere — `\mathcal` drew Termes' swash for exactly
    // this reason while this file's other assertions stayed green, because
    // they all read the static table.
    //
    // So this asserts on a CONSTRUCTED font: every codepoint we generate must
    // still be glyph data (an array), not a descriptor.
    const font = new MathJaxNewtxFont() as unknown as {
      variant: Record<string, { chars: Record<number, unknown> }>;
      delimiters: Record<number, unknown>;
    };
    const generated: Record<string, Record<number, unknown>> = {
      'normal': normal, 'bold': bold, 'italic': italic, 'bold-italic': boldItalic,
      'script': script, '-tex-calligraphic': calligraphic,
      '-tex-bold-calligraphic': boldCalligraphic, '-smallop': smallop,
      '-largeop': largeop, '-size3': size3, '-size4': size4,
    };
    const lost: string[] = [];
    let checked = 0;
    for (const [name, table] of Object.entries(generated)) {
      const chars = font.variant[name]?.chars;
      expect(chars, `variant ${name} does not exist`).toBeDefined();
      for (const key of Object.keys(table)) {
        const code = Number(key);
        checked++;
        if (!Array.isArray(chars[code])) lost.push(`${name} U+${code.toString(16)}`);
      }
    }
    expect(checked).toBeGreaterThan(900);
    expect(lost, 'glyphs a dynamic range would replace with Termes').toEqual([]);

    // Same hazard for the stretchy chains: a dynamic range may declare
    // delimiters too, and `getDelimiter` treats an entry without `dir` as a
    // descriptor.
    for (const key of Object.keys(delimiters)) {
      const entry = font.delimiters[Number(key)] as { dir?: string } | undefined;
      expect(entry, `delimiter U+${Number(key).toString(16)} vanished`).toBeDefined();
      expect(entry, `delimiter U+${Number(key).toString(16)} is a load descriptor`)
        .toHaveProperty('dir');
    }
  });
});

/**
 * Glyph accuracy against acmart, end to end through MathJax. The full check is
 * `scripts/mathfont/compare-glyphs.mjs` (it needs TeX); these pin the
 * mechanisms it depends on, so a regeneration or a MathJax upgrade that
 * quietly undid one fails here.
 */
describe('newtx math as acmart draws it', () => {
  const glyphs = (svg: string) => [...svg.matchAll(/<path id="([^"]+)"/g)].map((m) => m[1].replace(/^MJX-\d+-/, ''));
  const scales = (svg: string) => [...svg.matchAll(/scale\((0\.\d+)\)/g)].map((m) => Number(m[1]));

  it('sets scripts at acmart’s 6.6 pt and 5.5 pt of 9 pt, from the script designs', async () => {
    const { texFragmentToSvg } = await import('../../services/latexToSvg');
    const svg = await texFragmentToSvg('x^{x^{x}}', false, 'mathjax-newtx');
    // Relative scales: 0.7333 for the first level, 0.6111 / 0.7333 for the second.
    expect(scales(svg)).toEqual([0.733, 0.833]);
    // Three different outlines: nxlmi's x, nxlmi7's x, nxlmi5's x.
    expect(glyphs(svg)).toEqual(['NTX-I-78', 'NTX-I1-78', 'NTX-I2-78']);
  });

  it('leaves every other math font to MathJax’s own script sizes', async () => {
    const { texFragmentToSvg } = await import('../../services/latexToSvg');
    const svg = await texFragmentToSvg('x^{x^{x}}', false, 'mathjax-newcm');
    expect(scales(svg)).toEqual([0.707, 0.707]);
  });

  it('makes \\mathbf switch only letters and digits, as TeX does', async () => {
    const { texFragmentToSvg } = await import('../../services/latexToSvg');
    const outline = (svg: string, id: string) => new RegExp(`id="MJX-\\d+-${id}" d="([^"]*)"`).exec(svg)?.[1];
    const bf = await texFragmentToSvg('\\mathbf{x-1}', false, 'mathjax-newtx');
    const plain = await texFragmentToSvg('x-1', false, 'mathjax-newtx');
    // Letter and digit: the semibold ones, not the plain ones.
    expect(outline(bf, 'NTX-BF-78')).toBeDefined();
    expect(outline(bf, 'NTX-BF-31')).not.toBe(outline(plain, 'NTX-N-31'));
    // The minus: filed under \mathbf's prefix, but the normal outline.
    expect(outline(bf, 'NTX-BF-2212')).toBe(outline(plain, 'NTX-N-2212'));
  });

  it('carries TeX’s script-size letters for every italic and bold-italic letter', async () => {
    const { scriptVariants, scriptScales } = await import('./generated/newtx/script-sizes');
    expect(scriptScales).toEqual([1, 0.73333, 0.61111]);
    for (const v of ['italic-s1', 'italic-s2']) expect(Object.keys(scriptVariants[v]).length).toBe(Object.keys(italic).length);
    for (const v of ['bold-italic-s1', 'bold-italic-s2']) expect(Object.keys(scriptVariants[v]).length).toBe(Object.keys(boldItalic).length);
    // The 7 pt design is not the text design scaled: same letter, other outline.
    expect(scriptVariants['italic-s1'][0x1D465][3].p).not.toBe(italic[0x1D465][3].p);
  });
});
