/**
 * Let a plain Node run import the app's math renderer.
 *
 * The comparison harness wants the real `latexToSvg` — the same MathJax setup,
 * the same font data, the same conversion the editor performs — but that chain
 * reaches `fontSources`, which is Vite-only: it imports font files as URLs and
 * enumerates MathJax's lazy glyph ranges with `import.meta.glob`. Node has
 * neither.
 *
 * `fontSources` is already the module this project swaps for exactly this kind
 * of reason — `vite.config.viewer.ts` aliases it to `fontSources.viewer.ts` to
 * drop the bytes from an export. This is the same substitution for a different
 * host: a same-shaped module with no text-font payload and real math fonts,
 * so everything above it (`fontRegistry`, `mathjaxEngine`, `latexToSvg`) is
 * the app's own code, unmodified.
 *
 * Use with: `npx tsx --import ./scripts/mathfont/asset-stub.mjs <script>`
 */

import { registerHooks } from 'node:module';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const NEWTX = pathToFileURL(resolve(HERE, '../../src/utils/text/newtxFont.ts')).href;

const ASSET = /\.(ttf|otf|woff2?|eot|png|jpe?g|gif|webp|svg)$/i;
const FONT_SOURCES = /src\/utils\/text\/fontSources\.ts$/;

/** The published packages, by the ids `fontRegistry` declares. */
const PUBLISHED = ['newcm', 'tex', 'modern', 'stix2', 'termes', 'pagella', 'bonum', 'schola', 'dejavu', 'fira', 'asana'];

const STUB = `
export const TEXT_FONT_FILES = {
  'Inter': { regular: '', bold: '', italic: '', boldItalic: '' },
  'Libertinus Serif': { regular: '', bold: '', italic: '', boldItalic: '' },
  'Linux Libertine T': { regular: '', bold: '', italic: '', boldItalic: '' },
  'Linux Biolinum T': { regular: '', bold: '', italic: '', boldItalic: '' },
};
export const MATH_FONT_MODULES = {
  'mathjax-newtx': () => import(${JSON.stringify(NEWTX)}),
${PUBLISHED.map((n) => `  'mathjax-${n}': () => import('@mathjax/mathjax-${n}-font/mjs/svg.js'),`).join('\n')}
};
export function loadMathFontRange(specifier) {
  const m = specifier.match(/(@mathjax\\/[^/]+)\\/(?:js|mjs)\\/svg\\/dynamic\\/([^/]+?)(?:\\.js)?$/);
  if (!m) return Promise.reject(new Error('No such MathJax font range: ' + specifier));
  return import(m[1] + '/mjs/svg/dynamic/' + m[2] + '.js');
}
`;

registerHooks({
  // opentype.js's package entry is CommonJS under Node, which has no named
  // `parse` export; the app imports it by name, as Vite's ESM build allows.
  resolve(specifier, context, nextResolve) {
    if (specifier === 'opentype.js') {
      return nextResolve(resolve(HERE, '../../node_modules/opentype.js/dist/opentype.mjs'), context);
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    let pathname;
    try { pathname = new URL(url).pathname; } catch { pathname = url; }
    if (FONT_SOURCES.test(pathname)) {
      return { format: 'module', shortCircuit: true, source: STUB };
    }
    if (ASSET.test(pathname)) {
      return { format: 'module', shortCircuit: true, source: `export default ${JSON.stringify(url)};` };
    }
    return nextLoad(url, context);
  },
});
