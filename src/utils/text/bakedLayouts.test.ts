import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { parse } from 'opentype.js';
import { bakeLayouts, installBakedLayouts } from './bakedLayouts';
import { getLayoutSync, layoutSvgText } from './textLayout';
import { createPresentation, createTextElement } from '../model/slideFactory';
import type { Presentation, TextElement } from '../../types/presentation';

/**
 * Baking exists so an exported deck renders text without parsing a font or
 * loading MathJax. The assertion that matters is therefore not "the bake has
 * entries" but "a primed cache answers synchronously" — which is what lets the
 * player ship without fonts at all.
 */

// Real font bytes, since layout needs actual glyph metrics; the node env has
// no fetch for Vite asset URLs. Read inside the factory: vi.mock is hoisted
// above any top-level binding this file declares.
vi.mock('./glyphPaths', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./glyphPaths')>();
  const bytes = readFileSync(new URL('../../assets/fonts/Inter-Regular.ttf', import.meta.url));
  const font = parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  return { ...actual, loadFont: async () => font };
});

function deckWithText(texts: string[]): Presentation {
  const deck = createPresentation();
  const slide = deck.slides[deck.slideOrder[0]];
  const elements: Record<string, TextElement> = {};
  texts.forEach((text, i) => {
    const el = { ...createTextElement(), id: `t${i}`, text };
    elements[el.id] = el;
  });
  slide.elements = elements as typeof slide.elements;
  slide.elementOrder = Object.keys(elements);
  deck.objects = Object.fromEntries(
    Object.keys(elements).map((id) => [id, { id, name: id, type: 'text' }]),
  ) as typeof deck.objects;
  return deck;
}

describe('baked layouts', () => {
  it('bakes a layout for every text element', async () => {
    const baked = await bakeLayouts(deckWithText(['Hello', 'World']));
    expect(Object.keys(baked).length).toBeGreaterThan(0);
    for (const doc of Object.values(baked)) {
      expect(doc.paths.length, 'a baked layout with no glyphs is useless').toBeGreaterThan(0);
      expect(Number.isFinite(doc.width)).toBe(true);
      expect(Number.isFinite(doc.height)).toBe(true);
    }
  });

  it('deduplicates identical text instead of baking it once per element', async () => {
    // The property that keeps exports small: a deck repeating one title across
    // keyframes bakes it once.
    const repeated = await bakeLayouts(deckWithText(['Same', 'Same', 'Same']));
    const distinct = await bakeLayouts(deckWithText(['Same']));
    expect(Object.keys(repeated).length).toBe(Object.keys(distinct).length);
  });

  it('serialises through JSON unchanged', async () => {
    // It travels inside the exported HTML as JSON, so anything non-plain here
    // (a function, a Set) would silently vanish.
    const baked = await bakeLayouts(deckWithText(['Round trip']));
    expect(JSON.parse(JSON.stringify(baked))).toEqual(baked);
  });

  it('answers synchronously once installed, with no font work', async () => {
    // The point of the whole mechanism. A primed cache must satisfy the
    // renderer's synchronous read on the very first frame.
    const deck = deckWithText(['Primed text']);
    const baked = await bakeLayouts(deck);

    const el = Object.values(deck.slides[deck.slideOrder[0]].elements)[0] as TextElement;

    // A fresh module graph stands in for the player's cold start, and the
    // read goes through the same helper the renderer uses, so the effective
    // width (auto-content vs fixed) is derived rather than guessed.
    vi.resetModules();
    const freshLayout = await import('./textLayout');
    const freshSizing = await import('./userTextSizing');
    expect(freshSizing.getUserTextLayoutSync(el), 'cold cache should be empty').toBeNull();

    freshLayout.primeLayoutCache(baked);
    const hit = freshSizing.getUserTextLayoutSync(el);
    expect(hit, 'a baked deck still had to lay text out at runtime').not.toBeNull();
    expect(hit!.paths.length).toBeGreaterThan(0);
  });

  it('installs nothing for a deck without a bake', () => {
    expect(installBakedLayouts(undefined)).toBe(0);
    expect(installBakedLayouts({})).toBe(0);
  });

  it('keeps recording scoped to one bake', async () => {
    // A leaked recording would make every later editor layout accumulate.
    await bakeLayouts(deckWithText(['First']));
    await layoutSvgText('Unrelated later text', createTextElement().style, 500);
    const second = await bakeLayouts(deckWithText(['Second']));
    const texts = Object.keys(second).join('|');
    expect(texts).toContain('Second');
    expect(texts).not.toContain('Unrelated later text');
  });

  it('leaves the live cache usable after baking', async () => {
    await bakeLayouts(deckWithText(['Still live']));
    const style = createTextElement().style;
    await layoutSvgText('After the bake', style, 400);
    expect(getLayoutSync('After the bake', style, 400)).not.toBeNull();
  });
});
