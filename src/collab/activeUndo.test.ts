import { afterEach, describe, expect, test, vi } from 'vitest';
import * as Y from 'yjs';
import { beginScrubCapture, createUndoManagerFor } from './activeUndo';
import { beforeLocalMutation } from '../utils/scrubMutation';
import { LOCAL_ORIGIN } from './yDocAdapter';
import { ROOT_KEY } from './ySchema';
vi.mock('../utils/keyboard', () => ({ isShiftHeld: () => false, isCtrlHeld: () => false }));
import { runScrubSession } from '../components/controls/useScrubCommit';

afterEach(() => { beforeLocalMutation(); vi.useRealTimers(); });
function fixture() {
  const doc = new Y.Doc();
  const map = doc.getMap(ROOT_KEY);
  map.set('opacity', 1);
  const mgr = createUndoManagerFor(doc);
  const write = (value: number) => doc.transact(() => map.set('opacity', value), LOCAL_ORIGIN);
  let finish: ((cancelled: boolean) => void) | undefined;
  const session = runScrubSession({
    snapshot: () => map.get('opacity') as number,
    pause: () => { finish = beginScrubCapture(mgr); },
    resume: () => {}, apply: write, finish: (cancelled) => finish?.(cancelled),
  });
  return { doc, map, mgr, write, session };
}

