import { describe, expect, it } from 'vitest';
import { createShapeElement, createTextElement } from '../model/slideFactory';
import { marqueeSelection } from './marqueeSelection';
import type { SlideElement } from '../../types/presentation';

const slide = (els: SlideElement[]) => ({ elements: Object.fromEntries(els.map(e => [e.id, e])), order: els.map(e => e.id) });
const pick = (els: SlideElement[], rect: { x: number; y: number; width: number; height: number }, scope: string | null = null) => {
  const s = slide(els);
  return marqueeSelection(s.elements, s.order, rect, scope);
};

describe('selection rectangle', () => {
  const a = createShapeElement('rect', { id: 'a', x: 100, y: 100, width: 100, height: 100 });
  const b = createShapeElement('rect', { id: 'b', x: 300, y: 100, width: 100, height: 100 });

  it('selects only what it wholly contains; touching is not enough', () => {
    expect(pick([a, b], { x: 90, y: 90, width: 250, height: 120 })).toEqual(['a']);
    expect(pick([a, b], { x: 90, y: 90, width: 400, height: 120 })).toEqual(['a', 'b']);
    expect(pick([a, b], { x: 150, y: 150, width: 10, height: 10 })).toEqual([]);
  });

  it('measures rotated objects by what is drawn', () => {
    // A 100×100 square rotated 45° reaches ~20.7 beyond its box on each side.
    const r = createShapeElement('rect', { id: 'r', x: 100, y: 100, width: 100, height: 100, rotation: 45 });
    expect(pick([r], { x: 95, y: 95, width: 110, height: 110 })).toEqual([]);
    expect(pick([r], { x: 75, y: 75, width: 150, height: 150 })).toEqual(['r']);
  });

  it('selects a group only when all its visible members are inside', () => {
    const g1 = { ...a, objectGroupIds: ['g'] }, g2 = { ...b, objectGroupIds: ['g'] };
    const hidden = createShapeElement('rect', { id: 'h', x: 900, y: 500, width: 10, height: 10, objectGroupIds: ['g'], visible: false });
    expect(pick([g1, g2, hidden], { x: 90, y: 90, width: 250, height: 120 })).toEqual([]);
    expect(pick([g1, g2, hidden], { x: 90, y: 90, width: 400, height: 120 })).toEqual(['a', 'b']);
    // Inside the entered group, members are picked one by one.
    expect(pick([g1, g2, hidden], { x: 90, y: 90, width: 250, height: 120 }, 'g')).toEqual(['a']);
  });

  it('never picks hidden objects or bound labels on their own', () => {
    const hidden = { ...b, visible: false };
    const label = createTextElement({ id: 'l', x: 120, y: 130, width: 60, height: 30, containerId: 'a' });
    expect(pick([a, label, hidden], { x: 0, y: 0, width: 900, height: 500 })).toEqual(['a']);
  });
});

describe('selection rectangle around a cropped image', () => {
  it('needs only the visible (cropped) area inside, not the hidden image', async () => {
    const { createImageElement } = await import('../model/slideFactory');
    const image = createImageElement(null, 1000, 600, { id: 'img', x: 0, y: 0, width: 1000, height: 600, objectGroupIds: ['g'] });
    const crop = createShapeElement('rect', { id: 'crop', x: 400, y: 200, width: 200, height: 100, objectGroupIds: ['g'], cropGroupId: 'g' });
    const elements = { img: image, crop } as Record<string, SlideElement>;
    // Around the visible part only: picks the cropped image (image + crop).
    expect(marqueeSelection(elements, ['img', 'crop'], { x: 390, y: 190, width: 220, height: 120 })).toEqual(['img', 'crop']);
    // Cutting into the visible part: nothing.
    expect(marqueeSelection(elements, ['img', 'crop'], { x: 450, y: 190, width: 220, height: 120 })).toEqual([]);
  });
});
