/**
 * The one place fonts are defined.
 *
 * Adding a face means adding an entry here and nothing else: the font picker,
 * the outline renderer, the `@font-face` rules for the edit overlay, the
 * math-font picker and the exhaustiveness tests all derive from these tables.
 * Nothing else in the codebase may hardcode a family name or a font URL.
 *
 * Two kinds of font, because they are rendered by entirely different machinery:
 *
 *  - **Text fonts** are real font files, bundled and parsed by opentype.js so
 *    `glyphPaths` can emit per-glyph outlines. Only a bundled font can be drawn
 *    this way — the web platform exposes no outline data for system fonts — so
 *    this list is exactly the set of faces we ship, not a list of CSS families
 *    to hope for. `id` doubles as the CSS family name, so the same value works
 *    in `font-family` for the edit overlay and the DOM/export paths.
 *  - **Math fonts** are MathJax 4 font packages. MathJax does the TeX layout
 *    and emits glyph outlines from its own compiled-in font data, so a math
 *    font is chosen by package name, loaded lazily, and never by CSS — the SVG
 *    it produces carries no `font-family` at all.
 *
 * Each text font names the math font it pairs with, so picking "Libertinus
 * Serif" gets Libertinus math by default rather than leaving prose and
 * equations in different faces.
 */

// The bytes live in `fontSources`, which the viewer build aliases away: an
// export draws baked outlines, so it needs no font files and no MathJax. This
// file stays the single description of WHICH faces exist and what pairs with
// what, in every build.
import { TEXT_FONT_FILES, MATH_FONT_MODULES } from './fontSources';

export { loadMathFontRange } from './fontSources';

// ─────────────────────────────────────────────────────────────────────────────
// Text fonts
// ─────────────────────────────────────────────────────────────────────────────

/** The four variants every bundled text font must provide. */
export interface FontVariants {
  regular: string;
  bold: string;
  italic: string;
  boldItalic: string;
}

export interface TextFontDef {
  /** Stored in `TextStyle.fontFamily`, and used verbatim as the CSS family. */
  id: string;
  /** Shown in the picker. */
  label: string;
  /** CSS stack for the DOM paths: the family plus a generic fallback. */
  cssStack: string;
  /** Asset URLs, resolved by Vite (hashed in the editor build, inlined in the
   *  standalone build, so no sibling `fonts/` directory is required). */
  variants: FontVariants;
  /** Ascent and descent in em — the face's hhea metrics, which its OS/2
   *  typo and win metrics agree with, so it is also what a browser lays a CSS
   *  line box out with. `textRowMetrics` places the baseline by them, which is
   *  what keeps the SVG text and the edit overlay's native text on one
   *  baseline. `fontRegistry.test.ts` reads them back from the font files. */
  ascent: number;
  descent: number;
  /** Math font to use when the element does not name one. */
  defaultMathFont: MathFontId;
  /** Attribution — these are redistributed in a public repo. */
  notice: string;
}

