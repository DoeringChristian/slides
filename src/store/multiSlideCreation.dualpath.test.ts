import { afterEach, describe, expect, it } from 'vitest';
import { usePresentationStore as store } from './presentationStore';
import { useEditorStore } from './editorStore';
import { setActiveDoc } from '../collab/yDocAdapter';
import { createUndoManagerFor } from '../collab/activeUndo';
import { jsonToYDoc, yDocToJson } from '../collab/ySchema';
import { createPresentation, createShapeElement, createSlide, createTextElement } from '../utils/model/slideFactory';
import { assertPresentation } from '../utils/model/currentPresentation';
import type { Presentation } from '../types/presentation';

afterEach(() => {
  setActiveDoc(null);
  useEditorStore.setState({ selectedSlideIds: [], autoDrawMode: false });
});

/** Three slides; `box` only on slide 1. */
function setup(collab: boolean) {
  const p = createPresentation();
  const [s1] = p.slideOrder;
  const s2 = createSlide(), s3 = createSlide();
  p.slides[s2.id] = s2; p.slides[s3.id] = s3;
  p.slideOrder.push(s2.id, s3.id);
  p.slides[s1].elements = { box: createShapeElement('rect', { id: 'box' }) };
  p.slides[s1].elementOrder = ['box'];
  store.setState({ presentation: p });
  store.temporal.getState().clear();
  const doc = collab ? jsonToYDoc(p) : null;
  setActiveDoc(doc);
  const undo = doc ? createUndoManagerFor(doc) : null;
  const read = () => (doc ? yDocToJson(doc) : store.getState().presentation) as Presentation;
  return { s1, s2: s2.id, s3: s3.id, read, undo };
}

describe.each([false, true])('creating on several selected slides collab=%s', collab => {
  it('puts the new object on every selected slide, as one object and one undo step', () => {
    const { s1, s2, s3, read, undo } = setup(collab);
    useEditorStore.setState({ activeSlideId: s2, selectedSlideIds: [s1, s2, s3] });
    store.getState().addElement(s2, createShapeElement('ellipse', { id: 'dot', x: 40 }));
    const p = read();
    for (const sid of [s1, s2, s3]) {
      expect(p.slides[sid].elements.dot).toMatchObject({ id: 'dot', x: 40, shapeType: 'ellipse' });
      expect(p.slides[sid].elementOrder.at(-1)).toBe('dot');
    }
    expect(Object.keys(p.objects)).toContain('dot');
    expect(() => assertPresentation(p)).not.toThrow();

    if (undo) undo.undo(); else store.temporal.getState().undo();
    const reverted = read();
    for (const sid of [s1, s2, s3]) expect(reverted.slides[sid].elements.dot).toBeUndefined();
  });

  it('keeps references valid on slides that lack their target', () => {
    const { s1, s2, read } = setup(collab);
    useEditorStore.setState({ activeSlideId: s1, selectedSlideIds: [s1, s2] });
    const label = createTextElement({ id: 'label', text: 'Hi', containerId: 'box' });
    const arrow = createShapeElement('path', {
      id: 'arrow', points: [0, 0, 100, 0],
      startBinding: { elementId: 'box', mode: 'pinned', fixedPoint: [1, 0.5] },
    });
    store.getState().addElements(s1, [label, arrow]);
    const p = read();
    // Slide 1 has the box: both as created.
    expect(p.slides[s1].elements.label).toBeDefined();
    expect(p.slides[s1].elements.arrow).toMatchObject({ startBinding: { elementId: 'box' } });
    // Slide 2 has no box: no orphan label, the arrow is unbound.
    expect(p.slides[s2].elements.label).toBeUndefined();
    expect(p.slides[s2].elements.arrow).toMatchObject({ startBinding: null });
    expect(() => assertPresentation(p)).not.toThrow();
  });

  it('creates on the active slide only when it is the only one selected', () => {
    const { s1, s2, read } = setup(collab);
    useEditorStore.setState({ activeSlideId: s1, selectedSlideIds: [s1] });
    store.getState().addElement(s1, createShapeElement('ellipse', { id: 'dot' }));
    expect(read().slides[s2].elements.dot).toBeUndefined();
  });
});
