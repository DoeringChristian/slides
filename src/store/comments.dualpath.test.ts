import { afterEach, describe, expect, it } from 'vitest';
import { usePresentationStore as store } from './presentationStore';
import { useEditorStore } from './editorStore';
import { setActiveDoc } from '../collab/yDocAdapter';
import { jsonToYDoc, yDocToJson } from '../collab/ySchema';
import { createPresentation, createShapeElement, copySlideAsKeyframe } from '../utils/model/slideFactory';
import { assertPresentation } from '../utils/model/currentPresentation';
import { withoutComments } from '../utils/io/exportStandaloneHtml';
import type { Presentation, SlideComment } from '../types/presentation';

afterEach(() => {
  setActiveDoc(null);
  useEditorStore.setState({ selectedSlideIds: [], autoDrawMode: false });
});

const author = { id: 'u1', name: 'Ada', color: '#2563eb' };
const comment = (id: string, extra: Partial<SlideComment> = {}): SlideComment =>
  ({ id, elementIds: ['box'], text: `text ${id}`, author, createdAt: 1, ...extra });

function setup(collab: boolean) {
  const p = createPresentation();
  const sid = p.slideOrder[0];
  p.slides[sid].elements = { box: createShapeElement('rect', { id: 'box' }) };
  p.slides[sid].elementOrder = ['box'];
  store.setState({ presentation: p });
  const doc = collab ? jsonToYDoc(p) : null;
  setActiveDoc(doc);
  const read = () => (doc ? yDocToJson(doc) : store.getState().presentation) as Presentation;
  return { sid, read, p };
}

describe.each([false, true])('comments collab=%s', collab => {
  it('adds, resolves and deletes threads with their replies', () => {
    const { sid, read } = setup(collab);
    store.getState().addComment(sid, comment('a'));
    store.getState().addComment(sid, comment('b', { parentId: 'a', text: 'reply' }));
    store.getState().addComment(sid, comment('c'));
    expect(Object.keys(read().slides[sid].comments ?? {}).sort()).toEqual(['a', 'b', 'c']);

    store.getState().updateComment(sid, 'a', { resolved: true });
    expect(read().slides[sid].comments?.a).toMatchObject({ resolved: true, text: 'text a', author });

    // Deleting a thread takes its replies with it.
    store.getState().deleteComment(sid, 'a');
    expect(Object.keys(read().slides[sid].comments ?? {})).toEqual(['c']);
    // The deck still validates.
    expect(() => assertPresentation(read())).not.toThrow();
  });

  it('is not slide content: auto-draw does not spawn a keyframe for it', () => {
    const { sid, read } = setup(collab);
    useEditorStore.setState({ activeSlideId: sid, autoDrawMode: true });
    store.getState().addComment(sid, comment('a'));
    expect(read().slideOrder).toHaveLength(1);
  });
});

describe('comment persistence', () => {
  it('round-trips through the Yjs encoding', () => {
    const { p, sid } = setup(false);
    p.slides[sid].comments = { a: comment('a'), b: comment('b', { parentId: 'a', elementIds: undefined }), c: comment('c', { elementIds: ['box', 'other'] }) };
    expect(yDocToJson(jsonToYDoc(p)).slides[sid].comments).toEqual(JSON.parse(JSON.stringify(p.slides[sid].comments)));
  });

  it('is not copied into a new keyframe', () => {
    const { p, sid } = setup(false);
    p.slides[sid].comments = { a: comment('a') };
    expect(copySlideAsKeyframe(p.slides[sid]).comments).toBeUndefined();
  });

  it('rejects malformed comments on load', () => {
    const { p, sid } = setup(false);
    p.slides[sid].comments = { a: { ...comment('a'), id: 'other' } };
    expect(() => assertPresentation(p)).toThrow(/comment a/);
    p.slides[sid].comments = { a: { ...comment('a'), elementIds: [3 as unknown as string] } };
    expect(() => assertPresentation(p)).toThrow(/elementIds of comment a/);
    p.slides[sid].comments = { a: { ...comment('a'), region: { x: 1, y: 2, width: 'wide' as unknown as number, height: 0 } } };
    expect(() => assertPresentation(p)).toThrow(/region of comment a/);
    p.slides[sid].comments = { a: { ...comment('a'), region: { x: 1, y: 2, width: 0, height: 0 } } };
    expect(() => assertPresentation(p)).not.toThrow();
  });

  it('leaves viewer exports', () => {
    const { p, sid } = setup(false);
    p.slides[sid].comments = { a: comment('a') };
    expect(withoutComments(p).slides[sid]).not.toHaveProperty('comments');
    expect(p.slides[sid].comments).toBeDefined();
  });
});
