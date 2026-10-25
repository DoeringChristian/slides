import { describe, expect, it } from 'vitest';
import { screenPixelsToSlide } from './screenSpace';
import { getBindingTarget2, bindingForDrop } from './connectorUtils';
import { snapPathPoint } from './pathSnapping';
import { computePointSnap } from '../hooks/useAlignmentGuides';
import { createShapeElement } from './slideFactory';

describe('screen-space interaction tolerances', () => {
  it.each([.25, .5, 1, 2, 4])('same physical offsets at zoom %s', zoom => {
    expect(screenPixelsToSlide(5, zoom) * zoom).toBe(5);
    for (const rotation of [0, 37, 90]) {
      const target = createShapeElement('rect', { id: 'target', x: 0, y: 0, width: 400, height: 400, rotation });
      const point = (depth: number) => {
        const a = rotation * Math.PI / 180;
        const dx = 200 + depth / zoom;
        return { x: 200 + dx * Math.cos(a), y: 200 + dx * Math.sin(a) };
      };
      expect(getBindingTarget2(point(31), [target], '', zoom)?.id).toBe('target');
      expect(getBindingTarget2(point(33), [target], '', zoom)).toBeNull();
      expect(bindingForDrop(point(-11), target).mode).toBe('aim');
      expect(bindingForDrop(point(-13), target).mode).toBe('aim');
    }
    const small = createShapeElement('rect', { x: 0, y: 0, width: 10, height: 10 });
    expect(getBindingTarget2({ x: 10 + 15 / zoom, y: 5 }, [small], '', zoom)).toBe(small);
    expect(getBindingTarget2({ x: 10 + 17 / zoom, y: 5 }, [small], '', zoom)).toBeNull();
    for (const [offset, snaps] of [[4, true], [6, false]] as const) {
      const result = computePointSnap({ x: offset / zoom, y: 1000 }, [{ x: 0, y: 0, width: 0, height: 0 }], screenPixelsToSlide(5, zoom));
      expect(result.snapX !== null).toBe(snaps);
    }
    expect(snapPathPoint({ x: 100 / zoom, y: 5 / zoom }, [{ x: 0, y: 0 }], zoom).guides).toHaveLength(0);
    expect(snapPathPoint({ x: 100 / zoom, y: 7 / zoom }, [{ x: 0, y: 0 }], zoom).guides).toHaveLength(0);
  });
  it('omitted zoom means 1; geometry itself is not scaled', () => {
    expect(screenPixelsToSlide(12)).toBe(12);
  });
});
