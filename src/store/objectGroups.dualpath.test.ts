import { afterEach, expect, it } from 'vitest';
import { usePresentationStore as store } from './presentationStore';
import { useEditorStore as editor } from './editorStore';
import { createPresentation, createShapeElement, duplicateElements, copySlideAsKeyframe } from '../utils/model/slideFactory';
import { expandObjectGroups, objectGroupLocked, toggleObjectGroup } from '../utils/model/objectGroups';
import { jsonToYDoc, yDocToJson } from '../collab/ySchema';
import { setActiveDoc } from '../collab/yDocAdapter';
import { createUndoManagerFor, setActiveUndoManager } from '../collab/activeUndo';
import { rotateSelection } from '../utils/geometry/resizeGeometry';

afterEach(() => { setActiveUndoManager(null); setActiveDoc(null); });

it.each([false, true])('groups/nests/ungroups without geometry changes, undo and persistence (collab=%s)', collab => {
  const p = createPresentation(), slide = p.slides[p.slideOrder[0]];
  for (const id of ['a', 'b', 'c']) {
    slide.elements[id] = createShapeElement('rect', { id, x: id.charCodeAt(0), rotation: 30 });
    p.objects[id] = { id, name: id, type: 'shape' };
  }
  slide.elementOrder = ['a', 'b', 'c'];
  const doc = collab ? jsonToYDoc(p) : null;
  store.setState({ presentation: structuredClone(p) }); store.temporal.getState().clear();
  editor.setState({ activeSlideId: slide.id, selectedElementIds: [], selectedSlideIds: [slide.id], autoDrawMode: false });
  setActiveDoc(doc);
  const undo = doc ? createUndoManagerFor(doc) : null; setActiveUndoManager(undo);
  const read = () => (doc ? yDocToJson(doc) : store.getState().presentation).slides[slide.id];
  try {
    store.getState().groupObjects(slide.id, ['a', 'b']);
    const grouped = structuredClone(read());
    expect(grouped.elements.a.objectGroupIds).toHaveLength(1);
    expect(grouped.elements.b.objectGroupIds).toEqual(grouped.elements.a.objectGroupIds);
    expect(grouped.elementOrder).toEqual(slide.elementOrder);
    for (const id of slide.elementOrder) {
      const { objectGroupIds: _groups, ...rest } = grouped.elements[id];
      expect(rest).toEqual(slide.elements[id]);
    }
    editor.getState().setSelectedElements(['a']);
    expect(editor.getState().selectedElementIds).toEqual(['a', 'b']);
    expect(toggleObjectGroup(grouped.elements, ['a', 'b', 'c'], 'a')).toEqual(['c']);
    expect(copySlideAsKeyframe(grouped).elements.a.objectGroupIds).toEqual(grouped.elements.a.objectGroupIds);
    const copies = duplicateElements([grouped.elements.a, grouped.elements.b]);
    expect(copies[0].objectGroupIds).toEqual(copies[1].objectGroupIds);
    expect(copies[0].objectGroupIds).not.toEqual(grouped.elements.a.objectGroupIds);
    if (undo) undo.undo(); else store.temporal.getState().undo();
    expect(read()).toEqual(slide);
    if (undo) undo.redo(); else store.temporal.getState().redo();
    expect(read()).toEqual(grouped);
    store.getState().groupObjects(slide.id, ['a', 'c']);
    expect(read().elements.a.objectGroupIds).toHaveLength(2);
    expect(expandObjectGroups(read().elements, ['b']).sort()).toEqual(['a', 'b', 'c']);
    store.getState().ungroupObjects(slide.id, ['a']);
    expect(read().elements.a.objectGroupIds).toEqual(grouped.elements.a.objectGroupIds);
    expect(read().elements.c.objectGroupIds).toBeUndefined();
    const snapshot = doc ? yDocToJson(doc) : store.getState().presentation;
    const reloaded = jsonToYDoc(JSON.parse(JSON.stringify(snapshot)));
    expect(yDocToJson(reloaded).slides[slide.id]).toEqual(read()); reloaded.destroy();
    store.getState().ungroupObjects(slide.id, ['b']);
    expect(read().elements.a.objectGroupIds).toBeUndefined();
    expect(read().elements.b.objectGroupIds).toBeUndefined();
    const beforeHide = structuredClone(read());
    store.getState().hideElements(slide.id, ['a', 'b']);
    expect(read().elements.a?.visible ?? false).toBe(false);
    expect(read().elements.b?.visible ?? false).toBe(false);
    if (undo) undo.undo(); else store.temporal.getState().undo();
    expect(read()).toEqual(beforeHide);
  } finally { setActiveUndoManager(null); setActiveDoc(null); undo?.destroy(); doc?.destroy(); }
});

