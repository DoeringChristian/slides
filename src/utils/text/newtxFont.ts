/**
 * The newtxmath math font, as a MathJax font package.
 *
 * This is the face acmart sets — `\usepackage[libertine]{newtxmath}` — and no
 * published MathJax package reproduces it, because its outlines are Type 1 and
 * exist in no OpenType font. They do not have to: a MathJax SVG font is a
 * table of `[height, depth, width, {p}]` with the path in 1000-unit em space,
 * which is the space Type 1 charstrings already use. So the glyph data under
 * `generated/newtx/` is a transcription of newtxmath's own curves, with
 * newtxmath's own TFM metrics, produced by `npm run build:mathfont`.
 *
 * The size of the difference, for the glyph that prompted this: acmart's
 * display integral spans 2.207 em, where Termes — the closest published
 * stand-in, and the previous pairing — spans 1.694. That is a 23% shorter
 * integral, which is the kind of gap no amount of scaling fixes.
 *
 * Layout still belongs to MathJax, so this is not a claim of identity with a
 * TeX run: the glyphs and their metrics are newtxmath's, and the FONTDIMEN
 * parameters MathJax positions fractions, limits and radicals with are
 * newtxmath's too, but the algorithm applying them is MathJax's own.
 *
 * Characters newtxmath does not cover fall through to Termes, which the
 * generated tables are merged over. Termes is Times-derived exactly as
 * newtxmath is, so a fallback is a near neighbour rather than a clash; what
 * falls back is listed in `generated/newtx/meta.json`.
 */

import { MathJaxTermesFont } from '@mathjax/mathjax-termes-font/js/svg.js';
import { normal } from './generated/newtx/normal';
import { bold } from './generated/newtx/bold';
import { italic } from './generated/newtx/italic';
import { boldItalic } from './generated/newtx/bold-italic';
import { script } from './generated/newtx/script';
import { calligraphic } from './generated/newtx/calligraphic';
import { boldCalligraphic } from './generated/newtx/bold-calligraphic';
import { smallop } from './generated/newtx/smallop';
import { largeop } from './generated/newtx/largeop';
import { size3 } from './generated/newtx/size3';
import { size4 } from './generated/newtx/size4';
import { size5 } from './generated/newtx/size5';
import { size6 } from './generated/newtx/size6';
import { delimiters } from './generated/newtx/delimiters';
import { params } from './generated/newtx/params';

type CharTable = Record<number, unknown>;

/** Our glyphs win; Termes supplies anything newtxmath has no glyph for. */
function overlay(base: CharTable | undefined, ours: CharTable): CharTable {
  return Object.assign({}, base ?? {}, ours);
}

/**
 * Our tables under MathJax's own variant names.
 *
 * MathJax 4 prefixes its internal variants with a hyphen (`-largeop`, not
 * `largeop`), and a key that does not match one is simply never consulted —
 * the font would load and quietly render every big operator in Termes. The
 * overlay below therefore only ever adds to names Termes already has, and the
 * test asserts the count goes up.
 */
const GENERATED: Record<string, CharTable> = {
  'normal': normal,
  'bold': bold,
  'italic': italic,
  'bold-italic': boldItalic,
  'script': script,
  '-tex-calligraphic': calligraphic,
  '-tex-bold-calligraphic': boldCalligraphic,
  '-smallop': smallop,
  '-largeop': largeop,
  '-size3': size3,
  '-size4': size4,
  '-size5': size5,
  '-size6': size6,
};

const Termes = MathJaxTermesFont as unknown as {
  defaultChars: Record<string, CharTable>;
  defaultParams: Record<string, number>;
  defaultDelimiters: Record<number, unknown>;
  OPTIONS: Record<string, unknown>;
  variantCacheIds: Record<string, string>;
};

const TermesClass = MathJaxTermesFont as unknown as new (options?: unknown) => object;

export class MathJaxNewtxFont extends TermesClass {
  static NAME = 'MathJaxNewtx';

  // Keep Termes' options: its `dynamicPrefix` is what serves the lazily
  // loaded ranges newtxmath has no glyphs for.
  static OPTIONS = { ...Termes.OPTIONS };

