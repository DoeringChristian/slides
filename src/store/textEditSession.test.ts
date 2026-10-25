import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPresentation, createTextElement, createShapeElement } from '../utils/slideFactory';
import { autoFitText, beginTextEditSession, subscribeTextFinishes, textFinishRevision, hasPendingTextFinish, getTextEditInitialText, markTextCreation } from './textEditSession';
import { usePresentationStore as store } from './presentationStore';
import { jsonToYDoc, yDocToJson, getYElement } from '../collab/ySchema';
import { setActiveDoc } from '../collab/yDocAdapter';
import { createUndoManagerFor, setActiveUndoManager, getActiveUndoManager } from '../collab/activeUndo';
import { layoutSvgText, type SvgTextDoc } from '../utils/textLayout';
import { textSizeFromDoc } from '../utils/userTextSizing';
import type { TextElement } from '../types/presentation';
vi.mock('../utils/textLayout', () => ({ layoutSvgText: vi.fn() }));
const docResult = { width: 80, height: 60, paths: [], totalLength: 0, lines: [] } satisfies SvgTextDoc;
let ydoc: ReturnType<typeof jsonToYDoc> | undefined;
afterEach(() => { setActiveUndoManager(null); setActiveDoc(null); ydoc?.destroy(); ydoc = undefined; vi.resetAllMocks(); });

function setup(collab: boolean, overrides: Partial<TextElement> = {}) {
  const p = createPresentation();
  const sid = p.slideOrder[0];
  const el = createTextElement({ id: 'text', text: 'old', textSizing: 'auto-content', ...overrides });
  p.slides[sid].elements = { text: el }; p.slides[sid].elementOrder = ['text'];
  p.slides.other = { ...structuredClone(p.slides[sid]), id: 'other' }; p.slideOrder.push('other');
  p.objects = { text: { id: 'text', name: 'Text', type: 'text' } };
  store.setState({ presentation: p }); store.temporal.getState().clear();
  if (collab) { ydoc = jsonToYDoc(p); setActiveDoc(ydoc); setActiveUndoManager(createUndoManagerFor(ydoc)); }
  vi.mocked(layoutSvgText).mockResolvedValue(docResult);
  const read = () => ydoc ? yDocToJson(ydoc) : store.getState().presentation;
  const undoCount = () => getActiveUndoManager()?.undoStack.length ?? store.temporal.getState().pastStates.length;
  return { sid, el, read, undoCount };
}

