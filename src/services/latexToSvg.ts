/**
 * Converts LaTeX to pure SVG via MathJax 4.
 *
 * MathJax is loaded lazily via dynamic import() on first use, and so is each
 * font package, so a deck only pays for the math fonts it actually uses.
 *
 * Output shape: `SVG({ fontCache: 'local' })` emits each glyph once as a
 * `<path>` in `<defs>` plus `<use>` placements. There is no `font-family`
 * anywhere in the result — the outlines come from the font's compiled-in data
 * and the positions from its metrics. That is why the math font cannot be
 * changed with CSS, and why it has to be part of every cache key here.
 *
 * One font per output jax: MathJax takes a single `fontData` per instance, so
 * selectable fonts means one document per font rather than one document.
 *
 * Lifted from doeringchristian/inkwell, then migrated from mathjax-full 3 to
 * @mathjax/src 4 — which is ESM, so the eval('require') patch that vanilla
 * mathjax-full needed under Vite (scripts/patch-mathjax.cjs) is gone.
 */

import { loadMathFontData, loadMathFontRange, mathFont } from '../utils/text/fontRegistry';

// MathJax's types are not exported in a usable form for our subset of imports;
// the document type is treated as opaque here.
type MJDocument = {
  adaptor: { innerHTML: (node: unknown) => string };
  convert: (input: string, options: { display: boolean }) => unknown;
};

/** A document plus the retry driver that belongs to it.
 *
 *  A conversion is not a pure function: when the expression needs a glyph
 *  range the font has not loaded yet, MathJax aborts it by THROWING a retry
 *  signal carrying the load promise. `handleRetriesFor` is what turns that
 *  into "await the range, then run the conversion again from the top" — so
 *  the whole convert must sit inside it, and the async entry point is the
 *  only one that can serve a range it does not already have. */