it('rotates member centers around one pivot without changing sizes or identities', () => {
  const members = [createShapeElement('rect', { id: 'a', x: 0, y: 0, width: 20, height: 20 }),
    createShapeElement('rect', { id: 'b', x: 80, y: 0, width: 20, height: 20, rotation: 20 })];
  const updates = rotateSelection(members, { x: 50, y: 10 }, 90);
  expect(updates[0].elementId).toBe('a');
  expect(updates[0].changes.x).toBeCloseTo(40);
  expect(updates[0].changes.y).toBeCloseTo(-40);
  expect(updates[1].changes.x).toBeCloseTo(40);
  expect(updates[1].changes.y).toBeCloseTo(40);
  expect(updates[1].changes.rotation).toBe(110);
  expect(updates.every(u => u.changes.width === undefined && u.changes.height === undefined)).toBe(true);
});

it('does not group locked objects or create redundant wrapper groups', () => {
  const p = createPresentation(), s = p.slides[p.slideOrder[0]];
  s.elements = { a: createShapeElement('rect', { id: 'a', locked: true }), b: createShapeElement('rect', { id: 'b' }) };
  s.elementOrder = ['a', 'b']; store.setState({ presentation: p });
  store.getState().groupObjects(s.id, ['a', 'b']);
  expect(store.getState().presentation).toBe(p);
  s.elements.a.locked = false;
  store.getState().groupObjects(s.id, ['a', 'b']);
  const grouped = store.getState().presentation;
  store.getState().groupObjects(s.id, ['a', 'b']);
  expect(store.getState().presentation).toBe(grouped);
  const els = grouped.slides[s.id].elements;
  expect(objectGroupLocked({ ...els, a: { ...els.a, locked: true } }, 'b')).toBe(true);
});

it.each([false, true])('moves members and merges groups atomically without changing geometry/order (Yjs=%s)', collab => {
  const p = createPresentation(), slide = p.slides[p.slideOrder[0]];
  for (const [index, id] of ['a','b','c','d'].entries()) {
    slide.elements[id] = createShapeElement('rect', { id, x: index * 100, objectGroupIds: index < 2 ? ['first'] : ['second'] });
    p.objects[id] = { id, name: id, type: 'shape' };
  }
  slide.elementOrder = ['a','b','c','d'];
  const doc = collab ? jsonToYDoc(p) : null;
  store.setState({ presentation: structuredClone(p) });store.temporal.getState().clear();
  editor.setState({ activeSlideId: slide.id, selectedSlideIds: [slide.id], autoDrawMode: false });
  setActiveDoc(doc);const undo = doc ? createUndoManagerFor(doc) : null;setActiveUndoManager(undo);
  const read = () => (doc ? yDocToJson(doc) : store.getState().presentation).slides[slide.id];
  const revert = () => { if (undo) undo.undo(); else store.temporal.getState().undo(); };
  try {
    store.getState().moveObjectsToGroup(slide.id, ['a'], 'second');
    expect(read().elements.a.objectGroupIds).toEqual(['second']);expect(read().elements.b.objectGroupIds).toEqual(['first']);
    revert();expect(read()).toEqual(slide);
    store.getState().moveObjectsToGroup(slide.id, ['a','b'], 'second', 'first');
    for (const id of slide.elementOrder) expect(read().elements[id]).toEqual({ ...slide.elements[id], objectGroupIds: ['second'] });
    expect(read().elementOrder).toEqual(slide.elementOrder);
    revert();expect(read()).toEqual(slide);
    store.getState().moveObjectsToGroup(slide.id, ['a'], null);
    expect(read().elements.a.objectGroupIds).toBeUndefined();revert();expect(read()).toEqual(slide);
    store.getState().moveObjectsToGroup(slide.id, ['a','b'], 'first', 'first');
    expect(read()).toEqual(slide);
  } finally { setActiveDoc(null);setActiveUndoManager(null);undo?.destroy();doc?.destroy(); }
});
