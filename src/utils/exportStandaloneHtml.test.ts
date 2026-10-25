import { afterEach, expect, it, vi } from 'vitest';
import { exportStandaloneHtml } from './exportStandaloneHtml';
import { createPresentation } from './slideFactory';

afterEach(() => vi.unstubAllGlobals());
for (const sentinel of [true, false]) for (const title of ['$$x$$', "$& $` $'", '</script > </script/> <!-- <script> ü']) {
  it(`literal script JSON roundtrip: sentinel=${sentinel}, ${title}`, async () => {
    const p = createPresentation(); p.title = title;
    let blob: Blob | undefined;
    vi.stubGlobal('fetch', async () => ({ ok: true, text: async () => `<html><body>${sentinel ? '<!--SLIDES_PAYLOAD-->' : ''}</body></html>` }));
    vi.stubGlobal('URL', { createObjectURL: (b: Blob) => { blob = b; return 'blob:test'; }, revokeObjectURL: vi.fn() });
    vi.stubGlobal('document', { createElement: () => ({ click: vi.fn() }), body: { appendChild: vi.fn(), removeChild: vi.fn() } });
    await exportStandaloneHtml(p, { mode: 'editor', editorOrigin: title });
    const html = await blob!.text();
    const payload = html.match(/id="slides-payload" type="application\/json">([\s\S]*?)<\/script>/)![1];
    const config = html.match(/id="slides-config" type="application\/json">([\s\S]*?)<\/script>/)![1];
    expect(JSON.parse(payload)).toEqual(p);
    expect(JSON.parse(config)).toEqual({ mode: 'editor', editorOrigin: title });
    expect(payload).not.toContain('<'); expect(config).not.toContain('<');
  });
}
