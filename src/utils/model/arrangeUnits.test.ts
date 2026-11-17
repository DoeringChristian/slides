import { describe, expect, it } from 'vitest';
import { arrangeUnits, planAlign, planDistribute } from './arrangeUnits';
import { createImageElement, createShapeElement } from './slideFactory';
import type { SlideElement } from '../../types/presentation';

// A cropped image: the image spans x..x+400, its crop shows only x+100..x+200.
const cropped = (id: string, x: number, y = 0) => [
  createImageElement(null, 400, 200, { id, x, y, width: 400, height: 200, objectGroupIds: [`g-${id}`] }),
  createShapeElement('rect', { id: `${id}-crop`, x: x + 100, y: y + 20, width: 100, height: 100, objectGroupIds: [`g-${id}`], cropGroupId: `g-${id}` }),
];
const deck = (els: SlideElement[]) => Object.fromEntries(els.map(e => [e.id, e]));
const apply = (elements: Record<string, SlideElement>, updates: ReturnType<typeof planAlign>) => {
  const out = structuredClone(elements);
  for (const { elementId, changes } of updates) Object.assign(out[elementId], changes);
  return out;
};

describe('align / distribute see a cropped image as the area its crop shows', () => {
  it('one unit per group, boxed by its visible area', () => {
    const els = deck([...cropped('a', 0), createShapeElement('rect', { id: 'r', x: 600, y: 300, width: 50, height: 50 })]);
    const units = arrangeUnits(els, Object.keys(els));
    expect(units.map(u => [u.ids.sort(), u.box])).toEqual([
      [['a', 'a-crop'], { x: 100, y: 20, width: 100, height: 100 }],
      [['r'], { x: 600, y: 300, width: 50, height: 50 }],
    ]);
  });

  it('align left: the visible left edges line up, each image moving with its crop', () => {
    const els = deck([...cropped('a', 0), ...cropped('b', 500, 300)]);
    const out = apply(els, planAlign(els, arrangeUnits(els, Object.keys(els)), 'left'));
    expect(out['b-crop'].x).toBe(out['a-crop'].x);           // visible edges aligned
    expect(out['b-crop'].x - out.b.x).toBe(100);             // the crop stays on its image
    expect(out.a.x).toBe(0);                                 // the leftmost stays
  });

  it('distribute: equal gaps between the visible areas', () => {
    const els = deck([...cropped('a', 0), ...cropped('b', 100), ...cropped('c', 800)]);
    const out = apply(els, planDistribute(els, arrangeUnits(els, Object.keys(els)), 'h'));
    const left = (id: string) => out[`${id}-crop`].x, right = (id: string) => left(id) + 100;
    expect(left('b') - right('a')).toBeCloseTo(left('c') - right('b'));
  });

  it('a single unit (one cropped image) has nothing to align with', () => {
    const els = deck(cropped('a', 0));
    expect(planAlign(els, arrangeUnits(els, Object.keys(els)), 'left')).toEqual([]);
  });
});
