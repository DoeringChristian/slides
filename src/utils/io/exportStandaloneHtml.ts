import type { Presentation } from '../../types/presentation';
import { bakeLayouts } from '../text/bakedLayouts';
import { SLIDES_MEDIA_ATTR, SLIDES_PAYLOAD_ID } from './standaloneBoot';
import { deckMedia, getMediaBlob } from '../../media/mediaStore';

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
  root.querySelectorAll(`script#${SLIDES_PAYLOAD_ID}, script#slides-config, script[${SLIDES_MEDIA_ATTR}]`).forEach(node => node.remove());
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

/** One script element per media file, as Blob parts: the page is never one
 *  string (a deck's media can be longer than any string can be). */
async function mediaBlocks(presentation: Presentation): Promise<BlobPart[]> {
  const parts: BlobPart[] = [];
  const seen = new Set<string>();
  for (const resource of deckMedia(presentation)) {
    if (seen.has(resource.hash)) continue;
    seen.add(resource.hash);
    const blob = await getMediaBlob(resource.hash);
    if (!blob) throw new Error(`The media file of "${resource.name}" is not available, so it cannot be exported.`);
    parts.push(`\n  <script type="text/plain" ${SLIDES_MEDIA_ATTR}="${resource.hash}" data-mime="${resource.mime.replace(/[^\w.+/-]/g, '')}">`,
      await blobToBase64(blob), '</script>');
  }
  return parts;
}

async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

function downloadHtml(filename: string, parts: BlobPart[]) {
  const blob = new Blob(parts, { type: 'text/html' });
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

/** Review comments are working notes for the people editing, not for an
 *  audience: the viewer export leaves them out. */
export function withoutComments(presentation: Presentation): Presentation {
  const slides = Object.fromEntries(Object.entries(presentation.slides).map(([id, slide]) => {
    if (!slide.comments) return [id, slide];
    const { comments: _comments, ...rest } = slide;
    return [id, rest];
  }));
  return { ...presentation, slides };
}

export async function exportStandaloneHtml(presentation: Presentation, opts: ExportOpts): Promise<void> {
  if (opts.mode === 'viewer') presentation = withoutComments(presentation);
  const editorOrigin = opts.editorOrigin ?? __SLIDES_EDITOR_ORIGIN__;
  const [template, media, bakedText] = await Promise.all([
    loadTemplate(opts.mode),
    mediaBlocks(presentation),
    // Lay the text out once, here, so the player never has to: it ships glyph
    // outlines for prose and math alike instead of fonts plus MathJax.
    bakeLayouts(presentation),
  ]);
  // A deck with no text bakes to nothing; omit the key rather than shipping
  // an empty object into every payload.
  const withBake = Object.keys(bakedText).length ? { ...presentation, bakedText } : presentation;
  const payload = buildPayloadBlock(withBake, opts.mode, editorOrigin);
  const at = template.includes(PAYLOAD_SENTINEL) ? template.indexOf(PAYLOAD_SENTINEL) : template.lastIndexOf('</body>');
  const after = template.includes(PAYLOAD_SENTINEL) ? at + PAYLOAD_SENTINEL.length : at;
  downloadHtml(safeFilename(presentation.title), [template.slice(0, at), `  ${payload}`, ...media, '\n  ', template.slice(after)]);
}
