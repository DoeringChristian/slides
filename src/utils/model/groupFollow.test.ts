import { describe, expect, it } from 'vitest';
import { followGroups } from './groupFollow';
import { createImageElement, createShapeElement } from './slideFactory';

const rect = (id: string, x: number, w = 100, over = {}) => createShapeElement('rect', { id, x, y: 0, width: w, height: 100, objectGroupIds: ['g'], ...over });

describe('appearing / disappearing members move with their group', () => {
  it('an appearing member rides with the moving group, at its offset on the keyframe it is on', () => {
    // The group's anchor moves 0 → 400; the new member sits 20 right of it on B.
    const A = { elements: { a: rect('a', 0) } }, B = { elements: { a: rect('a', 400), n: rect('n', 520, 50) } };
    const frame = followGroups([rect('a', 200), rect('n', 520, 50)], A, B);
    expect(frame.find(e => e.id === 'n')!.x).toBeCloseTo(320);
  });

  it('a disappearing member rides with where the group is, at its offset on the keyframe it was on', () => {
    const A = { elements: { a: rect('a', 0), n: rect('n', 120, 50) } }, B = { elements: { a: rect('a', 400) } };
    const frame = followGroups([rect('a', 200), rect('n', 120, 50)], A, B);
    expect(frame.find(e => e.id === 'n')!.x).toBeCloseTo(320);
  });

  it('scales with the group (a split video: the original shrinks, the new half comes in beside it)', () => {
    const video = (x: number, w: number) => createImageElement(null, 400, 100, { id: 'v', x, y: 0, width: w, height: 100, objectGroupIds: ['g'] });
    const half = createImageElement(null, 400, 100, { id: 'h', x: 200, y: 0, width: 200, height: 100, objectGroupIds: ['g'] });
    const A = { elements: { v: video(0, 400) } }, B = { elements: { v: video(0, 200), h: half } };
    // Mid-way the original is 300 wide: the new half is scaled 1.5× about the group.
    const frame = followGroups([video(0, 300), half], A, B);
    const h = frame.find(e => e.id === 'h')!;
    expect([h.x, h.width]).toEqual([300, 300]);
  });

  it('leaves members alone when the group is not moving, and elements outside groups', () => {
    const A = { elements: { a: rect('a', 0) } }, B = { elements: { a: rect('a', 0), n: rect('n', 120, 50), loose: rect('loose', 500, 50, { objectGroupIds: [] }) } };
    const frame = [rect('a', 0), rect('n', 120, 50), rect('loose', 500, 50, { objectGroupIds: [] })];
    expect(followGroups(frame, A, B)).toBe(frame);
  });
});
