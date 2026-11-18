import { describe, expect, it } from 'vitest';
import { arrangeUnits, planAlign, planDistribute, planMatchSize, targetUnit } from './arrangeUnits';
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

  it('align left: the visible left edges line up with the last-selected target, each image moving with its crop', () => {
    const els = deck([...cropped('a', 0), ...cropped('b', 500, 300)]);
    const ids = Object.keys(els), units = arrangeUnits(els, ids);
    const out = apply(els, planAlign(els, units, 'left', targetUnit(units, ids)));
    expect(out['a-crop'].x).toBe(600);                       // a moved to the target's visible edge
    expect(out['a-crop'].x - out.a.x).toBe(100);             // the crop stays on its image
    expect(out.b.x).toBe(500);                               // the target (selected last) stays
  });

  it('the target is the unit selected last, whatever the slide order', () => {
    const els = deck([...cropped('a', 0), createShapeElement('rect', { id: 'r', x: 600, y: 300, width: 50, height: 50 })]);
    const units = arrangeUnits(els, ['r', 'a', 'a-crop']);
    expect(targetUnit(units, ['r', 'a', 'a-crop'])?.ids.sort()).toEqual(['a', 'a-crop']);
    expect(targetUnit(units, ['a', 'a-crop', 'r'])?.ids).toEqual(['r']);
    const out = apply(els, planAlign(els, units, 'top', targetUnit(units, ['a', 'a-crop', 'r'])));
    expect(out['a-crop'].y).toBe(300);
    expect(out.r.y).toBe(300);
  });

  it('match size: the others take the target\'s visible size, stretching and keeping their top-left', () => {
    const els = deck([
      createShapeElement('rect', { id: 'r', x: 10, y: 20, width: 50, height: 50 }),
      ...cropped('a', 300),
      createImageElement(null, 400, 200, { id: 'big', x: 0, y: 400, width: 160, height: 90 }),
    ]);
    const ids = ['r', 'a', 'a-crop', 'big'], units = arrangeUnits(els, ids);
    const out = apply(els, planMatchSize(els, units, targetUnit(units, ids)!));
    expect([out.r.x, out.r.y, out.r.width, out.r.height]).toEqual([10, 20, 160, 90]);
    // The cropped image scales as one: its visible area becomes 160×90 at the same corner.
    expect(out['a-crop']).toMatchObject({ x: 400, y: 20, width: 160, height: 90 });
    expect(out.a.width).toBeCloseTo(400 * 1.6);
    expect(out.a.height).toBeCloseTo(200 * 0.9);
    expect(out.big).toEqual(els.big);
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
