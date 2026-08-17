import { describe, expect, test } from 'vitest';
import {
  isLinePath,
  strokeDashFor,
  pathD,
  sampledPath,
  insetEndpoints,
  pathArcLength,
  pointAtArcLength,
  arrowheadPoints,
  pathBounds,
  resamplePath,
} from './pathShapes';
import { shapeToPathD } from './shapeToPath';
import type { ShapeElement } from '../types/presentation';

// Matches bsplineSamples' internal constant. If this test fails after an
// intentional retune, update the expected counts here.
const SAMPLES_PER_SEG = 32; // keep in sync with pathShapes.ts

/** Pull every numeric token out of a d-string. */
function numbersIn(d: string): number[] {
  return (d.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);
}

function countCmd(d: string, cmd: string): number {
  return (d.match(new RegExp(`(^| )${cmd} `, 'g')) ?? []).length
    + (cmd === 'Z' || cmd === 'z' ? (d.match(new RegExp(`(^| )${cmd}$`, 'g')) ?? []).length : 0);
}

function bbox(flat: number[]): { minX: number; minY: number; maxX: number; maxY: number } {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let i = 0; i < flat.length; i += 2) {
    minX = Math.min(minX, flat[i]);
    maxX = Math.max(maxX, flat[i]);
    minY = Math.min(minY, flat[i + 1]);
    maxY = Math.max(maxY, flat[i + 1]);
  }
  return { minX, minY, maxX, maxY };
}

function makePathShape(overrides: Partial<ShapeElement> = {}): ShapeElement {
  return {
    id: 'el',
    type: 'shape',
    shapeType: 'path',
    x: 0, y: 0, width: 100, height: 100,
    rotation: 0, opacity: 1, locked: false, visible: true,
    fill: '#ff0000', stroke: '#0000ff', strokeWidth: 2, cornerRadius: 0,
    points: [0, 0, 100, 0],
    ...overrides,
  };
}

// =============================================================================
// Classification helpers
// =============================================================================

describe('isLinePath', () => {
  test('two-point linear path is a line; anything else is not', () => {
    expect(isLinePath({ shapeType: 'path', points: [0, 0, 1, 1] })).toBe(true);
    expect(isLinePath({ shapeType: 'path', points: [0, 0, 1, 1], curve: 'linear' })).toBe(true);
    expect(isLinePath({ shapeType: 'path', points: [0, 0, 1, 1], curve: 'bspline3' })).toBe(false);
    expect(isLinePath({ shapeType: 'path', points: [0, 0, 1, 1, 2, 2] })).toBe(false);
    expect(isLinePath({ shapeType: 'rect', points: [0, 0, 1, 1] })).toBe(false);
    expect(isLinePath({ shapeType: 'path' })).toBe(false);
  });
});

// =============================================================================
// strokeDashFor
// =============================================================================

describe('strokeDashFor', () => {
  test('solid / unset styles produce no dasharray', () => {
    expect(strokeDashFor('solid', 4)).toBeUndefined();
    expect(strokeDashFor(undefined, 4)).toBeUndefined();
    expect(strokeDashFor('bogus', 4)).toBeUndefined();
  });

  test('dashed is 3w dash / 2w gap', () => {
    expect(strokeDashFor('dashed', 4)).toBe('12 8');
    expect(strokeDashFor('dashed', 1)).toBe('3 2');
  });

  test('dotted is zero-length dash (round cap = the dot) with 2w gap', () => {
    expect(strokeDashFor('dotted', 4)).toBe('0 8');
  });

  test('tiny stroke widths clamp to 0.5 so the pattern never degenerates', () => {
    expect(strokeDashFor('dashed', 0.2)).toBe('1.5 1');
    expect(strokeDashFor('dotted', 0)).toBe('0 1');
  });
});

// =============================================================================
// pathD — linear paths
// =============================================================================