export const TEXT_FONTS = [
  {
    id: 'Inter',
    label: 'Inter',
    cssStack: "'Inter', system-ui, sans-serif",
    variants: TEXT_FONT_FILES['Inter'],
    ascent: 0.96875,
    descent: 0.2412109375,
    // Inter is a UI sans; New Computer Modern is MathJax 4's default and the
    // least surprising partner until a sans math font is registered.
    defaultMathFont: 'mathjax-newcm',
    notice: 'Inter — Copyright (c) 2016 The Inter Project Authors. SIL Open Font License 1.1.',
  },
  {
    id: 'Libertinus Serif',
    label: 'Libertinus Serif',
    cssStack: "'Libertinus Serif', 'Linux Libertine O', Georgia, serif",
    variants: TEXT_FONT_FILES['Libertinus Serif'],
    ascent: 0.894,
    descent: 0.246,
    // The SIGGRAPH pairing: acmart sets Libertine text against newtxmath in
    // its libertine mode. This was briefly STIX Two, chosen because its
    // ADVANCE WIDTHS came closest to an acmart render. That was the wrong
    // measurement: widths agree to within a few percent across faces whose
    // outlines share barely half their ink, so the table ranked by a quantity
    // nobody looks at. Rasterising both sides and measuring the ink that
    // actually coincides, per glyph class (`scripts/compare-math-fonts.mjs`):
    //
    //                math italic   operators   greek lower   weighted
    //   Asana             36%          69%          30%        36.4%
    //   Termes            37%          48%          20%        32.0%
    //   STIX Two          26%          25%          50%        31.7%
    //
    // Termes wins math italic — the variables, which an equation is mostly
    // made of and which the eye reads first — where STIX Two trails it by
    // half again. Asana takes the weighted total, but on the strength of
    // operators and big operators: `+`, `=`, `\sum` are simple geometry that
    // any face gets close on, so that column separates fonts least. Against
    // it, Asana is a Palatino companion rather than a Times one, and its
    // 0.482em x-height needs an 11% downscale to meet Libertinus Serif's
    // 0.429 — which thins its strokes relative to the prose. Termes needs
    // 2.8%, and is Times-derived exactly as newtxmath is. The two are within
    // the noise of a comparison whose sides use different rasterisers, so the
    // lineage and the x-height decide it.
    //
    // That whole comparison is now history: no PUBLISHED package is a close
    // match, so the face is generated instead. `mathjax-newtx` carries
    // newtxmath's own outlines and metrics (see `newtxFont.ts`), which is what
    // acmart sets, so the pairing no longer has to pick a near neighbour. The
    // table above is kept because it is the measurement that justifies going
    // to that trouble: the best published face shares about a third of its ink
    // with the real thing.
    defaultMathFont: 'mathjax-newtx',
    notice:
      'Libertinus Serif 7.051 — Copyright (c) 2012-2024 The Libertinus Project Authors. '
      + 'SIL Open Font License 1.1. Designed by Philipp H. Poll and Khaled Hosny.',
  },
  {
    // What acmart (SIGGRAPH, TOG) actually prints, not a relative of it.
    // pdfLaTeX's acmart loads `[T1]{fontenc}` and `[type1=true]{libertine}`:
    // the Linux Libertine Type 1 fonts through the `*-tlf-t1` virtual fonts.
    // These files are generated from exactly those (`npm run build:texfont`):
    // the .pfb outlines unchanged, the TFM's advances, kerning, f-ligatures
    // and interword space — so a line set here lands glyph for glyph where
    // TeX puts it (`scripts/texfont/compare-text.mjs` checks that against
    // pdfLaTeX). Libertinus Serif is a later fork whose outlines and metrics
    // have moved on; the OpenType Linux Libertine in TeX Live is a different
    // release than the Type 1 fonts acmart uses.
    id: 'Linux Libertine T',
    label: 'Linux Libertine (ACM / SIGGRAPH)',
    cssStack: "'Linux Libertine T', 'Linux Libertine O', Georgia, serif",
    variants: TEXT_FONT_FILES['Linux Libertine T'],
    ascent: 0.894,
    descent: 0.246,
    defaultMathFont: 'mathjax-newtx',
    notice:
      'Linux Libertine 5.3.0 — Copyright (c) 2003-2012 Philipp H. Poll; Type 1 conversion for TeX by '
      + 'Bob Tennent. GPL with font exception, or SIL Open Font License. Generated from the TeX Live '
      + 'libertine package (LinLibertineT*.pfb and *-tlf-t1 metrics).',
  },
  {
    // acmart's sans (`\sffamily`: titles, headings, captions in some
    // formats), from the same package by the same route.
    id: 'Linux Biolinum T',
    label: 'Linux Biolinum (ACM / SIGGRAPH sans)',
    cssStack: "'Linux Biolinum T', 'Linux Biolinum O', sans-serif",
    variants: TEXT_FONT_FILES['Linux Biolinum T'],
    ascent: 0.894,
    descent: 0.246,
    defaultMathFont: 'mathjax-newtx',
    notice:
      'Linux Biolinum 1.1.8 — Copyright (c) 2003-2012 Philipp H. Poll; Type 1 conversion for TeX by '
      + 'Bob Tennent. GPL with font exception, or SIL Open Font License. Generated from the TeX Live '
      + 'libertine package (LinBiolinumT*.pfb and *-tlf-t1 metrics).',
  },
] as const satisfies readonly TextFontDef[];