type MathJaxInstance = {
  doc: MJDocument;
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

/** One document per font id; each holds that font's data and glyph cache. */
const docs = new Map<string, MathJaxInstance>();
const pending = new Map<string, Promise<MathJaxInstance>>();

async function buildDocument(fontId: string): Promise<MathJaxInstance> {
  const [
    { mathjax },
    { TeX },
    { SVG },
    { liteAdaptor },
    { RegisterHTMLHandler },
    fontData,
  ] = await Promise.all([
    import('@mathjax/src/mjs/mathjax.js'),
    import('@mathjax/src/mjs/input/tex.js'),
    import('@mathjax/src/mjs/output/svg.js'),
    import('@mathjax/src/mjs/adaptors/liteAdaptor.js'),
    import('@mathjax/src/mjs/handlers/html.js'),
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
  // Registering the handler twice is harmless — MathJax keeps one per adaptor —
  // but the adaptor itself must be per-document to keep glyph ids distinct.
  const adaptor = liteAdaptor();
  RegisterHTMLHandler(adaptor);
  const tex = new TeX({ packages: TEX_PACKAGES });
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
    retry: (mathjax as unknown as { handleRetriesFor: <T>(fn: () => T) => Promise<T> }).handleRetriesFor,
  };
}

/** Resolve (and remember) the document for a font, loading it on first use. */
function ensureMathJax(fontId?: string): Promise<MathJaxInstance> {
  const id = mathFont(fontId).id;
  const ready = docs.get(id);
  if (ready) return Promise.resolve(ready);
  const inFlight = pending.get(id);
  if (inFlight) return inFlight;
  const p = buildDocument(id).then((doc) => {
    docs.set(id, doc);
    pending.delete(id);
    return doc;
  });
  pending.set(id, p);
  // Drop the entry on failure so a retry can rebuild it.
  p.catch(() => pending.delete(id));
  return p;
}

// (fontId, displayMode, texStr) → SVG fragment. Survives the session.
// The font MUST be part of the key: an equation rendered once would otherwise
// come back with the previous font's outlines when the font changes.
const texCache = new Map<string, string>();

const cacheKey = (fontId: string, texStr: string, displayMode: boolean) =>
  `${fontId}:${displayMode ? 'D' : 'I'}:${texStr}`;

/** Serialise one conversion. Safe only when every glyph range the expression
 *  needs is already resident — otherwise it aborts partway through (the sync
 *  entry point catches that) or, under `retry`, accumulates partial renders.
 *  The greedy body match is correct for the single top-level <svg> this
 *  produces: MathJax nests further <svg> elements for stretchy delimiters,
 *  and they belong to the body. */
function convertOnce(doc: MJDocument, texStr: string, displayMode: boolean): string {
  const raw = doc.adaptor.innerHTML(doc.convert(texStr, { display: displayMode }));
  const m = raw.match(/<svg([^>]*)>([\s\S]*)<\/svg>/);
  return m ? `<svg${m[1]}>${m[2]}</svg>` : raw;
}

/**
 * Just the math part. Renders a single TeX expression (no `$` delimiters,
 * just the math body) to an SVG fragment. Used by callers like textLayout
 * that have already split content into math + non-math segments.
 */
export async function texFragmentToSvg(
  texStr: string,
  displayMode: boolean,
  fontId?: string,
): Promise<string> {
  const id = mathFont(fontId).id;
  const key = cacheKey(id, texStr, displayMode);
  const hit = texCache.get(key);
  if (hit) return hit;
  const { doc, retry } = await ensureMathJax(fontId);
  // Pass 1 — warm the glyph ranges, and throw the output away.
  //
  // A conversion that reaches a glyph whose range is not resident ABORTS by
  // throwing a retry signal, and `handleRetriesFor` runs it again once the
  // range arrives. For an expression needing several ranges — the whole point
  // of `\mathcal` next to `\mathfrak` next to `\mathbb` — the result of
  // that loop is not a document, it is a pile: one partial <svg> per attempt,
  // carrying the accumulated glyph cache of the last attempt and the rendered
  // body of the FIRST. Measured on one real expression: 12 <svg> elements,
  // 42 glyphs in <defs>, and an outer viewBox sized to the single character
  // that happened to render before the first abort.
  //
  // So only the side effect of this pass is wanted.
  await retry(() => doc.convert(texStr, { display: displayMode }));
  // Pass 2 — every range this expression touches is now in memory, so the
  // conversion completes in one attempt and yields exactly one <svg>.
  const result = convertOnce(doc, texStr, displayMode);
  texCache.set(key, result);
  return result;
}

/** Async pre-load so callers can render math synchronously afterwards. */
export function preloadMathJax(fontId?: string): Promise<void> {
  return ensureMathJax(fontId).then(() => undefined);
}

/** True once MathJax has finished its async setup and `texFragmentToSvgSync`
 *  is safe to call. Callers using this for caching keys should invalidate
 *  their cache when this transitions from false → true. */
export function isMathJaxReady(fontId?: string): boolean {
  return docs.has(mathFont(fontId).id);
}

/** Synchronous form of `texFragmentToSvg`. Returns `null` when MathJax
 *  hasn't loaded yet — caller should fall back (e.g. KaTeX) until then. */
export function texFragmentToSvgSync(
  texStr: string,
  displayMode: boolean,
  fontId?: string,
): string | null {
  const id = mathFont(fontId).id;
  const key = cacheKey(id, texStr, displayMode);
  const hit = texCache.get(key);
  if (hit) return hit;
  const instance = docs.get(id);
  if (!instance) return null;
  try {
    const result = convertOnce(instance.doc, texStr, displayMode);
    texCache.set(key, result);
    return result;
  } catch {
    // A glyph range is still missing. Loading it is asynchronous by nature,
    // so this call cannot produce the expression — the async path will, and
    // the result lands in the cache for the next frame. Reporting null is
    // what keeps a half-rendered expression off the canvas.
    return null;
  }
}

export function clearLatexCache(): void {
  texCache.clear();
}
