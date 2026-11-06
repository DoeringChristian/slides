import { expect, it } from 'vitest';
import { selectObjectRange } from './objectSelection';
const none = { shiftKey: false, ctrlKey: false, metaKey: false };
const order = ['a', 'b', 'c', 'd'];
it('supports plain, toggle, range and additive range selection in displayed order', () => {
  expect(selectObjectRange(order, ['a'], 'c', 'a', none)).toEqual(['c']);
  expect(selectObjectRange(order, ['a'], 'c', 'a', { ...none, ctrlKey: true })).toEqual(['a', 'c']);
  expect(selectObjectRange(order, ['a', 'c'], 'a', 'c', { ...none, metaKey: true })).toEqual(['c']);
  expect(selectObjectRange(order, ['d'], 'a', 'c', { ...none, shiftKey: true })).toEqual(['a', 'b', 'c']);
  expect(selectObjectRange(order, ['d'], 'b', 'a', { ...none, shiftKey: true, ctrlKey: true })).toEqual(['d', 'a', 'b']);
});
it('handles removed/hidden anchors and ignores unselectable rows', () => {
  expect(selectObjectRange(order, ['a'], 'd', 'gone', { ...none, shiftKey: true })).toEqual(['d']);
  expect(selectObjectRange(order, ['a'], 'hidden', 'a', none)).toEqual(['a']);
});
