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

import interRegularUrl from '../../assets/fonts/Inter-Regular.ttf';
import interBoldUrl from '../../assets/fonts/Inter-Bold.ttf';
import interItalicUrl from '../../assets/fonts/Inter-Italic.ttf';
import interBoldItalicUrl from '../../assets/fonts/Inter-BoldItalic.ttf';
import libertinusRegularUrl from '../../assets/fonts/LibertinusSerif-Regular.otf';
import libertinusBoldUrl from '../../assets/fonts/LibertinusSerif-Bold.otf';
import libertinusItalicUrl from '../../assets/fonts/LibertinusSerif-Italic.otf';
import libertinusBoldItalicUrl from '../../assets/fonts/LibertinusSerif-BoldItalic.otf';

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
    variants: {
      regular: interRegularUrl,
      bold: interBoldUrl,
      italic: interItalicUrl,
      boldItalic: interBoldItalicUrl,
    },
    // Inter is a UI sans; New Computer Modern is MathJax 4's default and the
    // least surprising partner until a sans math font is registered.
    defaultMathFont: 'mathjax-newcm',
    notice: 'Inter — Copyright (c) 2016 The Inter Project Authors. SIL Open Font License 1.1.',
  },
  {
    id: 'Libertinus Serif',
    label: 'Libertinus Serif',
    cssStack: "'Libertinus Serif', 'Linux Libertine O', Georgia, serif",
    variants: {
      regular: libertinusRegularUrl,
      bold: libertinusBoldUrl,
      italic: libertinusItalicUrl,
      boldItalic: libertinusBoldItalicUrl,
    },
    // The SIGGRAPH pairing: acmart sets Libertine text against newtxmath in
    // its libertine mode. Termes looked like the obvious stand-in — newtxmath
    // is Times-based and Termes is a Times clone — but measuring against a
    // real acmart render says otherwise. Widths in em, LaTeX reference first:
    //
    //              greek run   digits   L/g/R   mean error
    //   acmart        3.667     4.633   1.976        —
    //   STIX Two      3.717     4.950   1.914      3.8%
    //   Termes        4.595     5.000   2.052     12.4%
    //
    // MathJax's Termes sets italic Greek 25% wider than newtxmath does, which
    // is exactly where an equation visibly stops matching the paper it came
    // from. STIX Two is the scientific-publishing face and tracks newtxmath's
    // metrics far more closely, so it is the pairing until Libertinus Math
    // font data is generated. Reproduce with scripts/compare-math-fonts.mjs.
    defaultMathFont: 'mathjax-stix2',
    notice:
      'Libertinus Serif 7.051 — Copyright (c) 2012-2024 The Libertinus Project Authors. '
      + 'SIL Open Font License 1.1. Designed by Philipp H. Poll and Khaled Hosny.',
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
}

/**
 * MathJax 4's published font packages, each `@mathjax/mathjax-<id>-font`.
 *
 * `mathjax-euler` is deliberately absent: it is a font *extension* (it layers
 * onto whichever font is selected via `fontExtensions`), not a complete font,
 * so it does not belong in a list of choices.
 *
 * Libertinus is also absent for now — MathJax publishes no Libertinus package,
 * so its data has to be generated from LibertinusMath-Regular.otf before it
 * can be listed. Until then Libertinus Serif pairs with STIX Two, which
 * measures closest to the newtxmath that acmart actually sets.
 */
