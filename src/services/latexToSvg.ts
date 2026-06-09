/**
 * Converts LaTeX to pure SVG via MathJax.
 *
 * MathJax is loaded lazily via dynamic import() on first use. The patched
 * version.js (see scripts/patch-mathjax.cjs) is what lets this run under
 * Vite — vanilla mathjax-full crashes the browser otherwise.
 *
 * Lifted from doeringchristian/inkwell — only the formatting was changed
 * (quotes + semicolons + TS strict).
 */

// MathJax's types are not exported in a usable form for our subset of imports;
// the document type is treated as opaque here.
type MJDocument = {
  adaptor: { innerHTML: (node: unknown) => string };
  convert: (input: string, options: { display: boolean }) => unknown;
};

let mjDoc: MJDocument | null = null;
let mjReady: Promise<void> | null = null;

const TEX_PACKAGES = ['base', 'ams', 'newcommand', 'noerrors', 'noundefined'];

function ensureMathJax(): Promise<void> {
  if (mjDoc) return Promise.resolve();
  if (mjReady) return mjReady;
  mjReady = (async () => {
    const [
      { mathjax },
      { TeX },
      { SVG },
      { liteAdaptor },
      { RegisterHTMLHandler },
    ] = await Promise.all([
      import('mathjax-full/js/mathjax.js'),
      import('mathjax-full/js/input/tex.js'),
      import('mathjax-full/js/output/svg.js'),
      import('mathjax-full/js/adaptors/liteAdaptor.js'),
      import('mathjax-full/js/handlers/html.js'),
      // Side-effect imports: register TeX packages
      import('mathjax-full/js/input/tex/base/BaseConfiguration.js'),
      import('mathjax-full/js/input/tex/ams/AmsConfiguration.js'),
      import('mathjax-full/js/input/tex/newcommand/NewcommandConfiguration.js'),
      import('mathjax-full/js/input/tex/noerrors/NoErrorsConfiguration.js'),
      import('mathjax-full/js/input/tex/noundefined/NoUndefinedConfiguration.js'),
    ]);
    const adaptor = liteAdaptor();
    RegisterHTMLHandler(adaptor);
    const tex = new TeX({ packages: TEX_PACKAGES });
    const svg = new SVG({ fontCache: 'local' });
    mjDoc = mathjax.document('', { InputJax: tex, OutputJax: svg }) as MJDocument;
  })();
  return mjReady;
}

// (displayMode, texStr) → SVG fragment string. Survives the session.
const texCache = new Map<string, string>();

function texToSvg(texStr: string, displayMode: boolean): string {
  const key = `${displayMode ? 'D' : 'I'}:${texStr}`;
  const hit = texCache.get(key);
  if (hit) return hit;
  if (!mjDoc) throw new Error('latexToSvg: MathJax not initialised — call latexContentToSvg first');

  const adaptor = mjDoc.adaptor;
  const node = mjDoc.convert(texStr, { display: displayMode });
  const raw = adaptor.innerHTML(node);
  const m = raw.match(/<svg([^>]*)>([\s\S]*)<\/svg>/);
  const result = m ? `<svg${m[1]}>${m[2]}</svg>` : raw;
  texCache.set(key, result);
  return result;
}

function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// (content, fontSize, color) → combined SVG fragments string. Used by
// callers that want a ready-to-mount SVG body.
const contentCache = new Map<string, string>();

/**
 * Render content with $/$$ delimiters to SVG.
 * First call loads MathJax (~200ms), subsequent calls are cached and instant.
 */
export async function latexContentToSvg(
  content: string,
  fontSize: number,
  color: string,
): Promise<string> {
  const cacheKey = `${content}|${fontSize}|${color}`;
  const hit = contentCache.get(cacheKey);
  if (hit) return hit;

  await ensureMathJax();

  const parts: { text: string; display: boolean; math: boolean }[] = [];
  const regex = /(\$\$[\s\S]*?\$\$|\$[^$\n]+?\$)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = regex.exec(content)) !== null) {
    if (m.index > last) parts.push({ text: content.slice(last, m.index), display: false, math: false });
    const raw = m[0];
    const isDisp = raw.startsWith('$$') && raw.endsWith('$$');
    parts.push({ text: isDisp ? raw.slice(2, -2) : raw.slice(1, -1), display: isDisp, math: true });
    last = m.index + raw.length;
  }
  if (last < content.length) parts.push({ text: content.slice(last), display: false, math: false });

  if (parts.length === 1 && parts[0].math) {
    const result = texToSvg(parts[0].text, parts[0].display);
    contentCache.set(cacheKey, result);
    return result;
  }

  const svgParts: string[] = [];
  let y = fontSize;
  for (const part of parts) {
    if (part.math) {
      const mathSvg = texToSvg(part.text, part.display);
      svgParts.push(`<g transform="translate(0,${y - fontSize * 0.7})">${mathSvg}</g>`);
      if (part.display) y += fontSize * 2;
    } else {
      for (const line of part.text.split('\n')) {
        if (line.trim()) {
          svgParts.push(`<text x="0" y="${y}" fill="${color}" font-size="${fontSize}" font-family="serif">${escapeXml(line)}</text>`);
        }
        y += fontSize * 1.4;
      }
    }
  }

  const result = svgParts.join('\n');
  contentCache.set(cacheKey, result);
  return result;
}

/**
 * Just the math part. Renders a single TeX expression (no `$` delimiters,
 * just the math body) to an SVG fragment. Used by callers like textLayout
 * that have already split content into math + non-math segments.
 */
export async function texFragmentToSvg(texStr: string, displayMode: boolean): Promise<string> {
  await ensureMathJax();
  return texToSvg(texStr, displayMode);
}

/** Async pre-load so callers can render math synchronously afterwards. */
export function preloadMathJax(): Promise<void> {
  return ensureMathJax();
}

/** True once MathJax has finished its async setup and `texFragmentToSvgSync`
 *  is safe to call. Callers using this for caching keys should invalidate
 *  their cache when this transitions from false → true. */
export function isMathJaxReady(): boolean {
  return mjDoc !== null;
}

/** Synchronous form of `texFragmentToSvg`. Returns `null` when MathJax
 *  hasn't loaded yet — caller should fall back (e.g. KaTeX) until then. */
export function texFragmentToSvgSync(texStr: string, displayMode: boolean): string | null {
  if (!mjDoc) return null;
  return texToSvg(texStr, displayMode);
}

export function clearLatexCache(): void {
  texCache.clear();
  contentCache.clear();
}
