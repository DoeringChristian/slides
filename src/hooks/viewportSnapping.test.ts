import { describe, expect, it } from 'vitest';
import { computeGuides, computePointSnap, computeResizeSnap } from './useAlignmentGuides';
import { snapPathPoint, withVertexMagnets } from '../utils/snapping/pathSnapping';
const viewport = { x: 100, y: 100, width: 400, height: 300 };
const offscreen = [{ x: 200, y: 900, width: 50, height: 50 }, { x: -800, y: 200, width: 50, height: 50 }];
describe('viewport snapping', () => {
  it('rejects offscreen sources on both axes for drag, resize, and point snapping', () => {
    const box = { x: 202, y: 202, width: 48, height: 48 };
    expect(computeGuides(box, offscreen, 5, null, viewport)).toEqual({ guides: [], snapX: null, snapY: null });
    expect(computePointSnap(box, offscreen, 5, null, undefined, viewport)).toEqual({ guides: [], snapX: null, snapY: null });
    expect(computeResizeSnap(box, offscreen, 5, null, viewport)).toEqual({ guides: [], leftSnap: null, rightSnap: null, topSnap: null, bottomSnap: null });
    expect(computePointSnap(box, offscreen).guides.length).toBeGreaterThan(0);
  });
  it('keeps real visible edges of partial objects without creating a viewport edge', () => {
    const partial = [{ x: 50, y: 180, width: 200, height: 40 }];
    expect(computePointSnap({ x: 52, y: 270 }, partial, 5, null, undefined, viewport).snapX).toBeNull();
    expect(computePointSnap({ x: 102, y: 270 }, partial, 5, null, undefined, viewport).snapX).toBeNull();
    expect(computePointSnap({ x: 152, y: 270 }, partial, 5, null, undefined, viewport).snapX).toBe(150);
    expect(computePointSnap({ x: 252, y: 270 }, partial, 5, null, undefined, viewport).snapX).toBe(250);
  });
  it('filters margin candidates and offscreen vertices, including Shift rays', () => {
    const margins = { left: 0, right: 600, top: 0, bottom: 500, centerX: 300, centerY: 250 };
    expect(computePointSnap({ x: 2, y: 2 }, [], 5, margins, undefined, viewport).guides).toEqual([]);
    expect(computePointSnap({ x: 302, y: 252 }, [], 5, margins, undefined, viewport).guides).toHaveLength(2);
    const alignment = withVertexMagnets({ others: [], viewport }, [200,900,900,200]);
    expect(snapPathPoint({x:202,y:202}, [{x:100,y:100}], 1, true, alignment).point).toEqual({x:202,y:202});
  });
  it('does not generate spacing guides from offscreen pairs', () => {
    const objects = [{ x: -100, y: 200, width: 50, height: 40 }, { x: 0, y: 200, width: 50, height: 40 }];
    expect(computeGuides({ x: 102, y: 200, width: 50, height: 40 }, objects, 5, null, viewport).guides).toEqual([]);
  });
});
