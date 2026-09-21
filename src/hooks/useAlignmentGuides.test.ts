import { describe, expect, test } from 'vitest';
import { computeGuides, type Guide, type SpacingGuide } from './useAlignmentGuides';

// All spacing tests use two reference elements in one horizontal "row":
//   A: x 0..100,   y 0..50
//   B: x 150..250, y 0..50   → gap between A and B = 50
const A = { x: 0, y: 0, width: 100, height: 50 };
const B = { x: 150, y: 0, width: 100, height: 50 };

const spacingGuides = (guides: Guide[]): SpacingGuide[] =>
  guides.filter((g): g is SpacingGuide => g.type === 'spacing');

describe('computeGuides — equal-spacing magnet', () => {
  test('third element to the right of B snaps to the A–B gap', () => {
    // Target: dragged.left = B.right + 50 = 300. Approach at 297 (3px off).
    const dragged = { x: 297, y: 10, width: 80, height: 30 };
    const { snapX, guides } = computeGuides(dragged, [A, B], 5);
    expect(snapX).toBe(300);
    const sg = spacingGuides(guides);
    expect(sg).toHaveLength(1);
    expect(sg[0].axis).toBe('x');
    // Both rendered gap segments span exactly the matched gap of 50,
    // using the SNAPPED position for the dragged side.
    expect(sg[0].segments).toEqual([
      { from: 100, to: 150 },
      { from: 250, to: 300 },
    ]);
  });

  test('third element to the left of A snaps to the A–B gap', () => {
    // Target: dragged.right = A.left - 50 → x = 0 - 50 - 80 = -130.
    const dragged = { x: -127, y: 10, width: 80, height: 30 };
    const { snapX, guides } = computeGuides(dragged, [A, B], 5);
    expect(snapX).toBe(-130);
    expect(spacingGuides(guides)[0].segments).toEqual([
      { from: -50, to: 0 },
      { from: 100, to: 150 },
    ]);
  });

  test('element between two spread elements snaps to equal gaps (midpoint)', () => {
    const left = { x: 0, y: 0, width: 100, height: 50 };
    const right = { x: 240, y: 0, width: 100, height: 50 };
    // Gap region 100..240 (140 wide); dragged w=40 → equal gaps of 50 at x=150.
    const dragged = { x: 153, y: 10, width: 40, height: 30 };
    const { snapX, guides } = computeGuides(dragged, [left, right], 5);
    expect(snapX).toBe(150);
    expect(spacingGuides(guides)[0].segments).toEqual([
      { from: 100, to: 150 },
      { from: 190, to: 240 },
    ]);
  });

  test('no spacing snap without band overlap (different row)', () => {
    const dragged = { x: 297, y: 500, width: 80, height: 30 };
    const { snapX, guides } = computeGuides(dragged, [A, B], 5);
    expect(snapX).toBeNull();
    expect(spacingGuides(guides)).toHaveLength(0);
  });

  test('outside the threshold nothing snaps', () => {
    const dragged = { x: 290, y: 10, width: 80, height: 30 };
    const { snapX, guides } = computeGuides(dragged, [A, B], 5);
    expect(snapX).toBeNull();
    expect(spacingGuides(guides)).toHaveLength(0);
  });

  test('closer edge alignment beats a farther spacing candidate', () => {
    // Spacing target 300 is 4px away; edge alignment with C.left = 298 is 1px away.
    const C = { x: 298, y: 100, width: 50, height: 20 };
    const dragged = { x: 296, y: 10, width: 80, height: 30 };
    const { snapX, guides } = computeGuides(dragged, [A, B, C], 5);
    expect(snapX).toBe(298);
    expect(spacingGuides(guides)).toHaveLength(0);
  });

  test('closer spacing candidate beats a farther edge alignment', () => {
    const C = { x: 305, y: 100, width: 50, height: 20 };
    const dragged = { x: 301, y: 10, width: 80, height: 30 };
    const { snapX, guides } = computeGuides(dragged, [A, B, C], 5);
    expect(snapX).toBe(300);
    expect(spacingGuides(guides)).toHaveLength(1);
  });

  test('vertical axis: element below two stacked elements snaps to their gap', () => {
    const top = { x: 0, y: 0, width: 50, height: 100 };
    const mid = { x: 10, y: 150, width: 50, height: 100 };
    // Gap 50 → target dragged.top = 250 + 50 = 300.
    const dragged = { x: 20, y: 303, width: 30, height: 80 };
    const { snapY, guides } = computeGuides(dragged, [top, mid], 5);
    expect(snapY).toBe(300);
    const sg = spacingGuides(guides);
    expect(sg).toHaveLength(1);
    expect(sg[0].axis).toBe('y');
    expect(sg[0].segments).toEqual([
      { from: 100, to: 150 },
      { from: 250, to: 300 },
    ]);
  });

  test('plain edge guides still work as before', () => {
    const dragged = { x: 2, y: 200, width: 80, height: 30 };
    const { snapX, guides } = computeGuides(dragged, [A, B], 5);
    expect(snapX).toBe(0);
    expect(guides.some((g) => g.type === 'vertical' && g.position === 0)).toBe(true);
  });
});
