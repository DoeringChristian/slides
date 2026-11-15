import { afterEach, describe, expect, it } from 'vitest';
import { usePresentationStore as store } from './presentationStore';
import { setActiveDoc } from '../collab/yDocAdapter';
import { createUndoManagerFor } from '../collab/activeUndo';
import { jsonToYDoc, yDocToJson } from '../collab/ySchema';
import { createPresentation, createShapeElement } from '../utils/model/slideFactory';

afterEach(() => setActiveDoc(null));

describe.each([false, true])('resetPresentation collab=%s', collab => {
  it('clears the open deck in place, keeping its project identity', () => {
    const p = createPresentation();
    const sid = p.slideOrder[0];
    const box = createShapeElement('rect', { id: 'box', x: 10, y: 10, width: 50, height: 50 });
    p.title = 'Talk';
    p.slides[sid].elements = { box };
    p.slides[sid].elementOrder = ['box'];
    store.setState({ presentation: p });
    const doc = collab ? jsonToYDoc(p) : null;
    setActiveDoc(doc);
    const undo = doc ? createUndoManagerFor(doc) : null;
    const read = () => (doc ? yDocToJson(doc) : store.getState().presentation);
    try {
      store.getState().resetPresentation();
      const after = read();
      // The id is the project's identity; a reset that minted a new one left
      // the project open under one id while autosave wrote another.
      expect(after.id).toBe(p.id);
      expect(after.createdAt).toBe(p.createdAt);
      expect(after.slideOrder).toHaveLength(1);
      expect(after.slideOrder[0]).not.toBe(sid);
      expect(Object.values(after.slides[after.slideOrder[0]].elements)).toEqual([]);
      expect(after.title).not.toBe('Talk');
      if (undo) {
        // One transaction, so one undo step restores the whole deck.
        undo.undo();
        expect(yDocToJson(doc!).slides[sid].elements.box).toEqual(box);
      }
    } finally {
      setActiveDoc(null);
      doc?.destroy();
    }
  });
});
