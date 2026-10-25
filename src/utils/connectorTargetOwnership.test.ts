import { expect, it } from 'vitest';
import { getBindingTarget2, bindingDrop } from './connectorUtils';
import { createShapeElement, createTextElement } from './slideFactory';

it('bound labels defer acquisition to the eligible container silhouette', () => {
  const parent = createShapeElement('rect', { id: 'parent', x: 100, y: 100, width: 200, height: 100 });
  const label = createTextElement({ id: 'label', containerId: parent.id, x: 110, y: 110, width: 180, height: 80 });
  const point = { x: 180, y: 140 };
  expect(getBindingTarget2(point, [parent, label], '')?.id).toBe(parent.id);
  expect(bindingDrop(point, { x: 0, y: 0 }, [parent, label], '')?.binding.elementId).toBe(parent.id);
  expect(getBindingTarget2(point, [{ ...parent, locked: true }, label], '')).toBeNull();
  expect(getBindingTarget2(point, [{ ...parent, visible: false }, label], '')).toBeNull();
  expect(getBindingTarget2(point, [parent, label], parent.id)).toBeNull();
  expect(getBindingTarget2(point, [label], '')).toBeNull();
  expect(getBindingTarget2(point, [{ ...label, containerId: null }], '')?.id).toBe(label.id);
});
