/**
 * Every font BYTE the app can load, behind one import.
 *
 * `fontRegistry` says which faces exist and what pairs with what; this says
 * where their data comes from. The split exists so a build can swap the data
 * out while the registry — and everything that reads it — stays identical.
 *
 * That matters because of what a presentation export actually needs. Exports
 * bake text: `bakeLayouts` walks every text element on every slide and embeds
 * the resolved glyph outlines as data, so the viewer draws paths it was
 * handed rather than parsing a font or running TeX. It therefore needs none
 * of this — yet it was carrying all of it: eight text faces, eleven MathJax
 * font packages, and the ~40 lazily-loaded glyph ranges behind each one, for
 * characters no slide in the deck contains. `vite.config.viewer.ts` aliases
 * this module to `fontSources.viewer.ts`, which has the same shape and no
 * payload, and that is the whole mechanism.
 *
 * The editor and the editable standalone export use this file unchanged: they
 * can be typed into, so they need live layout, so they need the real fonts.
 */

import interRegularUrl from '../../assets/fonts/Inter-Regular.ttf';
import interBoldUrl from '../../assets/fonts/Inter-Bold.ttf';
import interItalicUrl from '../../assets/fonts/Inter-Italic.ttf';
import interBoldItalicUrl from '../../assets/fonts/Inter-BoldItalic.ttf';
import libertinusRegularUrl from '../../assets/fonts/LibertinusSerif-Regular.otf';
import libertinusBoldUrl from '../../assets/fonts/LibertinusSerif-Bold.otf';
import libertinusItalicUrl from '../../assets/fonts/LibertinusSerif-Italic.otf';
import libertinusBoldItalicUrl from '../../assets/fonts/LibertinusSerif-BoldItalic.otf';
// Generated from acmart's own Type 1 fonts and TeX metrics by
// `npm run build:texfont` — see scripts/texfont/build.mjs.
import libertineRegularUrl from '../../assets/fonts/LinuxLibertineT-Regular.otf';
import libertineBoldUrl from '../../assets/fonts/LinuxLibertineT-Bold.otf';
import libertineItalicUrl from '../../assets/fonts/LinuxLibertineT-Italic.otf';
import libertineBoldItalicUrl from '../../assets/fonts/LinuxLibertineT-BoldItalic.otf';
import biolinumRegularUrl from '../../assets/fonts/LinuxBiolinumT-Regular.otf';
import biolinumBoldUrl from '../../assets/fonts/LinuxBiolinumT-Bold.otf';
import biolinumItalicUrl from '../../assets/fonts/LinuxBiolinumT-Italic.otf';
import biolinumBoldItalicUrl from '../../assets/fonts/LinuxBiolinumT-BoldItalic.otf';

/** Font files per text-font id, in the four variants every face must provide. */
export const TEXT_FONT_FILES = {
  'Inter': {
    regular: interRegularUrl,
    bold: interBoldUrl,
    italic: interItalicUrl,
    boldItalic: interBoldItalicUrl,
  },
  'Libertinus Serif': {
    regular: libertinusRegularUrl,
    bold: libertinusBoldUrl,
    italic: libertinusItalicUrl,
    boldItalic: libertinusBoldItalicUrl,
  },
  'Linux Libertine T': {
    regular: libertineRegularUrl,
    bold: libertineBoldUrl,
    italic: libertineItalicUrl,
    boldItalic: libertineBoldItalicUrl,
  },
  'Linux Biolinum T': {
    regular: biolinumRegularUrl,
    bold: biolinumBoldUrl,
    italic: biolinumItalicUrl,
    boldItalic: biolinumBoldItalicUrl,
  },
};

/**
 * The SVG data module for each math font, loaded on first use.
 *
 * Keyed by the same ids `MATH_FONTS` declares; `fontRegistry.test.ts` checks
 * that neither list can drift ahead of the other.
 */
export const MATH_FONT_MODULES: Record<string, () => Promise<Record<string, unknown>>> = {
  // Generated from newtxmath by `npm run build:mathfont`, not published by
  // MathJax — see `newtxFont.ts` for why it cannot be.
  'mathjax-newtx': () => import('./newtxFont'),
  'mathjax-newcm': () => import('@mathjax/mathjax-newcm-font/js/svg.js'),
  'mathjax-tex': () => import('@mathjax/mathjax-tex-font/js/svg.js'),
  'mathjax-modern': () => import('@mathjax/mathjax-modern-font/js/svg.js'),
  'mathjax-stix2': () => import('@mathjax/mathjax-stix2-font/js/svg.js'),
  'mathjax-termes': () => import('@mathjax/mathjax-termes-font/js/svg.js'),
  'mathjax-pagella': () => import('@mathjax/mathjax-pagella-font/js/svg.js'),
  'mathjax-bonum': () => import('@mathjax/mathjax-bonum-font/js/svg.js'),
  'mathjax-schola': () => import('@mathjax/mathjax-schola-font/js/svg.js'),
  'mathjax-dejavu': () => import('@mathjax/mathjax-dejavu-font/js/svg.js'),
  'mathjax-fira': () => import('@mathjax/mathjax-fira-font/js/svg.js'),
  'mathjax-asana': () => import('@mathjax/mathjax-asana-font/js/svg.js'),
};

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
 * normally. The glob covers exactly the packages `MATH_FONT_MODULES` names.
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
