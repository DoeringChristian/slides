import { describe, expect, it } from 'vitest';
import { createPresentation, createShapeElement } from '../../utils/model/slideFactory';
import { groupComments, openCount } from './commentUi';

describe('comment badges', () => {
  it('group threads by element, counting open threads only, with orphans on the slide', () => {
    const p = createPresentation();
    const slide = p.slides[p.slideOrder[0]];
    slide.elements = { box: createShapeElement('rect', { id: 'box' }) };
    slide.elementOrder = ['box'];
    const author = { id: 'u1', name: 'Ada', color: '#2563eb' };
    slide.comments = {
      a: { id: 'a', elementId: 'box', text: 'Make it red', author, createdAt: 1 },
      r: { id: 'r', elementId: 'box', parentId: 'a', text: 'Done.', author, createdAt: 2 },
      done: { id: 'done', elementId: 'box', text: 'old', author, createdAt: 0, resolved: true },
      gone: { id: 'gone', elementId: 'deleted', text: 'about a deleted element', author, createdAt: 3 },
      whole: { id: 'whole', text: 'about the slide', author, createdAt: 4 },
    };
    const groups = groupComments(slide);
    expect(groups.get('box')!.map(c => c.id)).toEqual(['done', 'a', 'r']);
    expect(openCount(groups.get('box')!)).toBe(1);
    // An element that is no longer on the slide falls back to the slide thread.
    expect(groups.get(null)!.map(c => c.id)).toEqual(['gone', 'whole']);
    expect(openCount(groups.get(null)!)).toBe(2);
  });
});
