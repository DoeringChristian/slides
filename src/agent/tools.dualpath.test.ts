import { readFileSync } from 'node:fs';
import { parse } from 'opentype.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { usePresentationStore as store } from '../store/presentationStore';
import { useEditorStore } from '../store/editorStore';
import { setActiveDoc } from '../collab/yDocAdapter';
import { createUndoManagerFor, setActiveUndoManager } from '../collab/activeUndo';
import { jsonToYDoc, yDocToJson } from '../collab/ySchema';
import { createPresentation, createShapeElement, createTextElement, copySlideAsKeyframe } from '../utils/model/slideFactory';
import type { Presentation, ShapeElement, TextElement } from '../types/presentation';
import { runTool, readPresentation } from './tools';
import { beginTurnHistory } from './turnHistory';

// Fonts are Vite asset URLs in the app; read Inter from disk under node.
vi.mock('../utils/text/glyphPaths', async importOriginal => {
  const actual = await importOriginal<typeof import('../utils/text/glyphPaths')>();
  const bytes = readFileSync(new URL('../assets/fonts/Inter-Regular.ttf', import.meta.url));
  const font = parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  return { ...actual, loadFont: async () => font };
});

afterEach(() => {
  setActiveUndoManager(null);
  setActiveDoc(null);
  useEditorStore.setState({ selectedSlideIds: [], autoDrawMode: false });
});

/** A two-slide deck: `box` and `title` on both slides (keyframes). */
function deck(): Presentation {
  const p = createPresentation();
  const s1 = p.slideOrder[0];
  const box = createShapeElement('rect', { id: 'box', x: 100, y: 100, width: 100, height: 80 });
  const title = createTextElement({ id: 'title', text: 'Hello', x: 40, y: 30, textSizing: 'auto-content' });
  p.slides[s1].elements = { box, title };
  p.slides[s1].elementOrder = ['box', 'title'];
  const s2 = copySlideAsKeyframe(p.slides[s1]);
  p.slides[s2.id] = s2;
  p.slideOrder.push(s2.id);
  p.objects = {
    box: { id: 'box', name: 'Box', type: 'shape' },
    title: { id: 'title', name: 'Title', type: 'text' },
  };
  return p;
}

function setup(collab: boolean) {
  const p = deck();
  store.setState({ presentation: p });
  store.temporal.getState().clear();
  const doc = collab ? jsonToYDoc(p) : null;
  setActiveDoc(doc);
  if (doc) setActiveUndoManager(createUndoManagerFor(doc));
  const read = () => (doc ? yDocToJson(doc) as Presentation : store.getState().presentation);
  return { p, s1: p.slideOrder[0], s2: p.slideOrder[1], read, doc };
}