export type TextFontId = (typeof TEXT_FONTS)[number]['id'];

/** The face used when a deck names a font we do not ship. */
export const DEFAULT_TEXT_FONT: TextFontId = 'Inter';

// ─────────────────────────────────────────────────────────────────────────────
// Math fonts
// ─────────────────────────────────────────────────────────────────────────────

export interface MathFontDef {
  /** Stored in `TextStyle.mathFont`; also MathJax's own font name. */
  id: string;
  label: string;
  /** Short note for the picker: what this face is for. */
  blurb: string;
  /**
   * Loads the font's SVG data module. Dynamic so each face becomes its own
   * chunk — a deck pays only for the fonts it uses, which matters because the
   * standalone export inlines everything it references into one HTML file.
   *
   * The specifiers must stay literal for the bundler to see them.
   */
  load: () => Promise<Record<string, unknown>>;
  /**
   * The text fonts this face was designed to sit beside, if any.
   *
   * Math is normally scaled so its x-height matches the text font's, because
   * a MathJax package and a text face that were never drawn together agree on
   * the em and on nothing else. A face named here was drawn against that text
   * font, so the scaling is switched off: newtxmath's own x-height parameter
   * is 0.441 against Libertinus Serif's 0.429, and "correcting" that 2.7%
   * would shrink every formula below the size the paper sets it at.
   */
  designedFor?: readonly string[];
}

/**
 * MathJax 4's published font packages, each `@mathjax/mathjax-<id>-font`.
 *
 * `mathjax-euler` is deliberately absent: it is a font *extension* (it layers
 * onto whichever font is selected via `fontExtensions`), not a complete font,
 * so it does not belong in a list of choices.
 *
 * Libertinus is also absent — MathJax publishes no Libertinus package, so its
 * data would have to be generated from LibertinusMath-Regular.otf first. It
 * would not close the gap anyway: measured against acmart, Libertinus gets the
 * display integral's height right and its width 44% wrong.
 */
export const MATH_FONTS = [
  {
    id: 'mathjax-newtx',
    label: 'newtxmath (ACM / SIGGRAPH)',
    blurb: "acmart's own math face, generated from newtxmath's outlines and metrics.",
    load: MATH_FONT_MODULES['mathjax-newtx'],
    // newtxmath in its libertine mode is drawn against Libertine — the T
    // faces are acmart's own, Libertinus Serif is Libertine's maintained fork.
    designedFor: ['Linux Libertine T', 'Linux Biolinum T', 'Libertinus Serif'],
  },
  {
    id: 'mathjax-newcm',
    label: 'New Computer Modern',
    blurb: "MathJax 4's default; the classic TeX look.",
    load: MATH_FONT_MODULES['mathjax-newcm'],
  },
  {
    id: 'mathjax-tex',
    label: 'TeX',
    blurb: 'The face MathJax 3 shipped — matches older exports.',
    load: MATH_FONT_MODULES['mathjax-tex'],
  },
  {
    id: 'mathjax-modern',
    label: 'MathJax Modern',
    blurb: 'Latin Modern lineage; lighter than New Computer Modern.',
    load: MATH_FONT_MODULES['mathjax-modern'],
  },
  {
    id: 'mathjax-stix2',
    label: 'STIX Two',
    blurb: 'Scientific-publishing standard; the closest match to acmart/SIGGRAPH.',
    load: MATH_FONT_MODULES['mathjax-stix2'],
  },
  {
    id: 'mathjax-termes',
    label: 'TeX Gyre Termes',
    blurb: 'Times clone; sets italic Greek wider than newtxmath does.',
    load: MATH_FONT_MODULES['mathjax-termes'],
  },
  {
    id: 'mathjax-pagella',
    label: 'TeX Gyre Pagella',
    blurb: 'Palatino clone; wider, calligraphic.',
    load: MATH_FONT_MODULES['mathjax-pagella'],
  },
  {
    id: 'mathjax-bonum',
    label: 'TeX Gyre Bonum',
    blurb: 'Bookman clone; heavy, high contrast.',
    load: MATH_FONT_MODULES['mathjax-bonum'],
  },
  {
    id: 'mathjax-schola',
    label: 'TeX Gyre Schola',
    blurb: 'Century Schoolbook clone; large x-height.',
    load: MATH_FONT_MODULES['mathjax-schola'],
  },
  {
    id: 'mathjax-dejavu',
    label: 'DejaVu',
    blurb: 'Sans math; pairs with a sans body face.',
    load: MATH_FONT_MODULES['mathjax-dejavu'],
  },
  {
    id: 'mathjax-fira',
    label: 'Fira',
    blurb: 'Sans math with a humanist feel.',
    load: MATH_FONT_MODULES['mathjax-fira'],
  },
  {
    id: 'mathjax-asana',
    label: 'Asana Math',
    blurb: 'Palatino-compatible with very wide symbol coverage.',
    load: MATH_FONT_MODULES['mathjax-asana'],
  },
] as const satisfies readonly MathFontDef[];

