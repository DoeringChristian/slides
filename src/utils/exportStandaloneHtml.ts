import type { Presentation } from '../types/presentation';
import { embedResources } from './embedResources';

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
  const html = doctype + document.documentElement.outerHTML;
  const stripped = html
    .replace(/<script id="slides-payload"[\s\S]*?<\/script>\s*/g, '')
    .replace(/<script id="slides-config"[\s\S]*?<\/script>\s*/g, '');
  // Make sure the sentinel is present so we have somewhere to re-inject.
  if (stripped.includes(PAYLOAD_SENTINEL)) return stripped;
  return stripped.replace('</body>', `  ${PAYLOAD_SENTINEL}\n  </body>`);
}

// Escape `</script>` sequences so the JSON can safely live inside a <script> tag.
function safeScriptJson(value: unknown): string {
  return JSON.stringify(value).replace(/<\/script>/gi, '<\\/script>');
}

function buildPayloadBlock(presentation: Presentation, mode: StandaloneExportMode, editorOrigin: string): string {
  return [
    `<script id="slides-payload" type="application/json">${safeScriptJson(presentation)}</script>`,
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
    ? template.replace(PAYLOAD_SENTINEL, payload)
    : template.replace('</body>', `  ${payload}\n  </body>`);
  downloadHtml(safeFilename(presentation.title), html);
}
