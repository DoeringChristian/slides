import { describe, expect, it } from 'vitest';
import { computePointSnap } from '../hooks/useAlignmentGuides';
import { snapPathPoint } from './pathSnapping';
import { bindDraftEndpoints, bindingDrop } from './connectorUtils';
import { createShapeElement } from './slideFactory';

describe('Shift combined object-guide and dock snapping', () => {
  it.each([.5, 1, 2])('horizontal, vertical and diagonal compatible intersections at zoom %s', zoom => {
    for (const [point, others, expected] of [
      [{ x: 98, y: 0 }, [{ x: 100, y: 200, width: 20, height: 20 }], { x: 100, y: 0 }],
      [{ x: 0, y: 98 }, [{ x: 200, y: 100, width: 20, height: 20 }], { x: 0, y: 100 }],
      [{ x: 99, y: 99 }, [{ x: 100, y: 200, width: 20, height: 20 }], { x: 100, y: 100 }],
    ] as const) {
      const result = snapPathPoint(point, [{ x: 0, y: 0 }], zoom, true, { others: [...others] });
      expect(result.point.x).toBeCloseTo(expected.x); expect(result.point.y).toBeCloseTo(expected.y);
      expect(result.guides.some(g => g.type === 'direction')).toBe(true);
      expect(result.guides.some(g => g.type === 'vertical' || g.type === 'horizontal')).toBe(true);
      expect(snapPathPoint(point, [{ x: 0, y: 0 }], zoom, true).guides).toHaveLength(1);
    }
  });
  it('rejects parallel, near-parallel and excessive Euclidean displacement; no false guidance', () => {
    for (const point of [{ x: 100, y: 0 }, { x: 100, y: .001 }]) {
      const result = computePointSnap(point, [{ x: 1000, y: 1, width: 20, height: 20 }], 5, null, { x: 0, y: 0 });
      expect(result.snapX).toBe(point.x); expect(result.snapY).toBe(point.y); expect(result.guides).toEqual([]);
    }
    const result = snapPathPoint({ x: 96, y: 96 }, [{ x: 0, y: 0 }], 1, true, { others: [{ x: 100, y: 200, width: 20, height: 20 }] });
    expect(result.point.x).toBeCloseTo(96); expect(result.guides).toHaveLength(1);
  });
  it.each([0, 45, 90])('compatible transformed pin %s° and incompatible pin preserve actual shaft', rotation => {
    const target = createShapeElement('rect', { id: 'box', x: 100, y: 100, width: 200, height: 120, rotation });
    const angle = rotation * Math.PI / 180, center = { x: 200, y: 160 };
    const point = { x: center.x + 105 * Math.cos(angle), y: center.y + 105 * Math.sin(angle) };
    const origin = { x: center.x + 300 * Math.cos(angle), y: center.y + 300 * Math.sin(angle) };
    const drop = bindingDrop(point, origin, [target], '', 1, true)!;
    expect(drop.binding.mode).toBe('pinned'); expect(drop.dock?.active).toBe(true);
    const bound = bindDraftEndpoints([origin.x, origin.y, point.x, point.y], [target], 1, true);
    expect(bound.endBinding).toEqual(drop.binding);
    expect((bound.absPoints[2] - origin.x) * Math.sin(angle) - (bound.absPoints[3] - origin.y) * Math.cos(angle)).toBeCloseTo(0);
    const incompatible = bindingDrop(point, { x: origin.x + 7, y: origin.y + 11 }, [target], '', 1, true);
    expect(incompatible?.dock?.active ?? false).toBe(false);
  });

});

it('retargets only display guides to resolved endpoints and filters invalid object guides', async () => {
  const { resolvedPointGuides } = await import('./pathSnapping');
  const raw = { x: 305, y: 160 }, visible = { x: 300, y: 160 };
  expect(resolvedPointGuides([
    { type: 'direction', x1: 600, y1: 160, x2: 305, y2: 160, destination: raw },
    { type: 'vertical', position: 305, destination: raw },
    { type: 'horizontal', position: 160, destination: raw },
  ], visible)).toEqual([
    { type: 'direction', x1: 600, y1: 160, x2: 300, y2: 160, destination: visible },
    { type: 'horizontal', position: 160, destination: visible },
  ]);
  expect(raw).toEqual({ x: 305, y: 160 });
});
