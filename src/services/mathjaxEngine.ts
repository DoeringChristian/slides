/**
 * Loading MathJax, behind one import.
 *
 * Everything that pulls `@mathjax/src` into the bundle lives here — the
 * engine, the TeX packages, the output jax — so a build that cannot need it
 * can drop it by aliasing this module instead of by hoping a tree-shaker
 * reaches the same conclusion. `vite.config.viewer.ts` does exactly that: a
 * presentation export draws outlines baked at export time, so it never runs
 * TeX, and the ~30 MB of MathJax glyph data it was carrying had nothing to
 * render. The editor and the editable standalone export use this file.
 *
 * `latexToSvg` keeps the caching, wrapping and conversion logic and asks this
 * module only for a configured document.
 */

import { loadMathFontData, loadMathFontRange } from '../utils/text/fontRegistry';
import { installScriptSizes } from './mathjaxScriptSizes';
import { fontTexPackage, type FontTexConfig } from './mathjaxFontTex';

// MathJax's types are not exported in a usable form for our subset of imports;
// the document type is treated as opaque here.
export type MJDocument = {
  adaptor: {
    innerHTML: (node: unknown) => string;
    outerHTML: (node: unknown) => string;
    childNodes: (node: unknown) => unknown[];
    kind: (node: unknown) => string;
  };
  convert: (input: string, options: { display: boolean }) => unknown;
};

/** The output jax's mutable options, the only way to vary line breaking per
 *  expression — they are constructor options, but read at conversion time. */
export type MJOutput = {
  options: {
    displayOverflow: string;
    linebreaks: { inline: boolean; width: string };
  };
  /** The loaded font's own metrics. `params.x_height` is in em and is what
   *  the layout scales math by so it matches the text font's x-height. */
  font: { params: { x_height: number } };
};

/** A document plus the retry driver that belongs to it.
 *
 *  A conversion is not a pure function: when the expression needs a glyph
 *  range the font has not loaded yet, MathJax aborts it by THROWING a retry
 *  signal carrying the load promise. `handleRetriesFor` is what turns that
 *  into "await the range, then run the conversion again from the top" — so
 *  the whole convert must sit inside it, and the async entry point is the
 *  only one that can serve a range it does not already have. */
export type MathJaxInstance = {
  doc: MJDocument;
  svg: MJOutput;
  retry: <T>(fn: () => T) => Promise<T>;
};

/**
 * TeX extensions registered on the input jax.
 *
 * `noundefined` means an unknown macro does not fail — it renders as its own
 * name in red, which is why a missing extension looks like a font problem
 * rather than an error. `\boldsymbol` was exactly that: nine glyphs spelling
 * "boldsymbol" instead of a bold omega. These are the extensions a technical
 * deck actually reaches for; `physics` is deliberately absent because it
 * redefines `\bra`/`\ket` and would fight `braket`.
 */
const TEX_PACKAGES = [
  'base', 'ams', 'newcommand', 'noerrors', 'noundefined',
  'boldsymbol', 'braket', 'cancel', 'color', 'mathtools',
  'textmacros', 'unicode', 'upgreek', 'amscd', 'enclose',
];

export async function buildMathJaxDocument(fontId: string): Promise<MathJaxInstance> {
  const [
    { mathjax },
    { TeX },
    { SVG },
    { liteAdaptor },
    { RegisterHTMLHandler },
    { CommonWrapper },
    fontData,
  ] = await Promise.all([
    import('@mathjax/src/mjs/mathjax.js'),
    import('@mathjax/src/mjs/input/tex.js'),
    import('@mathjax/src/mjs/output/svg.js'),
    import('@mathjax/src/mjs/adaptors/liteAdaptor.js'),
    import('@mathjax/src/mjs/handlers/html.js'),
    import('@mathjax/src/mjs/output/common/Wrapper.js'),
    loadMathFontData(fontId),
    // Side-effect imports: register TeX packages
    import('@mathjax/src/mjs/input/tex/base/BaseConfiguration.js'),
    import('@mathjax/src/mjs/input/tex/ams/AmsConfiguration.js'),
    import('@mathjax/src/mjs/input/tex/newcommand/NewcommandConfiguration.js'),
    import('@mathjax/src/mjs/input/tex/noerrors/NoErrorsConfiguration.js'),
    import('@mathjax/src/mjs/input/tex/noundefined/NoUndefinedConfiguration.js'),
    import('@mathjax/src/mjs/input/tex/boldsymbol/BoldsymbolConfiguration.js'),
    import('@mathjax/src/mjs/input/tex/braket/BraketConfiguration.js'),
    import('@mathjax/src/mjs/input/tex/cancel/CancelConfiguration.js'),
    import('@mathjax/src/mjs/input/tex/color/ColorConfiguration.js'),
    import('@mathjax/src/mjs/input/tex/mathtools/MathtoolsConfiguration.js'),
    import('@mathjax/src/mjs/input/tex/textmacros/TextMacrosConfiguration.js'),
    import('@mathjax/src/mjs/input/tex/unicode/UnicodeConfiguration.js'),
    import('@mathjax/src/mjs/input/tex/upgreek/UpgreekConfiguration.js'),
    import('@mathjax/src/mjs/input/tex/amscd/AmsCdConfiguration.js'),
    import('@mathjax/src/mjs/input/tex/enclose/EncloseConfiguration.js'),
  ]);
  // Without this hook MathJax cannot fetch a glyph range and aborts every
  // expression that needs one. It is global state on the mathjax singleton,
  // so it must be in place before the first conversion of the first font.
  (mathjax as unknown as { asyncLoad: (name: string) => Promise<unknown> }).asyncLoad = loadMathFontRange;
  // TeX's script sizes and script designs, for the fonts that declare them.
  installScriptSizes(CommonWrapper);
  // Registering the handler twice is harmless — MathJax keeps one per adaptor —
  // but the adaptor itself must be per-document to keep glyph ids distinct.
  const adaptor = liteAdaptor();
  RegisterHTMLHandler(adaptor);
  // The font's own TeX behaviour (\big sizes, \mathbf), when it declares any.
  const fontPackage = await fontTexPackage(fontId, (fontData as { TEX_CONFIG?: FontTexConfig }).TEX_CONFIG);
  const tex = new TeX({ packages: fontPackage ? [...TEX_PACKAGES, fontPackage] : TEX_PACKAGES });
  const svg = new SVG({
    fontCache: 'local',
    fontData: fontData as never,
    // MathJax 4 breaks INLINE math across lines by itself, and expresses that
    // by returning one <svg> per breakable chunk with <mjx-break> markers
    // between them — 12 sibling elements for an expression with a handful of
    // `\,`, `\quad` and binary operators in it. A consumer that reads "the"
    // svg therefore renders only the first chunk, which is exactly how a long
    // expression came out as its first glyph and nothing else.
    //
    // Our own layout engine owns line breaking (it has to: math sits in a
    // line alongside shaped text whose metrics MathJax cannot see), so the
    // whole expression must arrive as ONE svg and be placed as one unit.
    linebreaks: { inline: false },
  });
  return {
    doc: mathjax.document('', { InputJax: tex, OutputJax: svg }) as unknown as MJDocument,
    svg: svg as unknown as MJOutput,
    retry: (mathjax as unknown as { handleRetriesFor: <T>(fn: () => T) => Promise<T> }).handleRetriesFor,
  };
}
