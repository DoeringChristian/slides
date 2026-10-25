import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('../utils/keyboard', () => ({ isShiftHeld: () => false, isCtrlHeld: () => false }));
vi.mock('../utils/idGenerator', () => ({ generateId: vi.fn() }));
import { generateId } from '../utils/idGenerator';
import { usePresentationStore as store } from './presentationStore';
import { useEditorStore as editor } from './editorStore';
import { createPresentation, createSlide, createShapeElement } from '../utils/slideFactory';
import { jsonToYDoc, yDocToJson } from '../collab/ySchema';
import { setActiveDoc } from '../collab/yDocAdapter';
import { createUndoManagerFor, setActiveUndoManager } from '../collab/activeUndo';

let nextId = 0;
vi.mocked(generateId).mockImplementation(() => `generated-${++nextId}`);
afterEach(() => { setActiveUndoManager(null); setActiveDoc(null); });
function fixture(count = 5) {
  const p = createPresentation();
  p.slides = {}; p.slideOrder = [];
  for (let i = 0; i < count; i++) {
    const id = String(i), slide = createSlide();
    p.slides[id] = { ...slide, id, groupId: 'original', autoAdvanceDelay: i, hidden: i === 2,
      notes: `notes-${i}`, elements: { shape: createShapeElement('rect', { id: 'shape' }) }, elementOrder: ['shape'] };
    p.slideOrder.push(id);
  }
  return p;
}

describe.each(['splitSlideGroup', 'removeSlideFromGroup'] as const)('%s dual-path', action => {
  it.each([['0', 5], ['1', 5], ['2', 5], ['4', 5], ['0', 2], ['1', 2]] as const)('%s of %s: equal JSON/Yjs, contents/order/selection preserved, one isolated undo', (id, count) => {
    const p = fixture(count), results = [];
    for (const collab of [false, true]) {
      store.setState({ presentation: structuredClone(p) });
      store.temporal.getState().clear();
      editor.setState({ activeSlideId: id, selectedSlideIds: [id, '1'] });
      const doc = collab ? jsonToYDoc(p) : null;
      setActiveDoc(doc);
      const undo = doc ? createUndoManagerFor(doc) : null;
      setActiveUndoManager(undo);
      // A prior unrelated change must not be absorbed into the membership undo.
      store.getState().updateSlideNotes('0', 'prior');
      const read = () => doc ? yDocToJson(doc) : store.getState().presentation;
      const before = structuredClone(read());
      nextId = 1000;
      store.getState()[action](id);
      const result = structuredClone(read());
      results.push({ ...result, updatedAt: 0 });
      expect(result.slideOrder).toEqual(before.slideOrder);
      for (const sid of p.slideOrder) {
        const { groupId: _a, ...a } = result.slides[sid];
        const { groupId: _b, ...b } = before.slides[sid];
        expect(a).toEqual(b);
      }
      expect(editor.getState().activeSlideId).toBe(id);
      expect(editor.getState().selectedSlideIds).toEqual([id, '1']);
      const noOp = action === 'splitSlideGroup' && id === '0';
      expect(undo?.undoStack.length ?? store.temporal.getState().pastStates.length).toBe(noOp ? 1 : 2);
      if (!noOp) {
        if (undo) undo.undo(); else store.temporal.getState().undo();
        expect(read()).toEqual(before);
        if (undo) undo.redo(); else store.temporal.getState().redo();
        expect(read()).toEqual(result);
      }
      setActiveUndoManager(null); setActiveDoc(null); doc?.destroy();
    }
    expect(results[0]).toEqual(results[1]);
  });
});

it.each([false, true])('disjoint id reuse, explicit whole-id Ungroup collab=%s', collab => {
  const p = fixture(7);
  delete p.slides['2'].groupId;
  const doc = collab ? jsonToYDoc(p) : null;
  store.setState({ presentation: p }); setActiveDoc(doc);
  const read = () => doc ? yDocToJson(doc) : store.getState().presentation;
  store.getState().removeSlideFromGroup('0');
  expect(read().slides['3'].groupId).toBe('original');
  expect(read().slides['1'].groupId).toBeUndefined();
  store.getState().ungroupSlides(['3']);
  expect(Object.values(read().slides).every(s => !s.groupId)).toBe(true);
  setActiveDoc(null); doc?.destroy();
});
