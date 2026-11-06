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

import { loadMathFontData, mathFont } from '../utils/text/fontRegistry';

// MathJax's types are not exported in a usable form for our subset of imports;
// the document type is treated as opaque here.
type MJDocument = {
  adaptor: { innerHTML: (node: unknown) => string };
  convert: (input: string, options: { display: boolean }) => unknown;
};

const TEX_PACKAGES = ['base', 'ams', 'newcommand', 'noerrors', 'noundefined'];

/** One document per font id; each holds that font's data and glyph cache. */
const docs = new Map<string, MJDocument>();
const pending = new Map<string, Promise<MJDocument>>();

async function buildDocument(fontId: string): Promise<MJDocument> {
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
  ]);
  // Registering the handler twice is harmless — MathJax keeps one per adaptor —
  // but the adaptor itself must be per-document to keep glyph ids distinct.
  const adaptor = liteAdaptor();
  RegisterHTMLHandler(adaptor);
  const tex = new TeX({ packages: TEX_PACKAGES });
  const svg = new SVG({
    fontCache: 'local',
    fontData: fontData as never,
  });
  return mathjax.document('', { InputJax: tex, OutputJax: svg }) as unknown as MJDocument;
}

/** Resolve (and remember) the document for a font, loading it on first use. */
function ensureMathJax(fontId?: string): Promise<MJDocument> {
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

function texToSvg(doc: MJDocument, fontId: string, texStr: string, displayMode: boolean): string {
  const key = `${fontId}:${displayMode ? 'D' : 'I'}:${texStr}`;
  const hit = texCache.get(key);
  if (hit) return hit;

  const adaptor = doc.adaptor;
  const node = doc.convert(texStr, { display: displayMode });
  const raw = adaptor.innerHTML(node);
  const m = raw.match(/<svg([^>]*)>([\s\S]*)<\/svg>/);
  const result = m ? `<svg${m[1]}>${m[2]}</svg>` : raw;
  texCache.set(key, result);
  return result;
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
  const doc = await ensureMathJax(fontId);
  return texToSvg(doc, mathFont(fontId).id, texStr, displayMode);
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
  const doc = docs.get(id);
  if (!doc) return null;
  return texToSvg(doc, id, texStr, displayMode);
}

export function clearLatexCache(): void {
  texCache.clear();
}