describe('scrub Yjs capture lifetime', () => {
  test('pauses over 500ms still give one undo, isolated from preceding/following edits', () => {
    vi.useFakeTimers(); vi.setSystemTime(10000);
    const { doc, map, mgr, write, session } = fixture();
    write(0.8);
    session.begin(); session.preview(0.7);
    vi.advanceTimersByTime(2000); session.preview(0.6);
    vi.advanceTimersByTime(2000); session.end(0.5);
    expect(mgr.captureTimeout).toBe(500);
    expect(mgr.undoStack).toHaveLength(2);
    write(0.4);
    expect(mgr.undoStack).toHaveLength(3);
    mgr.undo(); expect(map.get('opacity')).toBe(0.5);
    mgr.undo(); expect(map.get('opacity')).toBe(0.8);
    mgr.undo(); expect(map.get('opacity')).toBe(1);
    mgr.redo(); mgr.redo(); expect(map.get('opacity')).toBe(0.5);
    doc.destroy();
  });
  test('cancel/lifecycle cleanup leaves no scrub undo/redo entry and revives earlier history', () => {
    const { doc, map, mgr, write, session } = fixture();
    write(0.8);
    session.begin(); session.preview(0.2); session.preview(0.1); session.cancel(); session.cancel();
    expect(map.get('opacity')).toBe(0.8);
    expect(mgr.captureTimeout).toBe(500);
    expect(mgr.undoStack).toHaveLength(1); expect(mgr.redoStack).toHaveLength(0);
    mgr.undo(); expect(map.get('opacity')).toBe(1);
    doc.destroy();
  });
  test('remote fields stay untouched by local scrub undo and cancellation', () => {
    const { doc, map, mgr, session } = fixture();
    session.begin(); session.preview(0.6);
    doc.transact(() => map.set('remote', 'peer edit'), 'remote-peer');
    session.end(0.4); mgr.undo();
    expect(map.get('opacity')).toBe(1); expect(map.get('remote')).toBe('peer edit');
    session.begin(); session.preview(0.2);
    doc.transact(() => map.set('remote', 'new peer edit'), 'remote-peer');
    session.cancel();
    expect(map.get('opacity')).toBe(1); expect(map.get('remote')).toBe('new peer edit');
    expect(mgr.captureTimeout).toBe(500);
    doc.destroy();
  });
  test('unrelated local write cancels preview before writing and retains independent undo', () => {
    vi.useFakeTimers(); vi.setSystemTime(10000);
    const { doc, map, mgr, session } = fixture();
    session.begin(); session.preview(0.6);
    vi.advanceTimersByTime(2000);
    doc.transact(() => map.set('bold', true), LOCAL_ORIGIN);
    session.cancel();
    expect(map.get('bold')).toBe(true);
    expect(map.get('opacity')).toBe(1);
    expect(mgr.undoStack).toHaveLength(1);
    session.preview(0.2); session.end(0.1); session.cancel();
    expect(map.get('opacity')).toBe(1);
    mgr.undo(); expect(map.get('bold')).toBeUndefined();
    mgr.redo(); expect(map.get('bold')).toBe(true);
    doc.destroy();
  });
  test('unrelated completion stays separate; a new gesture and discrete edit remain usable', () => {
    const { doc, map, mgr, session } = fixture();
    session.begin(); session.preview(0.6);
    doc.transact(() => map.set('bold', true), LOCAL_ORIGIN);
    session.end(0.4);
    expect(map.get('opacity')).toBe(1);
    session.commitDiscrete(0.9);
    mgr.stopCapturing();
    session.begin(); session.preview(0.5); session.end(0.3);
    mgr.undo(); expect(map.get('opacity')).toBe(0.9); expect(map.get('bold')).toBe(true);
    mgr.redo(); expect(map.get('opacity')).toBe(0.3);
    doc.destroy();
  });
  test('history operation invalidates the gesture before independent undo/redo', () => {
    const { doc, map, mgr, write, session } = fixture();
    write(0.8); session.begin(); session.preview(0.5);
    mgr.undo(); expect(map.get('opacity')).toBe(1);
    session.preview(0.2); session.end(0.1);
    expect(map.get('opacity')).toBe(1);
    mgr.redo(); expect(map.get('opacity')).toBe(0.8);
    doc.destroy();
  });
  test('remote changes to the scrubbed field survive cancellation', () => {
    const { doc, map, session } = fixture();
    session.begin(); session.preview(0.6);
    doc.transact(() => map.set('opacity', 0.75), 'remote-peer');
    session.cancel(); expect(map.get('opacity')).toBe(0.75);
    doc.destroy();
  });
  test('transact preserves return/throws and restores instance method on destruction/replacement', () => {
    const doc = new Y.Doc(), original = doc.transact;
    const first = createUndoManagerFor(doc);
    const second = createUndoManagerFor(doc), installed = doc.transact;
    first.destroy(); expect(doc.transact).toBe(installed);
    expect(doc.transact(() => 42, LOCAL_ORIGIN)).toBe(42);
    expect(() => doc.transact(() => { throw new Error('test error'); }, LOCAL_ORIGIN)).toThrow('test error');
    second.destroy(); expect(doc.transact).toBe(original);
    const third = createUndoManagerFor(doc), laterWrapper = doc.transact.bind(doc);
    doc.transact = laterWrapper; third.destroy(); expect(doc.transact).toBe(laterWrapper);
    doc.destroy();
  });
  test('destroying a replaced manager cannot cancel a new manager gesture', () => {
    const doc = new Y.Doc(), map = doc.getMap(ROOT_KEY);
    map.set('opacity', 1);
    const first = createUndoManagerFor(doc), second = createUndoManagerFor(doc);
    let finish: ((cancelled: boolean) => void) | undefined;
    const session = runScrubSession({
      snapshot: () => map.get('opacity') as number,
      pause: () => { finish = beginScrubCapture(second); }, resume: () => {},
      apply: (v: number) => doc.transact(() => map.set('opacity', v), LOCAL_ORIGIN),
      finish: cancelled => finish?.(cancelled),
    });
    session.begin(); session.preview(0.4); first.destroy();
    expect(map.get('opacity')).toBe(0.4);
    session.end(0.3); second.undo(); expect(map.get('opacity')).toBe(1);
    second.destroy(); doc.destroy();
  });
  test('manager destruction rolls back a live session and restores capture state', () => {
    const { doc, map, mgr, session } = fixture();
    session.begin(); session.preview(0.4); mgr.destroy();
    expect(map.get('opacity')).toBe(1); expect(mgr.captureTimeout).toBe(500);
    session.preview(0.2); session.end(0.1); expect(map.get('opacity')).toBe(1);
    doc.destroy();
  });
  test('nested unrelated LOCAL_ORIGIN under a remote transaction is rejected before callback, without corrupting preview', () => {
    const { doc, map, mgr, session } = fixture();
    session.begin(); session.preview(0.6);
    const local = vi.fn(() => map.set('bold', true));
    doc.transact(() => {
      map.set('remote', 42);
      expect(() => doc.transact(local, LOCAL_ORIGIN)).toThrow('Local write during a remote transaction');
    }, 'remote');
    expect(local).not.toHaveBeenCalled();
    session.cancel(); expect(map.get('opacity')).toBe(1); expect(map.get('remote')).toBe(42);
    expect(mgr.undoStack).toHaveLength(0);
    // With no gesture, ordinary nested transactions keep native Yjs semantics.
    doc.transact(() => doc.transact(local, LOCAL_ORIGIN), LOCAL_ORIGIN);
    expect(map.get('bold')).toBe(true); mgr.undo(); expect(map.get('bold')).toBeUndefined();
    doc.destroy();
  });
  test('null manager and a no-write cancelled gesture do not affect history', () => {
    expect(() => beginScrubCapture(null)(true)).not.toThrow();
    const { doc, mgr, write } = fixture(); write(0.8);
    const end = beginScrubCapture(mgr); end(true); end(false);
    expect(mgr.undoStack).toHaveLength(1); expect(mgr.captureTimeout).toBe(500);
    doc.destroy();
  });
});