export type MathFontId = (typeof MATH_FONTS)[number]['id'];

/** Used when an element names no math font and its text font names none.
 *  Matches MathJax 4's own default. */
export const DEFAULT_MATH_FONT: MathFontId = 'mathjax-newcm';

// ─────────────────────────────────────────────────────────────────────────────
// Lookup
// ─────────────────────────────────────────────────────────────────────────────

const TEXT_BY_ID = new Map<string, TextFontDef>(TEXT_FONTS.map((f) => [f.id, f]));
const MATH_BY_ID = new Map<string, MathFontDef>(MATH_FONTS.map((f) => [f.id, f]));

/**
 * Resolve a stored family name to a bundled face.
 *
 * Decks predating the registry store CSS names we never shipped outline data
 * for ('Arial', 'Helvetica', …) and were already rendered as the default face;
 * they resolve to it explicitly rather than failing.
 */
export function textFont(id: string | undefined): TextFontDef {
  return (id && TEXT_BY_ID.get(id)) || TEXT_BY_ID.get(DEFAULT_TEXT_FONT)!;
}

export function mathFont(id: string | undefined): MathFontDef {
  return (id && MATH_BY_ID.get(id)) || MATH_BY_ID.get(DEFAULT_MATH_FONT)!;
}

/** True when this family is one we ship outline data for. */
export function isBundledTextFont(id: string | undefined): boolean {
  return !!id && TEXT_BY_ID.has(id);
}

/**
 * The math font an element should render with: its own choice, else the one
 * its text font pairs with. Keeps prose and equations in step by default
 * while still allowing a deliberate mismatch.
 */
export function resolveMathFont(
  fontFamily: string | undefined,
  mathFontId: string | undefined,
): MathFontDef {
  if (mathFontId && MATH_BY_ID.has(mathFontId)) return MATH_BY_ID.get(mathFontId)!;
  return mathFont(textFont(fontFamily).defaultMathFont);
}

/** Every attribution we are obliged to carry, for the licence notice file. */
export function fontNotices(): string[] {
  return TEXT_FONTS.map((f) => f.notice);
}

/** Load a math font's SVG data class, by convention its single export. */
export async function loadMathFontData(id: string | undefined): Promise<unknown> {
  const mod = await mathFont(id).load();
  // Each package exports exactly one class, named MathJax<Name>Font.
  const cls = Object.entries(mod).find(([k, v]) => k.startsWith('MathJax') && typeof v === 'function');
  if (!cls) throw new Error(`Math font ${mathFont(id).id} exported no font class`);
  return cls[1];
}

// ─────────────────────────────────────────────────────────────────────────────
// Dynamic glyph ranges
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Families offered in the pickers. Never hand-listed: only a bundled face can
 * be rendered as outlines, so advertising a system family would promise
 * something the renderer cannot deliver.
 */
export const FONT_FAMILIES: readonly string[] = TEXT_FONTS.map((f) => f.id);

/**
 * CSS stack that actually renders in the bundled bytes.
 *
 * `injectFontFaces` registers each face under an "<id> Edit" alias, so asking
 * for the bare family name can be answered by a system copy at a different
 * version — or by nothing at all. Anything that must look like the renderer
 * (the edit overlay, picker specimens) asks for this.
 */
export function fontStack(id: string | undefined): string {
  const font = textFont(id);
  return `'${font.id} Edit', ${font.cssStack}`;
}
