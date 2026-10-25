import { describe, expect, test } from 'vitest';
import { createShapeElement } from './slideFactory';
import { interpolateElement } from './interpolation';
import { pathExtensionUpdate, pathGeometryUpdate, pathPointsInSlide } from './pathEditing';
import type { ShapeElement } from '../types/presentation';

describe('stationary world-space path interpolation', () => {
  for (const curve of ['linear', 'smooth', 'bezier'] as const) {
    for (const end of ['start', 'end'] as const) {
      test.each([0, 37])(`${curve} ${end} extension at %s° leaves old vertices fixed, including mismatched easing`, (rotation) => {
        const a = createShapeElement('path', { x: 80, y: 90, width: 120, height: 80, rotation,
          points: [0, 0, 65, 80, 120, 20], curve, endHead: 'triangle', startHead: 'diamond',
          tangents: curve === 'bezier' ? [0, 0, 20, 30, -25, 0, 30, 0, -15, 20, 0, 0] : undefined,
          endBinding: { elementId: 'target', mode: 'pinned', fixedPoint: [0.3, 0.5] } });
        const original = pathPointsInSlide(a);
        const extended = end === 'start' ? [10, 300, ...original] : [...original, 340, 260];
        const b: ShapeElement = { ...a, ...pathExtensionUpdate(a, extended, end),
          transitions: { position: 'const', size: 'ease', controlPoints: 'ease' } };
        expect(pathPointsInSlide(b).slice(end === 'start' ? 2 : 0, end === 'start' ? undefined : -2))
          .toEqual(expect.arrayContaining(original.map(v => expect.closeTo(v, 7))));
        for (const t of [0.01, 0.25, 0.5, 0.75, 0.99]) {
          for (const backwards of [false, true]) {
            const frame = interpolateElement(backwards ? b : a, backwards ? a : b, t, !backwards) as ShapeElement;
            const world = pathPointsInSlide(frame), offset = end === 'start' ? 2 : 0;
            original.forEach((v, i) => expect(world[offset + i]).toBeCloseTo(v, 7));
            expect(frame.startHead).toBe(a.startHead); expect(frame.endHead).toBe(a.endHead);
            expect(world.every(Number.isFinite)).toBe(true);
          }
        }
        for (const [t, keyframe] of [[0, a], [1, b]] as const) {
          const frame = interpolateElement(a, b, t) as ShapeElement;
          expect(frame.points).toEqual(keyframe.points); expect(frame.tangents).toEqual(keyframe.tangents);
          pathPointsInSlide(frame).forEach((v, i) => expect(v).toBeCloseTo(pathPointsInSlide(keyframe)[i], 7));
        }
      });
    }
  }
  test.each([0, 42])('normalized endpoint edit at %s° does not drag the untouched end along with its bbox', rotation => {
    const a = createShapeElement('path', { x: 100, y: 100, width: 200, height: 80, rotation,
      points: [0, 0, 200, 80], endHead: 'triangle' });
    const b = { ...a, ...pathGeometryUpdate(a, [-120, -70, 200, 80]), transitions: { position: 'ease' as const, controlPoints: 'linear' as const } };
    const original = pathPointsInSlide(a);
    for (const t of [0, 0.2, 0.5, 0.8, 1]) {
      const world = pathPointsInSlide(interpolateElement(a, b, t) as ShapeElement);
      expect(world[2]).toBeCloseTo(original[2]); expect(world[3]).toBeCloseTo(original[3]);
    }
  });
});