describe('pathD (linear)', () => {
  test('open two-point line is a single M + L (coords fixed to 2 decimals)', () => {
    expect(pathD([0, 0, 100, 0], 'linear', false)).toBe('M 0.00 0.00 L 100.00 0.00');
  });

  test('closed rectangle emits M + 3 L + Z', () => {
    expect(pathD([0, 0, 100, 0, 100, 50, 0, 50], 'linear', true))
      .toBe('M 0.00 0.00 L 100.00 0.00 L 100.00 50.00 L 0.00 50.00 Z');
  });

  test('fewer than two vertices yields an empty string', () => {
    expect(pathD([], 'linear', false)).toBe('');
    expect(pathD([5, 5], 'linear', false)).toBe('');
  });

  test('cornerRadius rounds interior joints of an open polyline (golden)', () => {
    // Right-angle elbow at (100,0): the joint becomes L(90,0) Q(100,0 → 100,10).
    expect(pathD([0, 0, 100, 0, 100, 100], 'linear', false, 10))
      .toBe('M 0.00 0.00 L 90.00 0.00 Q 100.00 0.00 100.00 10.00 L 100.00 100.00');
  });

  test('cornerRadius clamps to half the shorter adjacent edge', () => {
    // Edges are 100 long, so an absurd r=1000 clamps to 50.
    expect(pathD([0, 0, 100, 0, 100, 100], 'linear', false, 1000))
      .toBe('M 0.00 0.00 L 50.00 0.00 Q 100.00 0.00 100.00 50.00 L 100.00 100.00');
  });

  test('cornerRadius is ignored for a plain two-point line', () => {
    expect(pathD([0, 0, 100, 0], 'linear', false, 10)).toBe('M 0.00 0.00 L 100.00 0.00');
  });

  test('closed polyline with cornerRadius rounds every vertex', () => {
    const d = pathD([0, 0, 100, 0, 100, 50, 0, 50], 'linear', true, 10);
    expect(countCmd(d, 'Q')).toBe(4);      // one rounded corner per vertex
    expect(d.endsWith('Z')).toBe(true);
    expect(d.startsWith('M 10.00 0.00')).toBe(true); // start is pulled r along the first edge
  });
});

// =============================================================================
// pathD — B-splines render as sampled polylines
// =============================================================================

describe('pathD (bspline)', () => {
  test('bspline d-string contains only M/L commands (pre-sampled polyline)', () => {
    const d = pathD([0, 0, 50, 100, 100, 0, 150, 100], 'bspline3', false);
    expect(d.startsWith('M ')).toBe(true);
    expect(d).not.toContain('C');
    expect(d).not.toContain('Q');
    expect(countCmd(d, 'L')).toBeGreaterThan(10);
  });
});

// =============================================================================
// sampledPath — B-spline sampling
// =============================================================================

describe('sampledPath', () => {
  const quad = [0, 0, 50, 100, 100, 0];           // n = 3
  const cubic = [0, 0, 50, 100, 100, 0, 150, 100]; // n = 4

  test('linear mode passes through as a copy, not the same array', () => {
    const pts = [0, 0, 100, 0];
    const out = sampledPath(pts, 'linear', false);
    expect(out).toEqual(pts);
    expect(out).not.toBe(pts);
  });

  // Pins CURRENT behaviour: per segment the loop skips s=0 for seg>0 AND
  // s=SAMPLES_PER_SEG for non-last segments — BOTH conditions fire at every
  // interior boundary, so the exact knot/joint point between two segments is
  // never emitted. That yields (S−1)·numSegs + 2 points rather than the
  // S·numSegs + 1 a keep-one-duplicate scheme would produce. Visually
  // negligible (1/32 spacing) but an off-by-one worth knowing about.
  const expectedPoints = (numSegs: number) => (SAMPLES_PER_SEG - 1) * numSegs + 2;
  test.todo('suspected off-by-one: interior segment-boundary samples are dropped entirely');

  test('open cubic sample count follows SAMPLES_PER_SEG (numSegs = n + 3)', () => {
    // Open clamped cubic pads 3 endpoint copies per side: numSegs = n + 3.
    const out = sampledPath(cubic, 'bspline3', false);
    expect(out.length).toBe(expectedPoints(4 + 3) * 2);
  });

  test('open quadratic sample count (numSegs = n + 2)', () => {
    const out = sampledPath(quad, 'bspline2', false);
    expect(out.length).toBe(expectedPoints(3 + 2) * 2);
  });

  test('open clamped spline passes through its first and last control points', () => {
    const out = sampledPath(cubic, 'bspline3', false);
    expect(out[0]).toBeCloseTo(0);
    expect(out[1]).toBeCloseTo(0);
    expect(out[out.length - 2]).toBeCloseTo(150);
    expect(out[out.length - 1]).toBeCloseTo(100);
  });

  test('samples stay inside the control-point bounding box (convex hull property)', () => {
    for (const [pts, curve] of [[cubic, 'bspline3'], [quad, 'bspline2']] as const) {
      const hull = bbox(pts);
      const s = bbox(sampledPath(pts, curve, false));
      expect(s.minX).toBeGreaterThanOrEqual(hull.minX - 1e-9);
      expect(s.maxX).toBeLessThanOrEqual(hull.maxX + 1e-9);
      expect(s.minY).toBeGreaterThanOrEqual(hull.minY - 1e-9);
      expect(s.maxY).toBeLessThanOrEqual(hull.maxY + 1e-9);
    }
  });

  test('closed cubic wraps cyclically (numSegs = n) and the loop closes', () => {
    const square = [0, 0, 100, 0, 100, 100, 0, 100];
    const out = sampledPath(square, 'bspline3', true);
    expect(out.length).toBe(expectedPoints(4) * 2);
    // Cyclic closure: last sample lands back on the first.
    expect(out[out.length - 2]).toBeCloseTo(out[0]);
    expect(out[out.length - 1]).toBeCloseTo(out[1]);
    // A closed uniform B-spline does NOT pass through its control points —
    // the curve of a square control polygon is strictly inside it.
    const s = bbox(out);
    expect(s.minX).toBeGreaterThan(0);
    expect(s.maxX).toBeLessThan(100);
  });

  test('cubic with too few control points steps down to quadratic, not straight to linear', () => {
    // n=3 open cubic can't produce non-degenerate segments; it should sample
    // exactly like the quadratic instead of snapping to a polyline.
    expect(sampledPath(quad, 'bspline3', false)).toEqual(sampledPath(quad, 'bspline2', false));
  });

  test('two-point open spline degrades to the raw polyline', () => {
    const line = [0, 0, 100, 0];
    expect(sampledPath(line, 'bspline2', false)).toEqual(line);
  });
});