export const MATH_FONTS = [
  {
    id: 'mathjax-newcm',
    label: 'New Computer Modern',
    blurb: "MathJax 4's default; the classic TeX look.",
    load: () => import('@mathjax/mathjax-newcm-font/js/svg.js'),
  },
  {
    id: 'mathjax-tex',
    label: 'TeX',
    blurb: 'The face MathJax 3 shipped — matches older exports.',
    load: () => import('@mathjax/mathjax-tex-font/js/svg.js'),
  },
  {
    id: 'mathjax-modern',
    label: 'MathJax Modern',
    blurb: 'Latin Modern lineage; lighter than New Computer Modern.',
    load: () => import('@mathjax/mathjax-modern-font/js/svg.js'),
  },
  {
    id: 'mathjax-stix2',
    label: 'STIX Two',
    blurb: 'Scientific-publishing standard; the closest match to acmart/SIGGRAPH.',
    load: () => import('@mathjax/mathjax-stix2-font/js/svg.js'),
  },
  {
    id: 'mathjax-termes',
    label: 'TeX Gyre Termes',
    blurb: 'Times clone; sets italic Greek wider than newtxmath does.',
    load: () => import('@mathjax/mathjax-termes-font/js/svg.js'),
  },
  {
    id: 'mathjax-pagella',
    label: 'TeX Gyre Pagella',
    blurb: 'Palatino clone; wider, calligraphic.',
    load: () => import('@mathjax/mathjax-pagella-font/js/svg.js'),
  },
  {
    id: 'mathjax-bonum',
    label: 'TeX Gyre Bonum',
    blurb: 'Bookman clone; heavy, high contrast.',
    load: () => import('@mathjax/mathjax-bonum-font/js/svg.js'),
  },
  {
    id: 'mathjax-schola',
    label: 'TeX Gyre Schola',
    blurb: 'Century Schoolbook clone; large x-height.',
    load: () => import('@mathjax/mathjax-schola-font/js/svg.js'),
  },
  {
    id: 'mathjax-dejavu',
    label: 'DejaVu',
    blurb: 'Sans math; pairs with a sans body face.',
    load: () => import('@mathjax/mathjax-dejavu-font/js/svg.js'),
  },
  {
    id: 'mathjax-fira',
    label: 'Fira',
    blurb: 'Sans math with a humanist feel.',
    load: () => import('@mathjax/mathjax-fira-font/js/svg.js'),
  },
  {
    id: 'mathjax-asana',
    label: 'Asana Math',
    blurb: 'Palatino-compatible with very wide symbol coverage.',
    load: () => import('@mathjax/mathjax-asana-font/js/svg.js'),
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
 * A MathJax 4 font is NOT one module. The package's `svg.js` carries the
 * common variants (roman, italic, bold, the operator sizes) and leaves ~40
 * further ranges — calligraphic, script, fraktur, double-struck, accents,
 * large delimiters, the alphabets — in `svg/dynamic/*.js`, to be fetched at
 * render time. MathJax asks for them BY MODULE SPECIFIER through
 * `mathjax.asyncLoad`, and if that hook is unset it throws
 * "MathJax retry -- an asynchronous action is required".
 *
 * So the base ranges rendered and everything else failed: `x^2`, `\frac` and
 * `\sum` worked while `\mathcal`, `\mathscr`, `\mathfrak`, `\mathbb`,
 * `\boldsymbol` and `\left\langle` fell back to red source text. A single
 * such token anywhere in an expression fails the whole expression.
 *
 * A bare specifier resolves in neither the browser nor a Vite build, so the
 * resolution is handed to the bundler: each range becomes its own lazy chunk,
 * and the range modules' own relative imports (`../../svg.js`) resolve
 * normally. This lives beside the font definitions because that is what it
 * is — the glob covers exactly the packages MATH_FONTS names.
 */
const DYNAMIC_RANGES = import.meta.glob<Record<string, unknown>>(
  '/node_modules/@mathjax/*/mjs/svg/dynamic/*.js',
);

/**
 * Resolve one dynamic range module for MathJax.
 *
 * The specifier looks like
 * `@mathjax/mathjax-newcm-font/js/svg/dynamic/calligraphic.js` — `js/` is the
 * package's own export alias for `mjs/`, which is what exists on disk and
 * therefore what the glob keys use.
 */
export function loadMathFontRange(specifier: string): Promise<unknown> {
  const parts = specifier.match(/(@mathjax\/[^/]+)\/(?:js|mjs)\/svg\/dynamic\/([^/]+?)(?:\.js)?$/);
  const load = parts && DYNAMIC_RANGES[`/node_modules/${parts[1]}/mjs/svg/dynamic/${parts[2]}.js`];
  return load
    ? load()
    : Promise.reject(new Error(`No such MathJax font range: ${specifier}`));
}

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
