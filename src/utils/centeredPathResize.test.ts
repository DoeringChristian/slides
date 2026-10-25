import { describe, expect, it } from 'vitest';
import { createShapeElement } from './slideFactory';
import { centeredPathResize } from './centeredPathResize';
import { pathGeometryUpdate, pathPointsInSlide, pathPointToSlide } from './pathEditing';

describe('centeredPathResize', () => {
  it('applies a nonidentity scale/rotation to every manual tangent without mutating the snapshot', () => {
    const element = createShapeElement('path', { x: 100, y: 200, width: 100, height: 1, points: [0, 0, 100, 0],
      tangents: [2, 3, 30, -20, -30, 20, -4, 5] });
    // Original end relative to midpoint: (50,0). New: (0,100), i.e. 2x +90°.
    const next = centeredPathResize(element, 1, { x: 150, y: 300 });
    expect(next.points).toEqual([50, -100, 50, 100]);
    expect(next.tangents).toEqual([-6, 4, 40, 60, -40, -60, -10, -8]);
    expect(element.tangents).toEqual([2, 3, 30, -20, -30, 20, -4, 5]);
  });
  for (const rotation of [0, 37, 90]) for (const index of [0, 1]) {
    it(`mirrors actual off-box endpoints about the original midpoint (${rotation}/${index})`, () => {
      const element = createShapeElement('path', { x: 100, y: 200, width: 140, height: 80, rotation, points: [-20, -40, 120, 40], curve: 'bezier', tangents: [0, 0, 30, -20, -30, 20, 0, 0] });
      const before = pathPointsInSlide(element), endpoint = { x: 410, y: 330 };
      const next = centeredPathResize(element, index, endpoint);
      const normalized = { ...element, ...pathGeometryUpdate(element, next.points, next.tangents) };
      const after = pathPointsInSlide(normalized);
      expect((after[0] + after[2]) / 2).toBeCloseTo((before[0] + before[2]) / 2);
      expect((after[1] + after[3]) / 2).toBeCloseTo((before[1] + before[3]) / 2);
      expect(after[2 * index]).toBeCloseTo(endpoint.x);
      expect(after[2 * index + 1]).toBeCloseTo(endpoint.y);
      const originalEndpoint = pathPointToSlide(element, element.points![2 * index], element.points![2 * index + 1]);
      expect(centeredPathResize(element, index, originalEndpoint).tangents).toEqual(expect.arrayContaining([expect.closeTo(30), expect.closeTo(-20)]));
      expect(element.points).toEqual([-20, -40, 120, 40]);
    });
  }
});