// =============================================================================
// resamplePath
// =============================================================================

describe('resamplePath', () => {
  test('open line resamples to equally-spaced points including both endpoints', () => {
    expect(resamplePath([0, 0, 100, 0], 5, false))
      .toEqual([0, 0, 25, 0, 50, 0, 75, 0, 100, 0]);
  });

  test('closed square resampled at N=4 lands exactly on the corners', () => {
    // Perimeter 40, targets at 0/10/20/30 → the four vertices.
    expect(resamplePath([0, 0, 10, 0, 10, 10, 0, 10], 4, true))
      .toEqual([0, 0, 10, 0, 10, 10, 0, 10]);
  });

  test('closed path spacing wraps through the closing segment', () => {
    // Closed square, N=8: every corner plus every edge midpoint.
    const out = resamplePath([0, 0, 10, 0, 10, 10, 0, 10], 8, true);
    expect(out.length).toBe(16);
    expect(out.slice(0, 6)).toEqual([0, 0, 5, 0, 10, 0]);
    // Last point sits mid-way along the closing edge (0,10) → (0,0).
    expect(out[14]).toBeCloseTo(0);
    expect(out[15]).toBeCloseTo(5);
  });

  test('degenerate zero-length path repeats the first vertex', () => {
    expect(resamplePath([5, 5, 5, 5], 3, false)).toEqual([5, 5, 5, 5, 5, 5]);
  });

  test('too few vertices or targetN < 2 returns a copy unchanged', () => {
    expect(resamplePath([1, 2], 5, false)).toEqual([1, 2]);
    expect(resamplePath([0, 0, 10, 0], 1, false)).toEqual([0, 0, 10, 0]);
  });
});

// =============================================================================
// insetEndpoints
// =============================================================================

describe('insetEndpoints', () => {
  test('no arrows returns the SAME array reference (no copy)', () => {
    const pts = [0, 0, 100, 0];
    expect(insetEndpoints(pts, false, false)).toBe(pts);
  });

  test('end arrow pulls the last vertex back along the incoming direction', () => {
    expect(insetEndpoints([0, 0, 100, 0], false, true)).toEqual([0, 0, 90, 0]);
  });

  test('start arrow pulls the first vertex forward along the outgoing direction', () => {
    expect(insetEndpoints([0, 0, 100, 0], true, false)).toEqual([10, 0, 100, 0]);
  });

  test('both arrows inset both ends; the interior is untouched', () => {
    expect(insetEndpoints([0, 0, 50, 0, 100, 0], true, true))
      .toEqual([10, 0, 50, 0, 90, 0]);
  });

  test('inset moves along the actual segment direction (3-4-5 diagonal)', () => {
    const out = insetEndpoints([0, 0, 30, 40], false, true);
    expect(out[2]).toBeCloseTo(24); // 30 − 10·(30/50)
    expect(out[3]).toBeCloseTo(32); // 40 − 10·(40/50)
  });

  test('segments shorter than headLen are left alone (no inversion)', () => {
    expect(insetEndpoints([0, 0, 5, 0], true, true)).toEqual([0, 0, 5, 0]);
  });

  test('original array is never mutated when arrows are set', () => {
    const pts = [0, 0, 100, 0];
    insetEndpoints(pts, true, true);
    expect(pts).toEqual([0, 0, 100, 0]);
  });
});