describe.each([false, true])('agent tools collab=%s', collab => {
  it('reads the deck as compact views with keyframe continuity', async () => {
    const { s2 } = setup(collab);
    const deckOut = await runTool('get_deck', {});
    const outline = JSON.parse((deckOut.content[0] as { text: string }).text);
    expect(outline.slides).toHaveLength(2);
    expect(outline.slides[0].text).toBe('Hello');

    const slideOut = await runTool('get_slide', { slideId: s2 });
    const view = JSON.parse((slideOut.content[0] as { text: string }).text);
    expect(view.elements.map((e: { id: string }) => e.id)).toEqual(['box', 'title']);
    expect(view.elements[0]).toMatchObject({ id: 'box', name: 'Box', keyframe: 'continues' });
    // Defaults and editor bookkeeping are left out.
    expect(view.elements[0]).not.toHaveProperty('locked');
    expect(view.elements[0]).not.toHaveProperty('opacity');
  });

  it('adds a copied keyframe and edits only that keyframe', async () => {
    const { s2, read } = setup(collab);
    const added = await runTool('add_slide', { afterSlideId: s2, mode: 'copy' });
    expect(added.isError).toBeFalsy();
    const { slideId } = JSON.parse((added.content[0] as { text: string }).text);
    const out = await runTool('update_elements', { slideId, patches: [{ id: 'box', x: 500, fill: '#ff0000' }] });
    expect(out.isError).toBeFalsy();
    const after = read();
    expect(after.slideOrder).toHaveLength(3);
    expect(after.slides[slideId].elements.box).toMatchObject({ x: 500, fill: '#ff0000' });
    expect(after.slides[s2].elements.box.x).toBe(100);
  });

  it('creates elements with defaults, sized paths and continued keyframes', async () => {
    const { s1, s2: last, read } = setup(collab);
    const added = await runTool('add_slide', { afterSlideId: last, mode: 'empty' });
    const s2 = JSON.parse((added.content[0] as { text: string }).text).slideId as string;
    const out = await runTool('add_elements', {
      slideId: s2,
      elements: [
        { id: 'box', y: 300 },
        { type: 'shape', shapeType: 'path', x: 10, y: 10, points: [0, 0, 200, 50], endHead: 'arrow', name: 'Pointer' },
      ],
    });
    expect(out.isError, JSON.stringify(out.content)).toBeFalsy();
    const after = read();
    const order = after.slides[s2].elementOrder;
    // `box` continues from the previous keyframe (same id, so it animates) with the override.
    expect(after.slides[s2].elements.box).toMatchObject({ x: 100, y: 300, width: 100 });
    const arrowId = order[order.length - 1];
    const arrow = after.slides[s2].elements[arrowId] as ShapeElement;
    expect(arrow).toMatchObject({ shapeType: 'path', width: 200, height: 50, creationPreset: 'arrow', endHead: 'arrow' });
    expect(after.objects[arrowId].name).toBe('Pointer');
    expect(after.slides[s1].elements[arrowId]).toBeUndefined();
  });

  it('deletes from this keyframe onward, keeping earlier ones', async () => {
    const { s1, s2, read } = setup(collab);
    const out = await runTool('delete_elements', { slideId: s2, ids: ['box'] });
    expect(out.isError).toBeFalsy();
    expect(read().slides[s2].elements.box.visible).toBe(false);
    expect(read().slides[s1].elements.box.visible).toBe(true);
    const again = await runTool('add_elements', { slideId: s2, elements: [{ id: 'box' }] });
    expect((again.content[0] as { text: string }).text).toContain('visible=true');
  });

  it('rejects bad input and unknown ids without writing', async () => {
    const { s1, read } = setup(collab);
    const before = JSON.stringify(read().slides);
    expect((await runTool('update_elements', { slideId: s1, patches: [{ id: 'nope', x: 1 }] })).isError).toBe(true);
    expect((await runTool('update_elements', { slideId: s1, patches: [{ id: 'box', x: 'left' }] })).isError).toBe(true);
    expect((await runTool('add_elements', { slideId: s1, elements: [{ type: 'shape', shapeType: 'path', points: [0, 0] }] })).isError).toBe(true);
    expect((await runTool('get_slide', { slideId: 'missing' })).isError).toBe(true);
    expect(JSON.stringify(read().slides)).toBe(before);
  });

  it('validates easings against the element and group', async () => {
    const { s2, read } = setup(collab);
    const bad = await runTool('set_transitions', { slideId: s2, elementId: 'box', transitions: { visibility: 'write' } });
    expect(bad.isError).toBe(true);
    expect((bad.content[0] as { text: string }).text).toContain('create');
    const ok = await runTool('set_transitions', {
      slideId: s2, elementId: 'title', transitions: { visibility: 'write', position: 'ease' }, visibilityOptions: { stagger: { lagRatio: 0.2 } },
    });
    expect(ok.isError).toBeFalsy();
    expect(read().slides[s2].elements.title.transitions).toMatchObject({ visibility: 'write', position: 'ease', visibilityOptions: { stagger: { lagRatio: 0.2 } } });
  });

  it('never fans out to the slides the user has selected', async () => {
    const { s1, s2, read } = setup(collab);
    // Multi-slide editing is armed: a UI edit on s1 would mirror to s2.
    useEditorStore.setState({ activeSlideId: s1, selectedSlideIds: [s1, s2] });
    await runTool('update_elements', { slideId: s1, patches: [{ id: 'box', x: 300 }] });
    expect(read().slides[s1].elements.box.x).toBe(300);
    expect(read().slides[s2].elements.box.x).toBe(100);
  });

  it('is not redirected to a new keyframe by auto-draw', async () => {
    const { s1, read } = setup(collab);
    useEditorStore.setState({ activeSlideId: s1, autoDrawMode: true });
    await runTool('update_elements', { slideId: s1, patches: [{ id: 'box', y: 5 }] });
    expect(read().slideOrder).toHaveLength(2);
    expect(read().slides[s1].elements.box.y).toBe(5);
  });

  it('measures free text instead of trusting a given height', async () => {
    const { s1, read } = setup(collab);
    await runTool('update_elements', { slideId: s1, patches: [{ id: 'title', text: 'Line one\nLine two\nLine three', height: 5 }] });
    const title = read().slides[s1].elements.title as TextElement;
    expect(title.height).toBeGreaterThan(60);
  });

  it('edits an object on every keyframe at once, keeping its motion', async () => {
    const { s1, s2, read } = setup(collab);
    // The box moves between the keyframes: that motion is the animation.
    await runTool('update_elements', { slideId: s2, patches: [{ id: 'box', x: 400 }] });
    const out = await runTool('update_across_slides', { elementId: 'box', changes: { fill: '#ff0000' }, offset: { dx: 10, dy: -5 } });
    expect(out.isError, JSON.stringify(out.content)).toBeFalsy();
    const p = read();
    expect(p.slides[s1].elements.box).toMatchObject({ fill: '#ff0000', x: 110, y: 95 });
    expect(p.slides[s2].elements.box).toMatchObject({ fill: '#ff0000', x: 410, y: 95 });
    // Limited to the slides named.
    await runTool('update_across_slides', { elementId: 'box', changes: { stroke: '#00ff00' }, slideIds: [s2] });
    expect(read().slides[s1].elements.box).not.toMatchObject({ stroke: '#00ff00' });
    expect(read().slides[s2].elements.box).toMatchObject({ stroke: '#00ff00' });
    // Text edits are re-measured on each keyframe.
    await runTool('update_across_slides', { elementId: 'title', changes: { text: 'A much longer title than before' } });
    for (const sid of [s1, s2]) {
      const t = read().slides[sid].elements.title as TextElement;
      expect(t.text).toBe('A much longer title than before');
      expect(t.width).toBeGreaterThan(200);
    }
  });

  it('groups objects as one group across keyframes, and ungroups them again', async () => {
    const { s1, s2, read } = setup(collab);
    const out = await runTool('group_elements', { slideId: s1, elementIds: ['box', 'title'] });
    expect(out.isError, JSON.stringify(out.content)).toBeFalsy();
    const { groupId, slides } = JSON.parse((out.content[0] as { text: string }).text);
    expect(slides).toBe(2);
    for (const sid of [s1, s2]) {
      expect(read().slides[sid].elements.box.objectGroupIds).toEqual([groupId]);
      expect(read().slides[sid].elements.title.objectGroupIds).toEqual([groupId]);
    }
    // A single object is not a group.
    expect((await runTool('group_elements', { slideId: s1, elementIds: ['box'] })).isError).toBe(true);
    await runTool('ungroup_elements', { slideId: s1, elementIds: ['box'] });
    for (const sid of [s1, s2]) {
      expect(read().slides[sid].elements.box.objectGroupIds ?? []).toEqual([]);
      expect(read().slides[sid].elements.title.objectGroupIds ?? []).toEqual([]);
    }
  });

  it('makes a whole turn one undo step', async () => {
    const { s1, s2, read, doc } = setup(collab);
    const finish = beginTurnHistory();
    const added = await runTool('add_slide', { afterSlideId: s2, mode: 'copy' });
    const { slideId } = JSON.parse((added.content[0] as { text: string }).text);
    await runTool('update_elements', { slideId: s1, patches: [{ id: 'box', x: 400 }] });
    await runTool('set_slide', { slideId, notes: 'new notes', background: '#000000' });
    await runTool('set_title', { title: 'Renamed' });
    const turn = finish();
    expect(turn?.canUndo()).toBe(true);
    if (!doc) {
      // JSON mode: the store mirrors into the read; collab mode reads the doc.
      expect(read().slideOrder).toHaveLength(3);
    }
    turn!.undo();
    const after = read();
    expect(after.slideOrder).toHaveLength(2);
    expect(after.slides[s1].elements.box.x).toBe(100);
    expect(after.title).not.toBe('Renamed');
  });

  it('withdraws "undo turn" once the user edits after the turn', async () => {
    const { s1 } = setup(collab);
    const finish = beginTurnHistory();
    await runTool('update_elements', { slideId: s1, patches: [{ id: 'box', x: 400 }] });
    const turn = finish();
    expect(turn?.canUndo()).toBe(true);
    store.getState().updateElement(s1, 'box', { y: 1 });
    // Collab capture may merge the user's edit into the turn's item within
    // the capture window; either way the turn is no longer cleanly undoable
    // on its own in JSON mode.
    if (!collab) expect(turn?.canUndo()).toBe(false);
    expect(readPresentation().slides[s1].elements.box.y).toBe(1);
  });
});
