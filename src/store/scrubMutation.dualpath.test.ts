import { afterEach, describe, expect, test, vi } from 'vitest';
vi.mock('../utils/keyboard', () => ({ isShiftHeld: () => false, isCtrlHeld: () => false }));
import { usePresentationStore as store } from './presentationStore';
import { useEditorStore as editor } from './editorStore';
import { createPresentation, createTextElement } from '../utils/slideFactory';
import { jsonToYDoc, yDocToJson } from '../collab/ySchema';
import { setActiveDoc } from '../collab/yDocAdapter';
import { beginScrubCapture, createUndoManagerFor } from '../collab/activeUndo';
import { runScrubSession } from '../components/controls/useScrubCommit';
import { beforeLocalMutation } from '../utils/scrubMutation';

afterEach(() => { beforeLocalMutation(); setActiveDoc(null); vi.useRealTimers(); });

function fixture(collab: boolean) {
  const p = createPresentation(), sid = p.slideOrder[0], text = createTextElement({ id: 'text' });
  p.slides[sid].elements = { text }; p.slides[sid].elementOrder = ['text'];
  store.setState({ presentation: p }); store.temporal.getState().clear();
  editor.setState({ activeSlideId: sid, selectedSlideIds: [], autoDrawMode: false });
  const doc = collab ? jsonToYDoc(p) : null;
  setActiveDoc(doc);
  const mgr = doc ? createUndoManagerFor(doc) : null;
  const read = () => (doc ? yDocToJson(doc) : store.getState().presentation).slides[sid].elements.text;
  let finish: ((cancelled: boolean) => void) | undefined;
  const session = runScrubSession({
    snapshot: () => ({ opacity: read().opacity }),
    pause: () => { store.temporal.getState().pause(); finish = beginScrubCapture(mgr); },
    resume: () => store.temporal.getState().resume(),
    apply: (changes: { opacity: number }) => store.getState().updateElement(sid, 'text', changes),
    finish: (cancelled) => finish?.(cancelled),
  });
  const undo = () => mgr ? mgr.undo() : store.temporal.getState().undo();
  const redo = () => mgr ? mgr.redo() : store.temporal.getState().redo();
  const count = () => mgr ? mgr.undoStack.length : store.temporal.getState().pastStates.length;
  const cleanup = () => { beforeLocalMutation(); mgr?.destroy(); setActiveDoc(null); doc?.destroy(); };
  return { sid, doc, read, session, undo, redo, count, cleanup };
}

describe.each([false, true])('scrub local-mutation ownership (collab=%s)', collab => {
  test.each(['cancel', 'complete', 'history', 'project switch'] as const)('%s leaves unrelated edit and its undo independent', ending => {
    vi.useFakeTimers(); vi.setSystemTime(10000);
    const f = fixture(collab);
    f.session.begin(); f.session.preview({ opacity: 0.6 });
    vi.advanceTimersByTime(2000);
    store.getState().updateElement(f.sid, 'text', { x: 321 });
    expect(f.read().opacity).toBe(1); expect(f.read().x).toBe(321);
    if (ending === 'cancel') f.session.cancel();
    if (ending === 'history') { f.undo(); f.redo(); }
    if (ending === 'project switch') setActiveDoc(null);
    f.session.preview({ opacity: 0.3 }); f.session.end({ opacity: 0.2 });
    expect(f.read().opacity).toBe(1); expect(f.read().x).toBe(321); expect(f.count()).toBe(1);
    f.undo(); expect(f.read().x).not.toBe(321); expect(f.read().opacity).toBe(1);
    f.redo(); expect(f.read().x).toBe(321); expect(f.read().opacity).toBe(1);
    expect(store.temporal.getState().isTracking).toBe(true);
    f.cleanup();
  });
  test('completed scrub has one independent undo before a following mutation', () => {
    const f = fixture(collab);
    f.session.begin(); f.session.preview({ opacity: 0.6 }); f.session.end({ opacity: 0.4 });
    store.getState().updateElement(f.sid, 'text', { x: 321 });
    expect(f.count()).toBe(2); f.undo(); expect(f.read().opacity).toBe(0.4);
    f.undo(); expect(f.read().opacity).toBe(1);
    f.redo(); expect(f.read().opacity).toBe(0.4);
    f.cleanup();
  });
});

test('store mutation nested in a remote transaction is rejected before rollback/state reads', () => {
  const f = fixture(true);
  f.session.begin(); f.session.preview({ opacity: 0.6 });
  f.doc!.transact(() => {
    expect(() => store.getState().updateElement(f.sid, 'text', { x: 321 }))
      .toThrow('Local write during a remote transaction');
  }, 'remote');
  expect(f.read().opacity).toBe(0.6); expect(f.read().x).not.toBe(321);
  f.session.cancel(); expect(f.read().opacity).toBe(1); expect(f.count()).toBe(0);
  f.cleanup();
});

test('project replacement cancels a live JSON preview before recording replacement history', () => {
  const f = fixture(false), next = createPresentation();
  f.session.begin(); f.session.preview({ opacity: 0.6 });
  store.getState().loadPresentation(next);
  f.session.preview({ opacity: 0.2 }); f.session.end({ opacity: 0.1 });
  expect(store.getState().presentation.id).toBe(next.id);
  f.undo(); expect(f.read().opacity).toBe(1);
  expect(store.temporal.getState().isTracking).toBe(true);
  f.cleanup();
});

test('preview exceptions unwind ownership/history and leave the next local edit usable', () => {
  const resume = vi.fn(), finish = vi.fn();
  let value = 1;
  const session = runScrubSession({
    snapshot: () => value, pause: () => {}, resume, finish,
    apply: (v: number) => { if (v === 0.5) throw new Error('failed write'); value = v; },
  });
  session.begin(); expect(() => session.preview(0.5)).toThrow('failed write');
  expect(value).toBe(1); expect(resume).toHaveBeenCalledOnce(); expect(finish).toHaveBeenCalledWith(true);
  session.preview(0.4); session.end(0.3); expect(value).toBe(1);
  session.commitDiscrete(0.8); expect(value).toBe(0.8);
});