  static defaultChars: Record<string, CharTable> = Object.fromEntries(
    Object.entries({ ...Termes.defaultChars }).map(([variant, table]) => [
      variant,
      GENERATED[variant] ? overlay(table, GENERATED[variant]) : table,
    ]),
  );

  // newtxmath's own FONTDIMEN block, so MathJax stacks fractions and limits
  // with the paper's parameters rather than Termes'.
  static defaultParams: Record<string, number> = { ...Termes.defaultParams, ...params };

  /**
   * Stretchy characters: ours where newtxmath declares one, Termes' otherwise.
   *
   * This table and the size variants above are one unit. An entry says how
   * many discrete sizes a character has and how tall each is, and MathJax
   * looks the i-th up at the same codepoint in the i-th size variant — so
   * Termes' entry over our glyphs does not approximate, it mis-indexes.
   * Termes promises `(` a 1.169 em size in `-largeop`; newtxmath's chain puts
   * its own second size at 1.808 and nothing at Termes' index, so `\left(`
   * came out as the top hook of an assembled paren, drawn alone.
   *
   * Overlaying per codepoint is what keeps that from recurring in either
   * direction: a character newtx declares gets its chain AND its glyphs from
   * newtx, and one it does not (the wide accents, `\overbrace`, the arrows
   * MathJax grows horizontally) keeps Termes' chain, whose glyphs are still in
   * these tables because the overlay above only ever adds.
   */
  static defaultDelimiters: Record<number, unknown> = {
    ...Termes.defaultDelimiters,
    ...delimiters,
  };

  /**
   * Two repairs to what the base constructor leaves behind: the glyphs it
   * overwrote with dynamic-range descriptors, and the glyph-id prefix.
   *
   * Glyph ids in the rendered SVG are prefixed per font, and Termes hardcodes
   * `GT-` in its own constructor. Two fonts sharing the prefix is not
   * theoretical here: `fontCache: 'local'` puts the outlines in a `<defs>`
   * inside each `<svg>`, the ids are global once several of those are in one
   * DOM — which is exactly what a slide canvas is — and a `<use>` resolves to
   * the first match in document order. A deck mixing faces would silently draw
   * one font's glyph for the other's.
   */
  constructor(options: Record<string, unknown> = {}) {
    super(options);
    const self = this as unknown as {
      variant: Record<string, { cacheID: string }>;
      defineChars(name: string, chars: CharTable): void;
      defineDelimiters(delims: Record<number, unknown>): void;
    };

    // Re-apply our tables, because the base constructor has just overwritten
    // them. `FontData` installs `defaultChars` (FontData.js:128) and THEN
    // `defineDynamicCharacters` (:132), which writes a load-descriptor object
    // into `variant.chars[n]` for every codepoint a dynamic range declares —
    // on top of whatever glyph was there. `getChar` (:360) treats any
    // non-array entry as "not loaded yet": it deletes the entry, fetches the
    // range, and the range installs Termes' glyph.
    //
    // So a statically supplied glyph inside a declared range is not merely
    // overridden, it is destroyed on first use, and the static table above is
    // silently pointless for it. That hit all 52 calligraphic glyphs —
    // Termes declares `-tex-calligraphic` and `-tex-bold-calligraphic` 0x41-
    // 0x5A dynamic, which is exactly the range we generate — so `\mathcal`
    // drew Termes' swash (0.798 em wide) in place of newtxmath's (0.910),
    // plus 13 scattered glyphs in `normal` and `bold-italic`.
    //
    // Re-applying restores the policy the overlay above states: ours win,
    // Termes fills the gaps. A codepoint we do not supply keeps its
    // descriptor and still loads on demand.
    for (const [variant, table] of Object.entries(GENERATED)) {
      if (self.variant[variant]) self.defineChars(variant, table);
    }
    self.defineDelimiters(delimiters);

    for (const variant of Object.keys(self.variant)) {
      self.variant[variant].cacheID = `NTX-${Termes.variantCacheIds[variant] || 'N'}`;
    }
  }
}