// =============================================================================
// pathArcLength / pointAtArcLength
// =============================================================================

describe('pathArcLength', () => {
  test('open polyline sums its segment lengths', () => {
    expect(pathArcLength([0, 0, 100, 0], 'linear', false)).toBeCloseTo(100);
    expect(pathArcLength([0, 0, 30, 40, 30, 140], 'linear', false)).toBeCloseTo(150);
  });

  test('closed path includes the closing segment', () => {
    expect(pathArcLength([0, 0, 10, 0, 10, 10, 0, 10], 'linear', true)).toBeCloseTo(40);
  });

  test('bspline length lies between the chord and the control-polygon length', () => {
    const pts = [0, 0, 50, 100, 100, 0];
    const len = pathArcLength(pts, 'bspline2', false);
    const chord = 100;
    const controlPoly = 2 * Math.hypot(50, 100);
    expect(len).toBeGreaterThan(chord);
    expect(len).toBeLessThan(controlPoly);
  });
});

describe('pointAtArcLength', () => {
  test('walks an open line to the requested distance with the segment tangent', () => {
    const p = pointAtArcLength([0, 0, 100, 0], 'linear', false, 25)!;
    expect(p.x).toBeCloseTo(25);
    expect(p.y).toBeCloseTo(0);
    expect(p.dx).toBeGreaterThan(0);
    expect(p.dy).toBeCloseTo(0);
  });

  test('distance past the end clamps to the final endpoint', () => {
    const p = pointAtArcLength([0, 0, 100, 0], 'linear', false, 250)!;
    expect(p.x).toBeCloseTo(100);
    expect(p.y).toBeCloseTo(0);
  });

  test('closed path walk continues through the closing segment', () => {
    const square = [0, 0, 10, 0, 10, 10, 0, 10];
    const onSecondEdge = pointAtArcLength(square, 'linear', true, 15)!;
    expect(onSecondEdge.x).toBeCloseTo(10);
    expect(onSecondEdge.y).toBeCloseTo(5);
    // 35 lands mid-way down the closing edge (0,10) → (0,0).
    const onClosingEdge = pointAtArcLength(square, 'linear', true, 35)!;
    expect(onClosingEdge.x).toBeCloseTo(0);
    expect(onClosingEdge.y).toBeCloseTo(5);
    expect(onClosingEdge.dy).toBeLessThan(0); // heading back up to the start
  });

  test('returns null for degenerate point lists', () => {
    expect(pointAtArcLength([5, 5], 'linear', false, 0)).toBeNull();
  });
});

// =============================================================================
// arrowheadPoints
// =============================================================================

describe('arrowheadPoints', () => {
  test('axis-aligned golden triangle: tip stays, base sits size behind, wings ±size/2', () => {
    expect(arrowheadPoints(100, 0, 1, 0, 10)).toEqual([100, 0, 90, 5, 90, -5]);
  });

  test('direction vector is normalized (magnitude does not change the triangle)', () => {
    expect(arrowheadPoints(100, 0, 500, 0, 10)).toEqual(arrowheadPoints(100, 0, 1, 0, 10));
  });

  test('diagonal direction keeps the tip and a base at distance `size`', () => {
    const [tx, ty, lx, ly, rx, ry] = arrowheadPoints(0, 0, 1, 1, 10);
    expect(tx).toBe(0);
    expect(ty).toBe(0);
    // Both wings are equidistant from the tip.
    expect(Math.hypot(lx, ly)).toBeCloseTo(Math.hypot(rx, ry));
    // Wing separation equals `size`.
    expect(Math.hypot(lx - rx, ly - ry)).toBeCloseTo(10);
  });

  test('zero direction falls back gracefully instead of dividing by zero', () => {
    const pts = arrowheadPoints(10, 10, 0, 0, 10);
    expect(pts.every(Number.isFinite)).toBe(true);
  });
});

// =============================================================================
// pathBounds
// =============================================================================

