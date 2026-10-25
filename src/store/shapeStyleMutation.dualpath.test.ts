import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('../utils/keyboard', () => ({ isShiftHeld: () => false, isCtrlHeld: () => false }));
import { usePresentationStore as store } from './presentationStore';
import { useEditorStore as editor } from './editorStore';
import { useCreationPreferences } from './creationPreferences';
import { updateShapeStyleFromCurrent } from './shapeStyleMutation';
import { updateElementFromCurrent } from './currentMutation';
import { runScrubSession } from '../components/controls/useScrubCommit';
import { createPresentation, createShapeElement } from '../utils/slideFactory';
import { jsonToYDoc, yDocToJson } from '../collab/ySchema';
import { setActiveDoc } from '../collab/yDocAdapter';
import { beginScrubCapture, createUndoManagerFor, setActiveUndoManager } from '../collab/activeUndo';
import type { ShapeElement } from '../types/presentation';
afterEach(() => { setActiveUndoManager(null); setActiveDoc(null); useCreationPreferences.setState({ styles: {} }); });
describe.each([false, true])('accepted authored style family collab=%s', collab => {
  it('stamps pre-edit family in the same undo, preserves it through mode/head edits and never teaches undo', () => {
    const p = createPresentation(), sid = p.slideOrder[0];
    const shape = createShapeElement('path', { id: 'legacy', points: [0, 0, 100, 100], curve: 'linear' });
    p.slides[sid].elements = { legacy: shape }; p.slides[sid].elementOrder = ['legacy'];
    store.setState({ presentation: p }); editor.setState({ activeSlideId: sid, selectedSlideIds: [], autoDrawMode: false });
    store.temporal.getState().clear();
    const doc = collab ? jsonToYDoc(p) : null; setActiveDoc(doc);
    const mgr = doc ? createUndoManagerFor(doc) : null; setActiveUndoManager(mgr);
    const read = () => (doc ? yDocToJson(doc) : store.getState().presentation).slides[sid].elements.legacy as ShapeElement;
    updateShapeStyleFromCurrent(sid, shape, { curve: 'smooth', endHead: 'triangle' });
    expect(read()).toMatchObject({ creationPreset: 'line', curve: 'smooth', endHead: 'triangle' });
    expect(useCreationPreferences.getState().styles).toEqual({ line: { curve: 'smooth', endHead: 'triangle' } });
    expect(mgr?.undoStack.length ?? store.temporal.getState().pastStates.length).toBe(1);
    if (mgr) mgr.undo(); else store.temporal.getState().undo();
    expect(read().creationPreset).toBe(shape.creationPreset); expect(read().curve).toBe('linear');
    expect(useCreationPreferences.getState().styles.line?.curve).toBe('smooth');
    setActiveUndoManager(null); setActiveDoc(null); doc?.destroy();
  });
  it('scrub previews/cancel never stamp or learn; final acceptance does so within one captured undo', () => {
    const p = createPresentation(), sid = p.slideOrder[0], shape = createShapeElement('rect', { id: 'legacy' });
    p.slides[sid].elements = { legacy: shape }; p.slides[sid].elementOrder = ['legacy'];
    store.setState({ presentation: p }); editor.setState({ activeSlideId: sid, selectedSlideIds: [], autoDrawMode: false }); store.temporal.getState().clear();
    const doc = collab ? jsonToYDoc(p) : null; setActiveDoc(doc);
    const mgr = doc ? createUndoManagerFor(doc) : null; setActiveUndoManager(mgr);
    const read = () => (doc ? yDocToJson(doc) : store.getState().presentation).slides[sid].elements.legacy as ShapeElement;
    let finish: ((cancelled: boolean) => void) | undefined;
    const session = runScrubSession<Partial<ShapeElement>>({
      pause: () => { store.temporal.getState().pause(); finish = beginScrubCapture(mgr); },
      resume: () => store.temporal.getState().resume(),
      snapshot: () => ({ strokeWidth: read().strokeWidth }),
      apply: changes => updateElementFromCurrent(sid, shape, changes),
      commit: changes => updateShapeStyleFromCurrent(sid, shape, changes),
      finish: cancelled => finish?.(cancelled),
    });
    session.begin(); session.preview({ strokeWidth: 8 });
    expect(read().creationPreset).toBe(shape.creationPreset); expect(useCreationPreferences.getState().styles).toEqual({});
    session.cancel(); expect(read().strokeWidth).toBe(2); expect(read().creationPreset).toBe(shape.creationPreset);
    session.begin(); session.preview({ strokeWidth: 8 }); session.end({ strokeWidth: 8 });
    expect(read()).toMatchObject({ strokeWidth: 8, creationPreset: 'rect' });
    expect(useCreationPreferences.getState().styles.rect?.strokeWidth).toBe(8);
    expect(mgr?.undoStack.length ?? store.temporal.getState().pastStates.length).toBe(1);
    if (mgr) mgr.undo(); else store.temporal.getState().undo();
    expect(read().creationPreset).toBe(shape.creationPreset); expect(read().strokeWidth).toBe(2);
    expect(useCreationPreferences.getState().styles.rect?.strokeWidth).toBe(8);
    setActiveUndoManager(null); setActiveDoc(null); doc?.destroy();
  });
});
