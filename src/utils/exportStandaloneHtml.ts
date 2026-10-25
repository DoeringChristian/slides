import type { Presentation } from '../types/presentation';
import { embedResources } from './embedResources';
import { SLIDES_PAYLOAD_ID } from './standaloneBoot';

const PAYLOAD_SENTINEL = '<!--SLIDES_PAYLOAD-->';

export type StandaloneExportMode = 'editor' | 'viewer';

interface ExportOpts {
  mode: StandaloneExportMode;
  editorOrigin?: string;
}

function templateUrlFor(mode: StandaloneExportMode): string {
  const file = mode === 'viewer' ? 'viewer-template.html' : 'standalone-template.html';
  return `${import.meta.env.BASE_URL}${file}`;
}

function buildCmdFor(mode: StandaloneExportMode): string {
  return mode === 'viewer' ? 'npm run build:viewer' : 'npm run build:standalone';
}

// Fetch the standalone HTML template — either freshly built (editor running on localhost
// or production) or grabbed from the current document (when this editor is itself
// running inside a standalone HTML).
async function loadTemplate(mode: StandaloneExportMode): Promise<string> {
  // If we're already inside a standalone HTML, reuse the page itself as the template.
  // (Only the editor flavor can reach this code path — viewer-only bundles don't
  // include the exporter.)
  if (typeof __SLIDES_STANDALONE_BUILD__ !== 'undefined' && __SLIDES_STANDALONE_BUILD__) {
    return reusePageAsTemplate();
  }
  const url = templateUrlFor(mode);
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(
      `Standalone template not available at ${url}. ` +
        `Run \`${buildCmdFor(mode)}\` (dev) or \`npm run build:all\` (prod) first.`,
    );
  }
  return await res.text();
}

// Strip any previously-injected payload so a saved-copy re-injection is clean.
function reusePageAsTemplate(): string {
  // outerHTML omits the doctype; add it back so the saved copy doesn't render in quirks mode.
  const doctype = document.doctype
    ? `<!DOCTYPE ${document.doctype.name}>\n`
    : '<!DOCTYPE html>\n';
  // Do not regex serialized HTML: the compiled exporter itself contains
  // these script-tag strings, and a regex can eat part of the executable bundle.
  const root = document.documentElement.cloneNode(true) as HTMLElement;
  root.querySelectorAll(`script#${SLIDES_PAYLOAD_ID}, script#slides-config`).forEach(node => node.remove());
  root.querySelector('body')!.appendChild(document.createComment('SLIDES_PAYLOAD'));
  return doctype + root.outerHTML;
}

// Escape every '<': HTML raw-text parsing also recognizes </script >,
// </script/> and comment/script states, independently of JSON string quoting.
function safeScriptJson(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}

function buildPayloadBlock(presentation: Presentation, mode: StandaloneExportMode, editorOrigin: string): string {
  return [
    `<script id="${SLIDES_PAYLOAD_ID}" type="application/json">${safeScriptJson(presentation)}</script>`,
    `<script id="slides-config" type="application/json">${safeScriptJson({ mode, editorOrigin })}</script>`,
  ].join('\n  ');
}

function downloadHtml(filename: string, html: string) {
  const blob = new Blob([html], { type: 'text/html' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Revoke later to make sure the click handler has finished.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function safeFilename(title: string): string {
  const cleaned = title.trim().replace(/[\\/:*?"<>|]+/g, '_').replace(/\s+/g, '_');
  return `${cleaned || 'presentation'}.html`;
}

export async function exportStandaloneHtml(presentation: Presentation, opts: ExportOpts): Promise<void> {
  const editorOrigin = opts.editorOrigin ?? __SLIDES_EDITOR_ORIGIN__;
  const [template, embedded] = await Promise.all([
    loadTemplate(opts.mode),
    embedResources(presentation),
  ]);
  const payload = buildPayloadBlock(embedded, opts.mode, editorOrigin);
  const html = template.includes(PAYLOAD_SENTINEL)
    ? template.replace(PAYLOAD_SENTINEL, () => payload)
    : template.replace('</body>', () => `  ${payload}\n  </body>`);
  downloadHtml(safeFilename(presentation.title), html);
}
