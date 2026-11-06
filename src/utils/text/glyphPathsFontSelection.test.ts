import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { TEXT_FONTS, textFont } from './fontRegistry';

/**
 * `style.fontFamily` has to reach the outline loader.
 *
 * Before the registry, `glyphPaths` ignored the family entirely and rendered
 * every element as Inter — the picker changed CSS-only paths (export, edit
 * overlay) while the SVG renderer did not move, so prose silently disagreed
 * with itself. These tests pin the wiring by watching which file is fetched.
 */

const real = readFileSync(new URL('../../assets/fonts/Inter-Regular.ttf', import.meta.url));
const bytes = real.buffer.slice(real.byteOffset, real.byteOffset + real.byteLength);

let fetched: string[] = [];

beforeEach(() => {
  fetched = [];
  vi.resetModules();
  // Font URLs are Vite asset specifiers, not fetchable in the node env; serve
  // real font bytes for any of them and record which was asked for.
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    fetched.push(String(url));
    return { ok: true, arrayBuffer: async () => bytes } as unknown as Response;
  }));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function glyphPaths() {
  return import('./glyphPaths');
}

describe('font selection reaches the outline loader', () => {
  it('fetches the registered file for each family and variant', async () => {
    const { loadFont } = await glyphPaths();
    for (const font of TEXT_FONTS) {
      fetched = [];
      await loadFont(font.id, 'normal', 'normal');
      await loadFont(font.id, 'bold', 'normal');
      await loadFont(font.id, 'normal', 'italic');
      await loadFont(font.id, 'bold', 'italic');
      expect(fetched, `${font.id} did not load its four registered variants`).toEqual([
        font.variants.regular,
        font.variants.bold,
        font.variants.italic,
        font.variants.boldItalic,
      ]);
    }
  });

  it('gives different families different files', async () => {
    // The actual regression: two families resolving to one file is exactly the
    // old Inter-for-everything behaviour.
    const { loadFont } = await glyphPaths();
    const [a, b] = TEXT_FONTS;
    expect(TEXT_FONTS.length, 'need two faces to compare').toBeGreaterThan(1);
    await loadFont(a.id, 'normal', 'normal');
    await loadFont(b.id, 'normal', 'normal');
    expect(new Set(fetched).size).toBe(2);
  });

  it('serves an unshipped family from the default face without refetching', async () => {
    const { loadFont } = await glyphPaths();
    await loadFont('Arial', 'normal', 'normal');
    await loadFont('Helvetica', 'normal', 'normal');
    await loadFont(textFont(undefined).id, 'normal', 'normal');
    // All three resolve to the default face, and the cache is keyed on the
    // RESOLVED id — so this is one fetch, not three.
    expect(fetched).toEqual([textFont(undefined).variants.regular]);
  });

  it('caches per family and variant rather than globally', async () => {
    const { loadFont } = await glyphPaths();
    const font = TEXT_FONTS[1];
    await loadFont(font.id, 'normal', 'normal');
    await loadFont(font.id, 'normal', 'normal');
    expect(fetched).toHaveLength(1);
    await loadFont(font.id, 'bold', 'normal');
    expect(fetched).toHaveLength(2);
  });

  it('prewarms the requested family, not just the default', async () => {
    const { prewarmFonts } = await glyphPaths();
    // prewarmFonts is a no-op without a document (it guards for SSR/node).
    vi.stubGlobal('document', { createElement: () => ({}), head: { appendChild: () => {} } });
    prewarmFonts('Libertinus Serif');
    const libertinus = textFont('Libertinus Serif');
    expect(fetched).toEqual([
      libertinus.variants.regular,
      libertinus.variants.bold,
      libertinus.variants.italic,
      libertinus.variants.boldItalic,
    ]);
  });
});
