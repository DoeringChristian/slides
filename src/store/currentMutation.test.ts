import { afterEach, describe, expect, test, vi } from 'vitest';
import type { ReactElement } from 'react';
vi.mock('../utils/keyboard', () => ({ isShiftHeld: () => false, isCtrlHeld: () => false }));
import { usePresentationStore as store } from './presentationStore';
import { useEditorStore as editor } from './editorStore';
import { createPresentation, createTextElement, copySlideAsKeyframe } from '../utils/slideFactory';
import { jsonToYDoc, yDocToJson, getYElement } from '../collab/ySchema';
import { setActiveDoc } from '../collab/yDocAdapter';
import { createUndoManagerFor, beginScrubCapture } from '../collab/activeUndo';
import { runScrubSession } from '../components/controls/useScrubCommit';
import { ColorProperty, SelectProperty, PreviewSelectProperty, NumberProperty, CheckboxProperty, copyNestedFields } from '../components/properties/Property';
import { beforeLocalMutation } from '../utils/scrubMutation';
import { readElementForMutation, readKeyframeForMutation, updateElementFromCurrent, type CurrentChange } from './currentMutation';
import type { TextElement } from '../types/presentation';

afterEach(() => { beforeLocalMutation(); setActiveDoc(null); });
function fixture(collab: boolean) {
  const p = createPresentation(), sid = p.slideOrder[0];
  const text = createTextElement({ id: 'text' }); text.style.fontSize = 24; text.style.fontWeight = 'normal';
  p.objects.text = { id: 'text', name: 'Text', type: 'text' };
  p.slides[sid].elements = { text }; p.slides[sid].elementOrder = ['text'];
  const next = copySlideAsKeyframe(p.slides[sid]);
  (next.elements.text as TextElement).style.color = '#ff0000';
  p.slides[next.id] = next; p.slideOrder.push(next.id);
  store.setState({ presentation: p }); store.temporal.getState().clear();
  editor.setState({ activeSlideId: sid, selectedSlideIds: [], autoDrawMode: false });
  const doc = collab ? jsonToYDoc(p) : null; setActiveDoc(doc);
  const manager = doc ? createUndoManagerFor(doc) : null;
  const read = () => (doc ? yDocToJson(doc) : store.getState().presentation).slides[sid].elements.text as TextElement;
  const update = (changes: CurrentChange<TextElement>) => updateElementFromCurrent(sid, text, changes);
  let finish: ((cancelled: boolean) => void) | undefined;
  const session = runScrubSession<CurrentChange<TextElement>>({
    snapshot: () => current => copyNestedFields(text, current, ['style.fontSize']),
    pause: () => { store.temporal.getState().pause(); finish = beginScrubCapture(manager); },
    resume: () => store.temporal.getState().resume(), apply: update,
    finish: cancelled => finish?.(cancelled),
  });
  const sync = () => { if (doc) store.setState({ presentation: yDocToJson(doc) }); };
  const undo = () => manager ? manager.undo() : store.temporal.getState().undo();
  const redo = () => manager ? manager.redo() : store.temporal.getState().redo();
  const count = () => manager ? manager.undoStack.length : store.temporal.getState().pastStates.length;
  const cleanup = () => { beforeLocalMutation(); manager?.destroy(); setActiveDoc(null); doc?.destroy(); };
  return { sid, text, next, doc, read, update, session, sync, undo, redo, count, cleanup };
}

