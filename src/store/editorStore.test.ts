import { afterEach, describe, expect, test } from 'vitest';
import { useEditorStore as editor } from './editorStore';
import { usePresentationStore as store } from './presentationStore';
import { setActiveDoc } from '../collab/yDocAdapter';
import { jsonToYDoc } from '../collab/ySchema';
import { createPresentation, createShapeElement } from '../utils/slideFactory';

afterEach(() => { setActiveDoc(null); editor.setState({ selectedElementIds: [], selectedSlideIds: [] }); });
describe('create keyframe below → immediately activate (SlidePanel caller sequence)', () => {
  for (const collab of [false, true]) for (const action of ['addSlide', 'duplicateSlide', 'addSlideWithMode', 'addEmptySlide'] as const) {
    test(`${action}, ${collab ? 'Yjs before queued UI sync' : 'JSON'}`, () => {
      const p = createPresentation(), sid = p.slideOrder[0];
      const arrow = createShapeElement('path', { id: 'arrow', points: [0, 0, 100, 50], endHead: 'triangle' });
      p.slides[sid].elements = { arrow }; p.slides[sid].elementOrder = ['arrow'];
      store.setState({ presentation: p });
      editor.setState({ activeSlideId: sid, selectedElementIds: ['arrow', 'absent'] });
      const doc = collab ? jsonToYDoc(p) : null; setActiveDoc(doc);
      const s = store.getState();
      const id = action === 'duplicateSlide' ? s.duplicateSlide(sid)
        : action === 'addSlideWithMode' ? s.addSlideWithMode(0, 'previous') : s[action](1);
      if (collab) expect(store.getState().presentation.slides[id]).toBeUndefined();
      editor.getState().setActiveSlide(id);
      expect(editor.getState().selectedElementIds).toEqual(action === 'addEmptySlide' ? [] : ['arrow']);
      expect(editor.getState().activeSlideId).toBe(id);
      setActiveDoc(null); doc?.destroy();
    });
  }
});
