import { readFileSync } from 'node:fs';
import { parse } from 'opentype.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { usePresentationStore as store } from '../store/presentationStore';
import { createPresentation, createShapeElement, createTextElement } from '../utils/model/slideFactory';
import { runTool } from './tools';
import type { Presentation } from '../types/presentation';

vi.mock('../utils/text/glyphPaths', async importOriginal => {
  const actual = await importOriginal<typeof import('../utils/text/glyphPaths')>();
  const bytes = readFileSync(new URL('../assets/fonts/Inter-Regular.ttf', import.meta.url));
  const font = parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  return { ...actual, loadFont: async () => font };
});

const out = (r: { content: Array<{ type: string }> }) => JSON.parse((r.content[0] as unknown as { text: string }).text);
const deck = () => store.getState().presentation as Presentation;

let s1 = '';
beforeEach(() => {
  const p = createPresentation();
  s1 = p.slideOrder[0];
  p.slides[s1].elements = {
    title: createTextElement({ id: 'title', text: 'Sorting', x: 40, y: 30, textSizing: 'auto-content' }),
    b1: createShapeElement('rect', { id: 'b1', x: 400, y: 200, width: 80, height: 80 }),
    b2: createShapeElement('rect', { id: 'b2', x: 100, y: 200, width: 80, height: 80 }),
  };
  p.slides[s1].elementOrder = ['title', 'b1', 'b2'];
  p.objects = { title: { id: 'title', name: 'Title', type: 'text' } };
  store.setState({ presentation: p });
});

describe('keyframe guidance', () => {
  it('copies the previous slide by default and says what carried over', async () => {
    const r = out(await runTool('add_slide', {}));
    expect(r.carriedOver).toEqual(['title', 'b1', 'b2']);
    expect(deck().slides[r.slideId].elements.b1).toBeDefined();
  });

  it('explains what animates, enters and exits into a slide', async () => {
    const { slideId } = out(await runTool('add_slide', {}));
    await runTool('update_elements', { slideId, patches: [{ id: 'b1', x: 100 }, { id: 'b2', x: 400 }, { id: 'title', visible: false }] });
    await runTool('set_transitions', { slideId, elementId: 'b1', transitions: { position: 'ease' } });
    await runTool('add_elements', { slideId, elements: [{ id: 'done', type: 'text', text: 'Sorted', x: 40, y: 400 }] });
    const r = out(await runTool('explain_transition', { slideId }));
    expect(r.animates).toEqual(['b1: position (ease)', 'b2: position (linear)']);
    expect(r.enters).toEqual([expect.stringMatching(/^done \("Text 1"\) — new, visibility: /)]);
    expect(r.exits).toEqual([expect.stringMatching(/^title \("Title"\) — hidden here/)]);
    expect(r.note).toBeUndefined();
  });

  it('flags a cut where nothing carries over, and counts continuity in get_deck', async () => {
    const { slideId } = out(await runTool('add_slide', { mode: 'empty' }));
    await runTool('add_elements', { slideId, elements: [{ type: 'text', text: 'Elsewhere', x: 500, y: 450 }] });
    expect(out(await runTool('explain_transition', { slideId })).note).toMatch(/cut/);
    const copy = out(await runTool('add_slide', { afterSlideId: s1 })).slideId;
    const outline = out(await runTool('get_deck', {}));
    expect(outline.slides.find((s: { id: string }) => s.id === copy).fromPrevious).toBe('3 continue, 0 new');
    expect(outline.slides.find((s: { id: string }) => s.id === slideId).fromPrevious).toBe('0 continue, 1 new');
  });

  it('warns when a new element recreates an object from the previous slide', async () => {
    const { slideId } = out(await runTool('add_slide', { mode: 'empty' }));
    const r = out(await runTool('add_elements', {
      slideId,
      elements: [
        { type: 'text', text: 'Sorting', x: 40, y: 30 },
        { type: 'shape', shapeType: 'rect', x: 402, y: 198, width: 80, height: 80 },
        { type: 'shape', shapeType: 'ellipse', x: 700, y: 50, width: 40, height: 40 },
      ],
    }));
    expect(r.warnings).toHaveLength(2);
    expect(r.warnings[0]).toMatch(/looks like title \("Title"\).*add it again with id "title"/);
    expect(r.warnings[1]).toMatch(/looks like b1/);

    // On a copied slide, a duplicate of something still there points to editing it.
    const copy = out(await runTool('add_slide', { afterSlideId: s1 })).slideId;
    const dup = out(await runTool('add_elements', { slideId: copy, elements: [{ type: 'text', text: 'Sorting', x: 60, y: 30 }] }));
    expect(dup.warnings[0]).toMatch(/already on this slide: edit it with update_elements/);

    // Continuing an object by id is the right way and draws no warning.
    const ok = out(await runTool('add_elements', { slideId, elements: [{ id: 'b2', x: 600 }] }));
    expect(ok.warnings).toBeUndefined();
  });
});