describe('pathBounds', () => {
  test('computes bbox and translates vertices to the origin', () => {
    expect(pathBounds([10, 20, 110, 70])).toEqual({
      x: 10, y: 20, width: 100, height: 50,
      points: [0, 0, 100, 50],
    });
  });

  test('degenerate (zero-extent) paths clamp width/height to 1', () => {
    const b = pathBounds([5, 5, 5, 5]);
    expect(b.width).toBe(1);
    expect(b.height).toBe(1);
    expect(b.points).toEqual([0, 0, 0, 0]);
  });

  test('empty input yields the zero box', () => {
    expect(pathBounds([])).toEqual({ x: 0, y: 0, width: 0, height: 0, points: [] });
  });
});

// =============================================================================
// shapeToPathD — preset outline generation (rect / ellipse / triangle / star)
// =============================================================================

describe('shapeToPathD presets', () => {
  test('sharp rect is the compact h/v/z form (golden)', () => {
    const d = shapeToPathD(makePathShape({ shapeType: 'rect', x: 10, y: 20, width: 100, height: 50 }));
    expect(d).toBe('M 10 20 h 100 v 50 h -100 z');
  });

  test('rounded rect starts inset by r and uses four arc corners', () => {
    const d = shapeToPathD(makePathShape({ shapeType: 'rect', x: 0, y: 0, width: 100, height: 50, cornerRadius: 8 }));
    expect(d.startsWith('M 8 0')).toBe(true);
    expect((d.match(/a 8 8/g) ?? []).length).toBe(4);
    expect(d.endsWith('z')).toBe(true);
  });

  test('rect corner radius clamps to half the shorter side', () => {
    const d = shapeToPathD(makePathShape({ shapeType: 'rect', x: 0, y: 0, width: 100, height: 50, cornerRadius: 100 }));
    expect(d.startsWith('M 25 0')).toBe(true);
    expect(d).toContain('a 25 25');
  });

  test('ellipse is two half-arcs from the left extreme (golden)', () => {
    const d = shapeToPathD(makePathShape({ shapeType: 'ellipse', x: 0, y: 0, width: 100, height: 50 }));
    expect(d).toBe('M 0 25 a 50 25 0 1 0 100 0 a 50 25 0 1 0 -100 0 z');
  });

  test('triangle: apex on top, symmetric base at the 30° chord', () => {
    const d = shapeToPathD(makePathShape({ shapeType: 'triangle', x: 0, y: 0, width: 100, height: 100 }));
    const [x0, y0, x1, y1, x2, y2] = numbersIn(d);
    expect(x0).toBeCloseTo(50);            // apex centred horizontally
    expect(y0).toBeCloseTo(0);             // apex at the top of the box
    expect(y1).toBeCloseTo(75);            // base vertices share a y
    expect(y2).toBeCloseTo(75);
    expect(x1 + x2).toBeCloseTo(100);      // symmetric about the centre
    expect(x1).toBeCloseTo(50 - 50 * Math.cos(Math.PI / 6));
    expect(d.trim().endsWith('Z')).toBe(true);
  });

  test('star: 10 vertices alternating outer/inner radius, first point straight up', () => {
    const d = shapeToPathD(makePathShape({ shapeType: 'star', x: 0, y: 0, width: 100, height: 100 }));
    const nums = numbersIn(d);
    expect(nums.length).toBe(20);
    expect(countCmd(d, 'L')).toBe(9);
    expect(d.trim().endsWith('Z')).toBe(true);
    // First vertex is the top outer point.
    expect(nums[0]).toBeCloseTo(50);
    expect(nums[1]).toBeCloseTo(0);
    // Radii alternate 50 (outer) / 25 (inner) around the centre (50,50).
    for (let i = 0; i < 10; i++) {
      const r = Math.hypot(nums[2 * i] - 50, nums[2 * i + 1] - 50);
      expect(r).toBeCloseTo(i % 2 === 0 ? 50 : 25, 5);
    }
  });

  test('path preset: arrowhead wings are appended and the shaft is inset', () => {
    const d = shapeToPathD(makePathShape({
      shapeType: 'path', x: 0, y: 0, points: [0, 0, 100, 0], endArrow: true,
    }));
    // Shaft stops 10 units short of the tip…
    expect(d.startsWith('M 0.00 0.00 L 90.00 0.00')).toBe(true);
    // …and the head is traced as wing → tip → wing.
    expect(d).toContain('M 90 -5 L 100 0 L 90 5');
  });

  test('path preset with too few points returns an empty d', () => {
    expect(shapeToPathD(makePathShape({ shapeType: 'path', points: [] }))).toBe('');
  });
});
