import { describe, expect, it } from 'vitest';
import { createPresentation, createShapeElement } from '../../utils/model/slideFactory';
import { groupComments, openCount, targetKey } from './commentUi';

describe('comment badges', () => {
  it('group threads by their element set, with replies, and orphans on the slide', () => {
    const p = createPresentation();
    const slide = p.slides[p.slideOrder[0]];
    slide.elements = { box: createShapeElement('rect', { id: 'box' }), arrow: createShapeElement('rect', { id: 'arrow' }) };
    slide.elementOrder = ['box', 'arrow'];
    const author = { id: 'u1', name: 'Ada', color: '#2563eb' };
    slide.comments = {
      a: { id: 'a', elementIds: ['box'], text: 'Make it red', author, createdAt: 1 },
      r: { id: 'r', parentId: 'a', text: 'Done.', author, createdAt: 2 },
      done: { id: 'done', elementIds: ['box'], text: 'old', author, createdAt: 0, resolved: true },
      // A selection comment, stored in any order, is one thread for the set.
      pair: { id: 'pair', elementIds: ['box', 'arrow'], text: 'Align these', author, createdAt: 5 },
      pair2: { id: 'pair2', elementIds: ['arrow', 'box'], text: 'Same color too', author, createdAt: 6 },
      // A set with one element gone keeps the rest; all gone → the slide.
      partly: { id: 'partly', elementIds: ['box', 'deleted'], text: 'Partly gone', author, createdAt: 7 },
      gone: { id: 'gone', elementIds: ['deleted'], text: 'about a deleted element', author, createdAt: 3 },
      whole: { id: 'whole', text: 'about the slide', author, createdAt: 4 },
      // Area and spot comments are threads of their own, even with elements inside.
      here: { id: 'here', region: { x: 700, y: 100, width: 0, height: 0 }, text: 'Put a chart here', author, createdAt: 8 },
      area: { id: 'area', region: { x: 0, y: 0, width: 500, height: 400 }, elementIds: ['box'], text: 'Tidy this up', author, createdAt: 9 },
    };
    const groups = groupComments(slide);
    expect(groups.get('box')!.comments.map(c => c.id)).toEqual(['done', 'a', 'r', 'partly']);
    expect(openCount(groups.get('box')!.comments)).toBe(2);
    expect(groups.get(targetKey({ elementIds: ['box', 'arrow'] }))).toMatchObject({ elementIds: ['arrow', 'box'] });
    expect(groups.get(targetKey({ elementIds: ['arrow', 'box'] }))!.comments.map(c => c.id)).toEqual(['pair', 'pair2']);
    expect(groups.get('')!.comments.map(c => c.id)).toEqual(['gone', 'whole']);
    expect(groups.get(targetKey({ region: { x: 700, y: 100, width: 0, height: 0 } }))).toMatchObject({ region: { x: 700, y: 100, width: 0, height: 0 }, elementIds: null });
    expect(groups.get(targetKey({ region: { x: 0, y: 0, width: 500, height: 400 } }))).toMatchObject({ elementIds: ['box'] });
    expect(groups.get('box')!.comments.map(c => c.id)).not.toContain('area');
  });
});
