import { afterEach, expect, it } from 'vitest';
import { usePresentationStore as store } from './presentationStore';
import { useEditorStore as editor } from './editorStore';
import { createPresentation, createShapeElement, createTextElement } from '../utils/model/slideFactory';
import { jsonToYDoc, yDocToJson } from '../collab/ySchema';
import { setActiveDoc } from '../collab/yDocAdapter';
import { createUndoManagerFor, setActiveUndoManager } from '../collab/activeUndo';
import { resetSelectedProperties, setSelectedProperty, transformSelectedProperties } from './selectionPropertyMutation';
import { reorderSelection } from '../utils/editor/selectionProperties';

afterEach(() => { setActiveUndoManager(null); setActiveDoc(null); });
it('layer moves preserve selected order even with gaps', () => {
  expect(reorderSelection(['a','b','c','d'], ['a','c'], 'front')).toEqual(['b','d','a','c']);
  expect(reorderSelection(['a','b','c','d'], ['b','d'], 'back')).toEqual(['b','d','a','c']);
  expect(reorderSelection(['a','b','c','d'], ['a','b'], 1)).toEqual(['c','a','b','d']);
  expect(reorderSelection(['a','b','c','d'], ['c','d'], -1)).toEqual(['a','c','d','b']);
});
it.each([false, true])('batch transforms/styles/reset/order preserve individual parameters and undo (Yjs=%s)', collab => {
  const p = createPresentation(), current = p.slides[p.slideOrder[0]];
  const a = createShapeElement('rect', { id: 'a', x: 100, y: 100, width: 100, height: 100, fill: '#ff0000', objectGroupIds: ['g'] });
  const b = createShapeElement('rect', { id: 'b', x: 300, y: 100, width: 100, height: 100, fill: '#00ff00', objectGroupIds: ['g'] });
  const c = createTextElement({ id: 'c', text: 'keep me' });
  current.elements = { a, b, c };current.elementOrder = ['a','c','b'];
  for (const el of [a,b,c]) p.objects[el.id] = { id: el.id, name: el.id, type: el.type };
  const previous = structuredClone(current);previous.id = 'previous';
  previous.elements.a.x = 50;previous.elements.b.x = 200;
  delete previous.elements.a.objectGroupIds;delete previous.elements.b.objectGroupIds;
  p.slides.previous = previous;p.slideOrder.unshift('previous');
  const doc = collab ? jsonToYDoc(p) : null;
  store.setState({ presentation: structuredClone(p) });store.temporal.getState().clear();
  editor.setState({ activeSlideId: current.id, selectedSlideIds: [current.id], selectedElementIds: ['a','b'], autoDrawMode: false });
  setActiveDoc(doc);const undo = doc ? createUndoManagerFor(doc) : null;setActiveUndoManager(undo);
  const read = () => (doc ? yDocToJson(doc) : store.getState().presentation).slides[current.id];
  const undoOnce = () => { if (undo) undo.undo(); else store.temporal.getState().undo(); };
  try {
    const before = structuredClone(read());
    transformSelectedProperties(current.id, ['a','b'], 'x', 150);
    expect(read().elements.a.x).toBe(150);expect(read().elements.b.x).toBe(350);
    undoOnce();expect(read()).toEqual(before);
    transformSelectedProperties(current.id, ['a','b'], 'width', 600);
    expect(read().elements.a.width).toBe(200);expect(read().elements.b.x).toBe(500);
    undoOnce();expect(read()).toEqual(before);
    transformSelectedProperties(current.id, ['a','b'], 'rotation', 90);
    expect(read().elements.a.x).toBeCloseTo(200);expect(read().elements.b.x).toBeCloseTo(200);
    expect(read().elements.a.y).toBeCloseTo(0);expect(read().elements.b.y).toBeCloseTo(200);
    undoOnce();expect(read()).toEqual(before);
    setSelectedProperty(current.id, ['a','b','c'], 'fill', '#0000ff', el => el.type === 'shape');
    expect(read().elements.a).toMatchObject({ fill: '#0000ff' });expect(read().elements.b).toMatchObject({ fill: '#0000ff' });
    expect(read().elements.c).toEqual(c);undoOnce();expect(read()).toEqual(before);
    resetSelectedProperties(current.id, ['a','b'], 'previous', ['x','y']);
    expect(read().elements.a.x).toBe(50);expect(read().elements.b.x).toBe(200);
    expect(read().elements.a.objectGroupIds).toEqual(['g']);expect(read().elements.b.objectGroupIds).toEqual(['g']);
    undoOnce();expect(read()).toEqual(before);
    store.getState().moveElements(current.id, ['a','b'], 'front');
    expect(read().elementOrder).toEqual(['c','a','b']);undoOnce();expect(read()).toEqual(before);
    const roundtrip = jsonToYDoc(doc ? yDocToJson(doc) : store.getState().presentation);
    expect(yDocToJson(roundtrip).slides[current.id]).toEqual(before);roundtrip.destroy();
  } finally { setActiveDoc(null);setActiveUndoManager(null);undo?.destroy();doc?.destroy(); }
});
