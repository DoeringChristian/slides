import { afterEach, describe, expect, test, vi } from 'vitest';
import { usePresentationStore as store } from './presentationStore';
import { useEditorStore } from './editorStore';
import * as schema from '../collab/ySchema';
import { setActiveDoc } from '../collab/yDocAdapter';
import { createUndoManagerFor } from '../collab/activeUndo';
import { createPresentation, createShapeElement, createTextElement, copySlideAsKeyframe } from '../utils/slideFactory';
import { mergeObjectConflictSlideIds } from '../utils/mergeObjects';
import { findBoundText } from '../utils/syncDependents';

function fixture(sourceVisible = true, targetVisible = false, labels = true) {
  const p = createPresentation(), slide = p.slides[p.slideOrder[0]];
  const source = createShapeElement('path', { id: 'source', visible: sourceVisible, points: [0, 0, 100, 90], endHead: 'triangle', transitions: { position: 'ease' } });
  const target = createShapeElement('rect', { id: 'target', visible: targetVisible, x: 500 });
  const a = createTextElement({ id: 'source-label', containerId: 'source', text: 'Source label', visible: sourceVisible });
  const b = createTextElement({ id: 'target-label', containerId: 'target', text: 'Target label', visible: targetVisible });
  const elements = labels ? [target, b, source, a] : [target, source];
  slide.elements = Object.fromEntries(elements.map(el => [el.id, el])); slide.elementOrder = elements.map(el => el.id);
  p.objects = Object.fromEntries(elements.map(el => [el.id, { id: el.id, name: el.id, type: el.type as 'shape' | 'text' }]));
  const next = copySlideAsKeyframe(slide); p.slides[next.id] = next; p.slideOrder.push(next.id);
  next.elements.source.visible = true; next.elements.target.visible = false;
  if (labels) { next.elements['source-label'].visible = true; next.elements['target-label'].visible = false; }
  return p;
}
const normalized = (p: ReturnType<typeof fixture>) => JSON.parse(JSON.stringify({ ...p, updatedAt: 0 }));
afterEach(() => { setActiveDoc(null); vi.restoreAllMocks(); });

describe('mergeObjects visibility policy, atomicity and label lifecycle', () => {
  for (const collab of [false, true]) {
    for (const [sourceVisible, targetVisible] of [[true, false], [false, true], [true, true], [false, false]]) {
      test(`${collab ? 'Yjs' : 'JSON'} source ${sourceVisible}, target ${targetVisible}`, () => {
        const p = fixture(sourceVisible, targetVisible), sid = p.slideOrder[0];
        store.setState({ presentation: p }); store.temporal.getState().clear();
        useEditorStore.setState({ selectedSlideIds: [], autoDrawMode: false });
        const doc = collab ? schema.jsonToYDoc(p) : null; setActiveDoc(doc);
        const undo = doc ? createUndoManagerFor(doc) : null;
        const read = () => doc ? schema.yDocToJson(doc) : store.getState().presentation;
        expect(mergeObjectConflictSlideIds(p.slides, 'target', 'source')).toEqual(sourceVisible && targetVisible ? [sid] : []);
        const result = store.getState().mergeObjects('target', 'source');
        expect(result.merged).toBe(true); expect(result.droppedOnSlides).toEqual(sourceVisible && targetVisible ? [sid] : []);
        const next = read(), slide = next.slides[sid];
        const sourceWins = sourceVisible && !targetVisible;
        expect(slide.elements.target).toEqual({ ...p.slides[sid].elements[sourceWins ? 'source' : 'target'], id: 'target' });
        expect(slide.elementOrder.filter(id => id === 'target')).toHaveLength(1);
        expect(slide.elements.source).toBeUndefined(); expect(next.objects.source).toBeUndefined();
        const loser = sourceWins ? 'target-label' : 'source-label', winner = sourceWins ? 'source-label' : 'target-label';
        expect(slide.elements[loser].visible).toBe(false); expect(slide.elements[loser]).not.toHaveProperty('containerId');
        expect(findBoundText(slide, 'target')?.id).toBe(winner);
        // Other keyframes have their own winner; source label remains legitimate there.
        expect(next.slides[p.slideOrder[1]].elements['source-label'].visible).toBe(true);
        if (undo) { expect(undo.undoStack).toHaveLength(1); undo.undo(); }
        else { expect(store.temporal.getState().pastStates).toHaveLength(1); store.temporal.getState().undo(); }
        expect(normalized(read())).toEqual(normalized(p));
        if (undo) undo.redo(); else store.temporal.getState().redo();
        store.getState().hideElement(sid, 'target'); store.getState().unhideElement(sid, 'target');
        expect(read().slides[sid].elements[loser].visible).toBe(false);
        undo?.destroy(); setActiveDoc(null); doc?.destroy();
      });
    }
    test(`${collab ? 'Yjs' : 'JSON'} winner without label retains sole label and rejected merge is unchanged`, () => {
      const p = fixture(), sid = p.slideOrder[0];
      delete p.slides[sid].elements['source-label']; p.slides[sid].elementOrder = p.slides[sid].elementOrder.filter(id => id !== 'source-label');
      store.setState({ presentation: p });
      const doc = collab ? schema.jsonToYDoc(p) : null; setActiveDoc(doc);
      const read = () => doc ? schema.yDocToJson(doc) : store.getState().presentation;
      const before = normalized(read());
      expect(store.getState().mergeObjects('target', 'target').merged).toBe(false);
      expect(store.getState().mergeObjects('target', 'missing').merged).toBe(false);
      expect(normalized(read())).toEqual(before);
      store.getState().mergeObjects('target', 'source');
      expect(read().slides[sid].elements['target-label']).toEqual(p.slides[sid].elements['target-label']);
      setActiveDoc(null); doc?.destroy();
    });
  }
  test('second Y subtree conversion failure leaves ALL slides, registry and references untouched', () => {
    const p = fixture(), doc = schema.jsonToYDoc(p); store.setState({ presentation: p }); setActiveDoc(doc);
    const before = schema.yDocToJson(doc), original = schema.elementToYMap;
    let calls = 0;
    vi.spyOn(schema, 'elementToYMap').mockImplementation(el => { if (++calls === 2) throw new Error('injected conversion failure'); return original(el); });
    expect(() => store.getState().mergeObjects('target', 'source')).toThrow('injected conversion failure');
    expect(schema.yDocToJson(doc)).toEqual(before);
    setActiveDoc(null); doc.destroy();
  });
});
