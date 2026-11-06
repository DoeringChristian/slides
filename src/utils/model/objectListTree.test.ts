import { expect, it } from 'vitest';
import { objectListTree, flattenObjectList } from './objectListTree';
import { createShapeElement } from './slideFactory';

it('collapses groups by default, reveals nested members, and keeps absent objects loose', () => {
  const objects = ['a','b','c','d'].map(id => ({ id, name: id, type: 'shape' as const }));
  const elements = {
    a: createShapeElement('rect', { id: 'a', objectGroupIds: ['outer','inner'] }),
    b: createShapeElement('rect', { id: 'b', objectGroupIds: ['outer','inner'] }),
    c: createShapeElement('rect', { id: 'c', objectGroupIds: ['outer'] }),
  };
  const tree = objectListTree(objects, elements);
  expect(flattenObjectList(tree, new Set()).map(row => row.node.id)).toEqual(['outer','d']);
  expect(flattenObjectList(tree, new Set(['outer'])).map(row => row.node.id)).toEqual(['outer','inner','c','d']);
  expect(flattenObjectList(tree, new Set(['outer','inner'])).map(row => [row.node.id,row.depth])).toEqual([['outer',0],['inner',1],['a',2],['b',2],['c',1],['d',0]]);
  expect(tree[0]).toMatchObject({ memberIds: ['a','b','c'] });
  expect(objectListTree(objects, {}).map(node => node.id)).toEqual(['a','b','c','d']);
});
