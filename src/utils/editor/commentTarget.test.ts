import { describe, expect, it } from 'vitest';
import { createShapeElement } from '../model/slideFactory';
import { commentTargetAt } from './commentTarget';

const back = createShapeElement('rect', { id: 'back', x: 0, y: 0, width: 400, height: 300 });
const front = createShapeElement('ellipse', { id: 'front', x: 50, y: 50, width: 100, height: 80 });
const hidden = createShapeElement('rect', { id: 'hidden', x: 600, y: 300, width: 50, height: 50, visible: false });
const elements = [back, front, hidden];
const click = (x: number, y: number) => commentTargetAt(elements, { x, y, width: 0, height: 0 }, x, y);

describe('comment tool targets', () => {
  it('a click on objects targets the topmost one', () => {
    expect(click(80, 80)).toEqual({ elementIds: ['front'], region: null });
    expect(click(300, 200)).toEqual({ elementIds: ['back'], region: null });
  });

  it('a click on empty space targets that spot', () => {
    expect(click(700, 100)).toEqual({ elementIds: null, region: { x: 700, y: 100, width: 0, height: 0 } });
    // Hidden objects are not targets: the spot is empty.
    expect(click(620, 320).elementIds).toBeNull();
  });

  it('a drag targets the area, with the objects wholly inside it as context', () => {
    expect(commentTargetAt(elements, { x: 40, y: 40, width: 200, height: 200 }, 40, 40))
      .toEqual({ elementIds: ['front'], region: { x: 40, y: 40, width: 200, height: 200 } });
    expect(commentTargetAt(elements, { x: 500, y: 20, width: 300, height: 150 }, 500, 20))
      .toEqual({ elementIds: null, region: { x: 500, y: 20, width: 300, height: 150 } });
  });
});
