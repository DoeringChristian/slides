import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('../utils/keyboard', () => ({ isShiftHeld: () => false, isCtrlHeld: () => false }));
import { usePresentationStore as store } from './presentationStore';
import { useEditorStore as editor } from './editorStore';
import { createUndoManagerFor } from '../collab/activeUndo';
import { setActiveDoc } from '../collab/yDocAdapter';
import { jsonToYDoc, yDocToJson } from '../collab/ySchema';
import { createPresentation, createShapeElement } from '../utils/slideFactory';
import { bindDraftEndpoints, rebindAfterElementsMoved } from '../utils/connectorUtils';
import { pathExtensionUpdate, pathPointsInSlide } from '../utils/pathEditing';
import { stationaryPathPair } from '../utils/pathInterpolation';
import type { ShapeElement } from '../types/presentation';

afterEach(() => setActiveDoc(null));
function fixture() {
  const left = createShapeElement('rect', { id: 'left', x: 0, y: 0, width: 100, height: 100 });
  const right = createShapeElement('rect', { id: 'right', x: 200, y: 0, width: 100, height: 100 });
  const bound = bindDraftEndpoints([95, 20, 205, 80], [left, right]);
  const { startBinding, endBinding } = bound;
  const a = { x: bound.absPoints[0], y: bound.absPoints[1] }, b = { x: bound.absPoints[2], y: bound.absPoints[3] };
  const arrow = createShapeElement('path', { id: 'arrow', x: a.x, y: a.y, width: b.x - a.x, height: b.y - a.y,
    points: [0, 0, b.x - a.x, b.y - a.y], startBinding, endBinding, endHead: 'triangle' });
  return { left, right, arrow };
}
describe.each([false, true])('native extension mutation JSON/Yjs collab=%s', collab => {
  it.each(['same-points', 'same-count-edit'])('%s keeps ordinary updateElement binding normalization', operation => {
    const p = createPresentation(), sid = p.slideOrder[0];
    const left = createShapeElement('rect', { id: 'left', x: 150, y: 140, width: 160, height: 160 });
    const box = createShapeElement('rect', { id: 'box', x: 450, y: 330, width: 300, height: 300 });
    const subject = createShapeElement('path', { id: 'subject', x: 300, y: 220, width: 200, height: 180,
      points: [0, 0, 200, 180], endHead: 'triangle',
      startBinding: { elementId: 'left', mode: 'aim', fixedPoint: [.5, .5], gap: 3 },
      endBinding: { elementId: 'box', mode: 'aim', fixedPoint: [.4, .4], gap: 0 } });
    p.slides[sid].elements = { left, box, subject }; p.slides[sid].elementOrder = ['left', 'box', 'subject'];
    store.setState({ presentation: p }); editor.setState({ activeSlideId: sid, selectedSlideIds: [] });
    const doc = collab ? jsonToYDoc(p) : null; setActiveDoc(doc);
    try {
      const points = operation === 'same-points' ? subject.points! : [0, 0, 210, 180];
      const edited = { ...subject, points }, elements = { left, box, subject: edited };
      // The pre-extension updateElement contract: self-edited bindings solve
      // without enabling the bulk-gesture stationary/resize exemptions.
      const expected = rebindAfterElementsMoved(elements, p.slides[sid].elementOrder, new Set(['subject']));
      expect(expected).toHaveLength(1);
      store.getState().updateElement(sid, 'subject', { points });
      const result = (doc ? yDocToJson(doc) : store.getState().presentation).slides[sid].elements.subject;
      expect(result).toEqual({ ...edited, ...expected[0].changes });
      expect(result).not.toEqual(edited);
    } finally { setActiveDoc(null); doc?.destroy(); }
  });
  it.each(['start', 'end'] as const)('%s retains off-focus opposite incoming geometry and exact keyframe undo', end => {
    const p = createPresentation(), sid = p.slideOrder[0], elements = fixture();
    p.slides[sid].elements = elements; p.slides[sid].elementOrder = Object.keys(elements);
    store.setState({ presentation: p }); editor.setState({ activeSlideId: sid, selectedSlideIds: [] });
    const doc = collab ? jsonToYDoc(p) : null; setActiveDoc(doc);
    const undo = doc ? createUndoManagerFor(doc) : null;
    const read = () => doc ? yDocToJson(doc) : store.getState().presentation;
    try {
      const bid = store.getState().duplicateSlide(sid);
      undo?.clear(); undo?.stopCapturing(); store.temporal.getState().clear();
      const before = read(), a = before.slides[bid].elements.arrow as ShapeElement, world = pathPointsInSlide(a);
      const points = end === 'start' ? [-100, -50, ...world] : [...world, 400, 150];
      const patch = { ...pathExtensionUpdate(a, points, end), [end === 'start' ? 'startBinding' : 'endBinding']: null };
      store.getState().updateElement(bid, 'arrow', patch);
      const after = read(), b = after.slides[bid].elements.arrow as ShapeElement;
      const expected = { ...a, ...patch };
      pathPointsInSlide(b).forEach((v, i) => expect(v).toBeCloseTo(pathPointsInSlide(expected)[i], 10));
      expect(b.startBinding).toEqual(expected.startBinding); expect(b.endBinding).toEqual(expected.endBinding);
      expect(stationaryPathPair(a, b)).not.toBeNull();
      expect(after.slides[sid]).toEqual(before.slides[sid]);
      expect(after.slideOrder).toEqual(before.slideOrder);
      expect(b.id).toBe(a.id);
      expect(undo?.undoStack.length ?? store.temporal.getState().pastStates.length).toBe(1);
      if (undo) undo.undo(); else store.temporal.getState().undo();
      expect(read().slides).toEqual(before.slides);
      if (undo) undo.redo(); else store.temporal.getState().redo();
      expect(read().slides).toEqual(after.slides);
    } finally { undo?.destroy(); setActiveDoc(null); doc?.destroy(); }
  });
});