for (const collab of [false, true]) describe(collab ? 'Yjs text edit session' : 'JSON text edit session', () => {
  it('auto-fit switches user-width sizing with draft/newlines and one atomic geometry undo', async () => {
    const { sid, el, read, undoCount } = setup(collab, { textSizing: 'user-width', rotation: 37,
      transitions: { size: 'ease' }, style: { ...createTextElement().style, align: 'right', verticalAlign: 'bottom' } });
    const { autoFitTextGeometry } = await import('../utils/textAutoFit');
    await beginTextEditSession(sid, el).finish('draft\n\nnew line\n', 'auto-content');
    expect(read().slides[sid].elements.text).toEqual({ ...el, text: 'draft\n\nnew line\n', textSizing: 'auto-content',
      ...autoFitTextGeometry(el, { width: 80, height: 60 }) });
    expect(undoCount()).toBe(1);
    if (collab) getActiveUndoManager()!.undo(); else store.temporal.getState().undo();
    expect(read().slides[sid].elements.text).toEqual(el);
    if (collab) getActiveUndoManager()!.redo(); else store.temporal.getState().redo();
    await autoFitText(sid, read().slides[sid].elements.text as TextElement);
    expect(undoCount()).toBe(1);
  });
  it('bar queues behind accepted dirty finish without losing pending text or sizing intent', async () => {
    const { sid, el, read } = setup(collab, { textSizing: 'user-width' });
    let resolve!: (doc: SvgTextDoc) => void;
    vi.mocked(layoutSvgText).mockReturnValueOnce(new Promise(r => { resolve = r; }));
    const first = beginTextEditSession(sid, el).finish('accepted draft');
    const fit = autoFitText(sid, el);
    resolve(docResult); await Promise.all([first, fit]);
    expect(read().slides[sid].elements.text).toMatchObject({ text: 'accepted draft', textSizing: 'auto-content', width: 80 });
  });
  it('bar retries changed fonts and anchors against latest rotated geometry', async () => {
    const { sid, el, read } = setup(collab, { textSizing: 'user-width' });
    let resolve!: (doc: SvgTextDoc) => void;
    vi.mocked(layoutSvgText).mockReturnValueOnce(new Promise(r => { resolve = r; }));
    const fit = autoFitText(sid, el);
    store.getState().updateElement(sid, el.id, { x: 444, rotation: 53, style: { ...el.style, fontSize: 40, align: 'right' } });
    const latest = read().slides[sid].elements.text as TextElement;
    resolve(docResult); await fit;
    const { autoFitTextGeometry } = await import('../utils/textAutoFit');
    expect(read().slides[sid].elements.text).toMatchObject({ ...autoFitTextGeometry(latest, { width: 80, height: 60 }), textSizing: 'auto-content' });
    expect(layoutSvgText).toHaveBeenLastCalledWith('old', expect.objectContaining({ fontSize: 40, align: 'right' }), 80.001, undefined);
  });
  for (const conflict of ['content', 'binding', 'visibility', 'deckABA', 'docABA', 'fontFailure']) it(`bar rejects ${conflict} during measurement`, async () => {
    if (conflict === 'docABA' && !collab) return;
    const { sid, el, read } = setup(collab, { textSizing: 'user-width' });
    let resolve!: (doc: SvgTextDoc) => void;
    let reject!: (error: Error) => void;
    vi.mocked(layoutSvgText).mockReturnValueOnce(new Promise((yes, no) => { resolve = yes; reject = no; }));
    const fit = autoFitText(sid, el);
    if (conflict === 'content') {
      store.getState().updateElement(sid, el.id, { text: 'remote' });
      store.getState().updateElement(sid, el.id, { text: el.text });
    }
    if (conflict === 'binding') store.getState().updateElement(sid, el.id, { containerId: 'box' });
    if (conflict === 'visibility') {
      store.getState().updateElement(sid, el.id, { visible: false });
      store.getState().updateElement(sid, el.id, { visible: true });
    }
    if (conflict === 'deckABA') {
      const p = store.getState().presentation;
      store.setState({ presentation: { ...p, id: 'other-deck' } }); store.setState({ presentation: p });
    }
    if (conflict === 'docABA') { setActiveDoc(null); setActiveDoc(ydoc!); }
    const before = structuredClone(read().slides[sid]);
    if (conflict === 'fontFailure') reject(new Error('font failed')); else resolve(docResult);
    await fit; expect(read().slides[sid]).toEqual(before);
  });
  it('dirty auto-fit font failure keeps accepted text with original sizing/geometry in one undo', async () => {
    const { sid, el, read, undoCount } = setup(collab, { textSizing: 'user-width', rotation: 35 });
    vi.mocked(layoutSvgText).mockRejectedValueOnce(new Error('font failed'));
    await beginTextEditSession(sid, el).finish('accepted draft\nnever discard', 'auto-content');
    expect(read().slides[sid].elements.text).toEqual({ ...el, text: 'accepted draft\nnever discard' });
    expect(undoCount()).toBe(1);
    if (collab) getActiveUndoManager()!.undo(); else store.temporal.getState().undo();
    expect(read().slides[sid].elements.text).toEqual(el);
  });
  it('font failure after ownership conflict cannot fall back to stale draft', async () => {
    const { sid, el, read } = setup(collab, { textSizing: 'user-width' });
    let reject!: (error: Error) => void;
    vi.mocked(layoutSvgText).mockReturnValueOnce(new Promise((_, no) => { reject = no; }));
    const finish = beginTextEditSession(sid, el).finish('stale draft', 'auto-content');
    store.getState().updateElement(sid, el.id, { text: 'remote' });
    const before = structuredClone(read());
    reject(new Error('font failed')); await finish;
    expect(read()).toEqual(before);
  });
  it('bound text cannot acquire the action or resize its container', async () => {
    const { sid, el, read, undoCount } = setup(collab, { textSizing: 'user-width', containerId: 'box' });
    const before = structuredClone(read());
    await autoFitText(sid, el);
    expect(read()).toEqual(before); expect(undoCount()).toBe(0);
  });
  it('notifies pending and completion even for unchanged/cached finishes without history', async () => {
    const { sid, el, undoCount } = setup(collab);
    const states: boolean[] = [];
    const revision = textFinishRevision();
    const unsubscribe = subscribeTextFinishes(() => states.push(hasPendingTextFinish(sid, el.id)));
    await beginTextEditSession(sid, el).finish(el.text);
    unsubscribe();
    expect(states).toEqual([true, false]);
    expect(textFinishRevision()).toBe(revision + 2);
    expect(undoCount()).toBe(0);
  });
  it('one accepted content + size edit, idempotent finish, undo/redo and keyframe isolation', async () => {
    const { sid, el, read, undoCount } = setup(collab);
    const session = beginTextEditSession(sid, el);
    await Promise.all([session.finish('new'), session.finish('new')]);
    expect(read().slides[sid].elements.text).toMatchObject({ text: 'new', width: 80, height: 60, textSizing: 'auto-content' });
    expect(read().slides.other.elements.text).toEqual(el);
    expect(undoCount()).toBe(1);
    if (collab) getActiveUndoManager()!.undo(); else store.temporal.getState().undo();
    expect(read().slides[sid].elements.text).toEqual(el);
    if (collab) getActiveUndoManager()!.redo(); else store.temporal.getState().redo();
    expect(read().slides[sid].elements.text).toMatchObject({ text: 'new', width: 80 });
  });
  it('unchanged edit has no history and factory emits current sizing', async () => {
    const { sid, el, undoCount } = setup(collab, { textSizing: 'user-width' });
    await beginTextEditSession(sid, el).finish('old');
    expect(undoCount()).toBe(0);
    expect(createTextElement()).toMatchObject({ text: 'Double-click to edit', width: 300, height: 50 });
    expect(createTextElement().textSizing).toBe('user-width');
    expect(textSizeFromDoc(el, docResult)).toEqual({ width: 300, height: 60 });
  });
  it('empty cleanup is initial-gesture scoped, not existing empty free text', async () => {
    const { sid, el, read, undoCount } = setup(collab, { text: '' });
    await beginTextEditSession(sid, el).finish('');
    expect(undoCount()).toBe(0);
    markTextCreation(sid, el.id);
    const session = beginTextEditSession(sid, el);
    await session.finish(''); await session.finish('');
    expect(read().slides[sid].elements.text).toMatchObject({ visible: false });
    expect(read().slides.other.elements.text).toEqual(el);
    expect(undoCount()).toBe(1);
  });
  it('stale async content never overwrites a concurrent content mutation', async () => {
    const { sid, el, read } = setup(collab);
    let resolve!: (doc: SvgTextDoc) => void;
    vi.mocked(layoutSvgText).mockReturnValueOnce(new Promise(r => { resolve = r; }));
    const finish = beginTextEditSession(sid, el).finish('local');
    if (ydoc) ydoc.transact(() => getYElement(ydoc!, sid, el.id)!.set('text', 'remote'), 'remote');
    else store.getState().updateElement(sid, el.id, { text: 'remote' });
    resolve(docResult); await finish;
    expect(read().slides[sid].elements.text).toMatchObject({ text: 'remote', width: 300 });
  });
  it('style/wrap changes remeasure without overwriting concurrent position', async () => {
    const { sid, el, read } = setup(collab, { textSizing: 'user-width' });
    let resolve!: (doc: SvgTextDoc) => void;
    vi.mocked(layoutSvgText).mockReturnValueOnce(new Promise(r => { resolve = r; }));
    const finish = beginTextEditSession(sid, el).finish('typed');
    store.getState().updateElement(sid, el.id, { width: 200, x: 444, style: { ...el.style, fontSize: 40 } });
    resolve(docResult); await finish;
    expect(layoutSvgText).toHaveBeenLastCalledWith('typed', expect.objectContaining({ fontSize: 40 }), 200, undefined);
    expect(read().slides[sid].elements.text).toMatchObject({ text: 'typed', width: 200, x: 444, height: 60 });
  });
  it('bound edit fits current policy in the same content undo entry', async () => {
    const { sid, el, read, undoCount } = setup(collab, { containerId: 'box', textSizing: 'user-width', boundTextLayout: 'measured' });
    store.getState().addElement(sid, createShapeElement('rect', { id: 'box', width: 200, height: 70 }));
    if (collab) getActiveUndoManager()!.clear(); else store.temporal.getState().clear();
    await beginTextEditSession(sid, el).finish('bound edit');
    expect(read().slides[sid].elements.text).toMatchObject({ text: 'bound edit', height: 60, boundTextLayout: 'measured', boundTextBaselineHeight: 70 });
    expect(read().slides[sid].elements.box.height).toBe(70);
    expect(undoCount()).toBe(1);
  });
  it('accept, reopen and exit unchanged retains the accepted draft with exactly one undo', async () => {
    const { sid, el, read, undoCount } = setup(collab);
    let resolve!: (doc: SvgTextDoc) => void;
    vi.mocked(layoutSvgText).mockReturnValueOnce(new Promise(r => { resolve = r; }));
    const first = beginTextEditSession(sid, el);
    const finish = first.finish('accepted');
    const reopened = beginTextEditSession(sid, el);
    expect(reopened.initialText).toBe('accepted');
    const unchanged = reopened.finish(reopened.initialText);
    resolve(docResult);
    await Promise.all([finish, unchanged, first.finish('ignored')]);
    expect(read().slides[sid].elements.text).toMatchObject({ text: 'accepted', width: 80, height: 60 });
    expect(read().slides.other.elements.text).toEqual(el);
    expect(undoCount()).toBe(1);
  });
  it('repeated reopen hands off accepted source, queues new edits, and keeps each content+size undo atomic', async () => {
    const { sid, el, read, undoCount } = setup(collab);
    const resolve: Array<(doc: SvgTextDoc) => void> = [];
    vi.mocked(layoutSvgText).mockImplementation(() => new Promise(r => { resolve.push(r); }));
    const first = beginTextEditSession(sid, el).finish('first');
    expect(getTextEditInitialText(sid, el)).toBe('first');
    const secondSession = beginTextEditSession(sid, el);
    const second = secondSession.finish('second');
    const thirdSession = beginTextEditSession(sid, el);
    expect(thirdSession.initialText).toBe('second');
    const third = thirdSession.finish(thirdSession.initialText);
    const fourthSession = beginTextEditSession(sid, el);
    const fourth = fourthSession.finish(fourthSession.initialText);
    expect(resolve).toHaveLength(1);
    resolve[0](docResult); await first;
    await vi.waitFor(() => expect(resolve).toHaveLength(2));
    expect(read().slides[sid].elements.text).toMatchObject({ text: 'first', width: 80, height: 60 });
    expect(undoCount()).toBe(1);
    resolve[1]({ ...docResult, width: 120, height: 90 });
    await Promise.all([second, third, fourth]);
    expect(read().slides[sid].elements.text).toMatchObject({ text: 'second', width: 120, height: 90 });
    expect(undoCount()).toBe(2);
    if (collab) getActiveUndoManager()!.undo(); else store.temporal.getState().undo();
    expect(read().slides[sid].elements.text).toMatchObject({ text: 'first', width: 80, height: 60 });
    if (collab) getActiveUndoManager()!.undo(); else store.temporal.getState().undo();
    expect(read().slides[sid].elements.text).toEqual(el);
  });
  it('new edits in a reopened session survive the predecessor completing while still editing', async () => {
    const { sid, el, read, undoCount } = setup(collab);
    let resolve!: (doc: SvgTextDoc) => void;
    vi.mocked(layoutSvgText).mockReturnValueOnce(new Promise(r => { resolve = r; }));
    const first = beginTextEditSession(sid, el).finish('first');
    const reopened = beginTextEditSession(sid, el);
    resolve(docResult); await first;
    await reopened.finish('first plus new edits');
    expect(read().slides[sid].elements.text).toMatchObject({ text: 'first plus new edits' });
    expect(undoCount()).toBe(2);
  });
  it('concurrent content invalidates accepted predecessors and reopened descendants', async () => {
    const { sid, el, read } = setup(collab);
    let resolve!: (doc: SvgTextDoc) => void;
    vi.mocked(layoutSvgText).mockReturnValueOnce(new Promise(r => { resolve = r; }));
    const first = beginTextEditSession(sid, el).finish('first');
    const reopened = beginTextEditSession(sid, el);
    const second = reopened.finish('second');
    if (ydoc) ydoc.transact(() => getYElement(ydoc!, sid, el.id)!.set('text', 'remote'), 'remote');
    else store.getState().updateElement(sid, el.id, { text: 'remote' });
    expect(getTextEditInitialText(sid, el)).toBe('remote');
    resolve(docResult); await Promise.all([first, second]);
    expect(read().slides[sid].elements.text).toMatchObject({ text: 'remote', width: 300, height: 50 });
  });
  it('remote content after the accepted predecessor commits still wins over reopened draft', async () => {
    const { sid, el, read } = setup(collab);
    const first = beginTextEditSession(sid, el).finish('first');
    const reopened = beginTextEditSession(sid, el);
    await first;
    if (ydoc) ydoc.transact(() => getYElement(ydoc!, sid, el.id)!.set('text', 'remote'), 'remote');
    else store.getState().updateElement(sid, el.id, { text: 'remote' });
    await reopened.finish('second');
    expect(read().slides[sid].elements.text).toMatchObject({ text: 'remote' });
  });
  it('same ID on another slide does not inherit or cancel an accepted draft', async () => {
    const { sid, el, read, undoCount } = setup(collab);
    let resolve!: (doc: SvgTextDoc) => void;
    vi.mocked(layoutSvgText).mockReturnValueOnce(new Promise(r => { resolve = r; }));
    const first = beginTextEditSession(sid, el).finish('accepted');
    const other = beginTextEditSession('other', el);
    expect(other.initialText).toBe('old');
    await other.finish('other edit');
    resolve(docResult); await first;
    expect(read().slides[sid].elements.text).toMatchObject({ text: 'accepted' });
    expect(read().slides.other.elements.text).toMatchObject({ text: 'other edit' });
    expect(undoCount()).toBe(2);
  });
  it('replacement document/presentation cannot inherit an old accepted draft with the same IDs', async () => {
    const { sid, el } = setup(collab);
    let resolve!: (doc: SvgTextDoc) => void;
    vi.mocked(layoutSvgText).mockReturnValueOnce(new Promise(r => { resolve = r; }));
    const first = beginTextEditSession(sid, el).finish('old document draft');
    const p = structuredClone(store.getState().presentation);
    if (!collab) p.id = 'replacement'; // Yjs also rejects a new doc with the SAME presentation id.
    store.setState({ presentation: p });
    if (ydoc) {
      setActiveUndoManager(null); setActiveDoc(null); ydoc.destroy();
      ydoc = jsonToYDoc(p); setActiveDoc(ydoc); setActiveUndoManager(createUndoManagerFor(ydoc));
    }
    const replacement = beginTextEditSession(sid, el);
    expect(replacement.initialText).toBe('old');
    await replacement.finish('replacement draft');
    resolve(docResult); await first;
    const result = ydoc ? yDocToJson(ydoc) : store.getState().presentation;
    expect(result.slides[sid].elements.text).toMatchObject({ text: 'replacement draft' });
  });

  it('live bound short-long-original projects without writes and finishes one geometry undo; baseline survives reopen', async () => {
    const { sid, el, read, undoCount } = setup(collab, { textSizing: 'user-width', containerId: 'box', boundTextLayout: 'measured', boundTextBaselineHeight: 190 });
    store.getState().addElement(sid, createShapeElement('rect', { id: 'box', x: 400, y: 380, width: 200, height: 190 }));
    if (collab) getActiveUndoManager()!.clear(); else store.temporal.getState().clear();
    const before = structuredClone(read());
    const session = beginTextEditSession(sid, el);
    vi.mocked(layoutSvgText).mockResolvedValue({ ...docResult, width: 16, height: 25 });
    expect((await session.preview('old'))!.patches).toHaveLength(1);
    vi.mocked(layoutSvgText).mockResolvedValue({ ...docResult, height: 200 });
    expect((await session.preview('long'))!.patches[1].changes).toEqual({ height: 210 });
    vi.mocked(layoutSvgText).mockResolvedValue({ ...docResult, width: 16, height: 25 });
    expect((await session.preview('old'))!.patches[1].changes).toEqual({ height: 35 });
    expect(read()).toEqual(before); expect(undoCount()).toBe(0);
    await session.finish('old');
    expect(read().slides[sid].elements.box).toMatchObject({ x: 400, y: 380, height: 35 });
    expect(read().slides[sid].elements.text).toMatchObject({ text: 'old', height: 25, boundTextBaselineHeight: 190 });
    expect(undoCount()).toBe(1);
    const reopened = beginTextEditSession(sid, read().slides[sid].elements.text as TextElement);
    vi.mocked(layoutSvgText).mockResolvedValue({ ...docResult, height: 100 });
    expect((await reopened.preview('medium'))!.patches[1].changes).toEqual({ height: 110 });
    vi.mocked(layoutSvgText).mockResolvedValue({ ...docResult, width: 16, height: 25 });
    // Still below cached 190: retain 110 rather than always hug.
    expect((await reopened.preview('old'))!.patches[1].changes).toEqual({ height: 110 });
    if (collab) getActiveUndoManager()!.undo(); else store.temporal.getState().undo();
    expect(read().slides[sid].elements).toEqual(before.slides[sid].elements);
    if (collab) getActiveUndoManager()!.redo(); else store.temporal.getState().redo();
    expect(read().slides[sid].elements.box.height).toBe(35);
  });
  it('bound delayed measurement reuses latest placement, retries style, rejects stale generation and remote source', async () => {
    const { sid, el, read } = setup(collab, { textSizing: 'user-width', containerId: 'box', boundTextLayout: 'measured', boundTextBaselineHeight: 190 });
    store.getState().addElement(sid, createShapeElement('rect', { id: 'box', width: 200, height: 190 }));
    const session = beginTextEditSession(sid, el);
    let resolve!: (doc: SvgTextDoc) => void;
    vi.mocked(layoutSvgText).mockReturnValueOnce(new Promise(r => { resolve = r; }));
    const draft = session.preview('local');
    store.getState().updateElement(sid, 'box', { x: 444 });
    resolve(docResult);
    const result = await draft;
    expect(result!.label.x).toBeCloseTo(444 + (200 - 80.001) / 2);
    expect(layoutSvgText).toHaveBeenCalledTimes(1);
    vi.mocked(layoutSvgText).mockReturnValueOnce(new Promise(r => { resolve = r; }));
    const stale = session.preview('stale');
    await session.preview('newer'); resolve(docResult);
    expect(await stale).toBeUndefined();
    vi.mocked(layoutSvgText).mockReturnValueOnce(new Promise(r => { resolve = r; }));
    const pending = session.preview('remote conflict');
    store.getState().updateElement(sid, el.id, { text: 'remote' });
    resolve(docResult); expect(await pending).toBeUndefined();
    await session.finish('local');
    expect((read().slides[sid].elements.text as TextElement).text).toBe('remote');
  });
  it('manual width resize resets measured baseline once and undo restores exact cache', () => {
    const { sid, read } = setup(collab, { containerId: 'box', boundTextLayout: 'measured', boundTextBaselineHeight: 50 });
    store.getState().addElement(sid, createShapeElement('rect', { id: 'box', width: 200, height: 190 }));
    if (collab) getActiveUndoManager()!.clear(); else store.temporal.getState().clear();
    store.getState().updateElements(sid, [{ elementId: 'box', changes: { width: 250 } }]);
    expect(read().slides[sid].elements.text).toMatchObject({ boundTextBaselineHeight: 190 });
    if (collab) getActiveUndoManager()!.undo(); else store.temporal.getState().undo();
    expect(read().slides[sid].elements.text).toMatchObject({ boundTextBaselineHeight: 50 });
  });

  it('incremental shrink that lands exactly on the baseline stops further shrinking', async () => {
    const { sid, el } = setup(collab, { textSizing: 'user-width', containerId: 'box', boundTextLayout: 'measured', boundTextBaselineHeight: 190 });
    store.getState().addElement(sid, createShapeElement('rect', { id: 'box', width: 200, height: 190 }));
    const session = beginTextEditSession(sid, el);
    vi.mocked(layoutSvgText).mockResolvedValue({ ...docResult, height: 200 });
    await session.preview('long');
    vi.mocked(layoutSvgText).mockResolvedValue({ ...docResult, height: 180 });
    expect((await session.preview('medium'))!.patches).toHaveLength(1);
    vi.mocked(layoutSvgText).mockResolvedValue({ ...docResult, height: 25 });
    expect((await session.preview('old'))!.patches).toHaveLength(1);
  });

  it('bound delayed style/width changes retry, and binding changes invalidate pending fit', async () => {
    const { sid, el, read } = setup(collab, { textSizing: 'user-width', containerId: 'box', boundTextLayout: 'measured', boundTextBaselineHeight: 190 });
    store.getState().addElement(sid, createShapeElement('rect', { id: 'box', width: 200, height: 190 }));
    const session = beginTextEditSession(sid, el);
    let resolve!: (doc: SvgTextDoc) => void;
    vi.mocked(layoutSvgText).mockReturnValueOnce(new Promise(r => { resolve = r; }));
    const draft = session.preview('math source', new Set([0]));
    store.getState().updateElement(sid, 'box', { width: 300 });
    store.getState().updateElement(sid, el.id, { style: { ...el.style, fontSize: 40 } });
    resolve(docResult); await draft;
    expect(layoutSvgText).toHaveBeenLastCalledWith('math source', expect.objectContaining({ fontSize: 40 }), 290, new Set([0]));
    vi.mocked(layoutSvgText).mockReturnValueOnce(new Promise(r => { resolve = r; }));
    const stale = session.preview('stale binding');
    store.getState().updateElement(sid, el.id, { containerId: 'different' });
    resolve(docResult); expect(await stale).toBeUndefined();
    await session.finish('local');
    expect(read().slides[sid].elements.text).toMatchObject({ text: 'old', containerId: 'different' });
  });

  it('pending fit suppression belongs to one slide/label and current document identity only', async () => {
    const { sid, el } = setup(collab);
    let resolve!: (doc: SvgTextDoc) => void;
    vi.mocked(layoutSvgText).mockReturnValueOnce(new Promise(r => { resolve = r; }));
    const finish = beginTextEditSession(sid, el).finish('pending math');
    expect(hasPendingTextFinish(sid, el.id)).toBe(true);
    expect(hasPendingTextFinish(sid, 'unrelated')).toBe(false);
    expect(hasPendingTextFinish('other', el.id)).toBe(false);
    const presentation = structuredClone(store.getState().presentation);
    presentation.id = 'replacement'; store.setState({ presentation });
    expect(hasPendingTextFinish(sid, el.id)).toBe(false);
    resolve(docResult); await finish;
    expect(hasPendingTextFinish(sid, el.id)).toBe(false);
  });

});
