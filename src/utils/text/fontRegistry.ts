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
    defaultMathFont: 'mathjax-modern',
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
    // its libertine mode. Libertinus Math is the closest faithful match.
    defaultMathFont: 'mathjax-libertinus',
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
  /** Stored in `TextStyle.mathFont`; also the MathJax `output.font` value. */
  id: string;
  label: string;
  /** False for fonts we build and vendor ourselves rather than install. */
  official: boolean;
  /** Short note for the picker: what this face is for. */
  blurb: string;
}

/**
 * MathJax 4's ten published packages plus the one we build ourselves.
 *
 * `@mathjax/mathjax-<name>-font` is the npm package for every `official`
 * entry. `mathjax-libertinus` is vendored: MathJax publishes no Libertinus
 * package, so its data is generated from LibertinusMath-Regular.otf.
 */
export const MATH_FONTS = [
  { id: 'mathjax-modern', label: 'New Computer Modern', official: true, blurb: "MathJax 4's default; the classic TeX look." },
  { id: 'mathjax-tex', label: 'TeX (MathJax 3)', official: true, blurb: 'The face MathJax 3 shipped — matches older exports.' },
  { id: 'mathjax-stix2', label: 'STIX Two', official: true, blurb: 'Scientific-publishing standard; pairs with Times-like serifs.' },
  { id: 'mathjax-termes', label: 'TeX Gyre Termes', official: true, blurb: 'Times clone; close to newtxmath in acmart.' },
  { id: 'mathjax-pagella', label: 'TeX Gyre Pagella', official: true, blurb: 'Palatino clone; wider, calligraphic.' },
  { id: 'mathjax-bonum', label: 'TeX Gyre Bonum', official: true, blurb: 'Bookman clone; heavy, high contrast.' },
  { id: 'mathjax-schola', label: 'TeX Gyre Schola', official: true, blurb: 'Century Schoolbook clone; large x-height.' },
  { id: 'mathjax-dejavu', label: 'DejaVu', official: true, blurb: 'Sans math; pairs with a sans body face.' },
  { id: 'mathjax-fira', label: 'Fira', official: true, blurb: 'Sans math with a humanist feel.' },
  { id: 'mathjax-asana', label: 'Asana Math', official: true, blurb: 'Palatino-compatible with very wide symbol coverage.' },
  {
    id: 'mathjax-libertinus',
    label: 'Libertinus Math',
    official: false,
    blurb: 'Matches Libertinus Serif — the SIGGRAPH pairing.',
  },
] as const satisfies readonly MathFontDef[];

export type MathFontId = (typeof MATH_FONTS)[number]['id'];

/** Used when an element names no math font and its text font names none. */
export const DEFAULT_MATH_FONT: MathFontId = 'mathjax-modern';

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

/**
 * Families offered in the pickers. Never hand-listed: only a bundled face can
 * be rendered as outlines, so advertising a system family would promise
 * something the renderer cannot deliver.
 */
export const FONT_FAMILIES: readonly string[] = TEXT_FONTS.map((f) => f.id);