describe.each([false, true])('authoritative nested mutation (collab=%s)', collab => {
  test.each(['color', 'select', 'preview'] as const)('%s property callback does not spread cancelled font size from rendered props', kind => {
    const f = fixture(collab);
    f.session.begin(); f.session.preview(current => ({ style: { ...current.style, fontSize: 34 } })); f.sync();
    const stale = store.getState().presentation.slides[f.sid].elements.text as TextElement;
    expect(stale.style.fontSize).toBe(34);
    const prop = kind === 'color' ? new ColorProperty<TextElement>({ key: 'style.color', label: 'Color' })
      : kind === 'select' ? new SelectProperty<TextElement>({ key: 'style.color', label: 'Color', options: [{ value: '#123456', label: 'Test' }] })
      : new PreviewSelectProperty<TextElement>({ key: 'style.color', label: 'Color', options: [{ value: '#123456', label: 'Test', preview: () => null }] });
    const node = prop.renderEditor({ element: stale, update: f.update }) as ReactElement<{ onChange(v: string): void }>;
    node.props.onChange('#123456');
    expect(f.read().style).toEqual({ ...f.text.style, color: '#123456' }); expect(f.count()).toBe(1);
    // No UI microtask is needed to make the authoritative callback safe.
    if (collab) expect((store.getState().presentation.slides[f.sid].elements.text as TextElement).style.fontSize).toBe(34);
    f.session.preview(current => ({ style: { ...current.style, fontSize: 40 } })); f.session.cancel(); f.session.end({ opacity: 0.1 });
    f.undo(); expect(f.read().style).toEqual(f.text.style);
    f.redo(); expect(f.read().style).toEqual({ ...f.text.style, color: '#123456' });
    f.cleanup();
  });
  test('keyframe reset copies named fields into authoritative current siblings', () => {
    const f = fixture(collab);
    f.session.begin(); f.session.preview(current => ({ style: { ...current.style, fontSize: 34 } })); f.sync();
    const property = new ColorProperty<TextElement>({ key: 'style.color', label: 'Color' });
    const source = readKeyframeForMutation(f.sid, 'text', 'next') as TextElement;
    f.update(current => property.copyFromKeyframe(source, current));
    expect(f.read().style).toEqual({ ...f.text.style, color: '#ff0000' }); expect(f.count()).toBe(1);
    f.undo(); expect(f.read().style).toEqual(f.text.style); f.redo(); expect(f.read().style.fontSize).toBe(24);
    f.cleanup();
  });
  test('owned callbacks preserve preview history; discrete callback after cancellation uses fresh siblings', () => {
    const f = fixture(collab);
    f.session.begin(); f.session.preview(current => ({ style: { ...current.style, fontSize: 34 } })); f.sync();
    f.session.commitDiscrete(current => ({ style: { ...current.style, lineHeight: 2 } }));
    expect(f.read().style).toEqual({ ...f.text.style, lineHeight: 2 }); expect(f.count()).toBe(1);
    f.undo(); expect(f.read().style).toEqual(f.text.style);
    f.redo(); expect(f.read().style.fontSize).toBe(24);
    f.cleanup();
  });
  test('completed scrub evaluates final callback after restore and still has one undo', () => {
    const f = fixture(collab);
    f.session.begin(); f.session.preview(current => ({ style: { ...current.style, fontSize: 34 } })); f.sync();
    f.session.end(current => ({ style: { ...current.style, fontSize: 40 } }));
    expect(f.read().style.fontSize).toBe(40); expect(f.count()).toBe(1);
    f.undo(); expect(f.read().style).toEqual(f.text.style);
    f.cleanup();
  });
  test('read boundary is synchronous and delayed callback cannot recreate deleted elements', () => {
    const f = fixture(collab);
    f.session.begin(); f.session.preview(current => ({ style: { ...current.style, fontSize: 34 } })); f.sync();
    expect((readElementForMutation(f.sid, 'text') as TextElement).style.fontSize).toBe(24);
    store.getState().removeObject('text');
    const build = vi.fn(() => ({ opacity: 0.1 })); f.update(build);
    expect(build).not.toHaveBeenCalled();
    f.cleanup();
  });
});

test('keyframe source comes from current Yjs rather than stale neighbour render props', () => {
  const f = fixture(true);
  f.session.begin(); f.session.preview(current => ({ style: { ...current.style, fontSize: 34 } })); f.sync();
  f.doc!.transact(() => {
    const style = getYElement(f.doc!, f.next.id, 'text')!.get('style') as import('yjs').Map<unknown>;
    style.set('color', '#abcdef');
  }, 'remote-peer');
  expect((store.getState().presentation.slides[f.next.id].elements.text as TextElement).style.color).toBe('#ff0000');
  const source = readKeyframeForMutation(f.sid, 'text', 'next') as TextElement;
  expect(source.style.color).toBe('#abcdef');
  f.update(current => copyNestedFields(source, current, ['style.color']));
  expect(f.read().style).toEqual({ ...f.text.style, color: '#abcdef' }); expect(f.count()).toBe(1);
  f.undo(); expect(f.read().style).toEqual(f.text.style);
  f.cleanup();
});

test('generic nested checkbox and shared-root keyframe fields use current siblings', () => {
  const stale = { settings: { size: 34, enabled: false, color: 'red' } };
  let current = { settings: { size: 24, enabled: false, color: 'blue' } };
  const property = new CheckboxProperty<typeof current>({ key: 'settings.enabled', label: 'Enabled' });
  const node = property.renderEditor({ element: stale, update: changes => {
    current = { ...current, ...(typeof changes === 'function' ? changes(current) : changes) };
  } }) as ReactElement<{ onChange(v: boolean): void }>;
  node.props.onChange(true);
  expect(current.settings).toEqual({ size: 24, enabled: true, color: 'blue' });
  const pair = new NumberProperty<typeof current>({ key: 'settings.size', label: 'Pair', syncFields: ['settings.size', 'settings.color'] });
  expect(pair.copyFromKeyframe(stale, current)).toEqual({ settings: { size: 34, color: 'red', enabled: true } });
});
