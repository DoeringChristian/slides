import { describe, expect, it } from 'vitest';
import { applyMatrix, arcToCubics, contoursBounds, ellipseContour, parsePathData, pointsContour, rectContour } from './svgPathData';

describe('SVG path data', () => {
  it('parses absolute and relative commands, implicit linetos and closing', () => {
    const [c] = parsePathData('M10 10 20 10 l0 10 h-10 v-5 z');
    expect(c.start).toEqual([10, 10]);
    expect(c.segments.map(s => s.to)).toEqual([[20, 10], [20, 20], [10, 20], [10, 15]]);
    expect(c.closed).toBe(true);
  });

  it('reduces quadratic and smooth curves to cubics', () => {
    const [q] = parsePathData('M0 0 Q 10 20 20 0 T 40 0');
    expect(q.segments).toHaveLength(2);
    expect(q.segments[0]).toMatchObject({ kind: 'cubic', to: [20, 0] });
    // The quadratic control (10,20) becomes cubic controls 2/3 of the way.
    expect((q.segments[0] as { c1: number[] }).c1[1]).toBeCloseTo(40 / 3);
    const [s] = parsePathData('M0 0 C 0 10 10 10 10 0 S 20 -10 20 0');
    expect(s.segments[1]).toMatchObject({ kind: 'cubic', c1: [10, -10] });
  });

  it('reads arc flags written without separators', () => {
    const [a] = parsePathData('M0 0a10 10 0 0120 0');
    expect(a.segments.at(-1)!.to[0]).toBeCloseTo(20);
    expect(a.segments.at(-1)!.to[1]).toBeCloseTo(0);
  });

  it('turns arcs into cubics that stay on the circle', () => {
    const segs = arcToCubics([0, 0], 10, 10, 0, false, true, [20, 0]);
    // Every cubic endpoint lies on the circle centred at (10, 0).
    for (const s of segs) expect(Math.hypot(s.to[0] - 10, s.to[1])).toBeCloseTo(10, 6);
    // A half circle needs two ≤90° pieces.
    expect(segs).toHaveLength(2);
    const b = contoursBounds([{ start: [0, 0], segments: segs, closed: false }])!;
    expect(b.width).toBeCloseTo(20, 3);
    expect(b.height).toBeCloseTo(10, 2);
  });

  it('measures curves by their extremes, not their control points', () => {
    const b = contoursBounds([ellipseContour(50, 50, 30, 20)])!;
    expect(b.x).toBeCloseTo(20, 6); expect(b.width).toBeCloseTo(60, 6);
    expect(b.y).toBeCloseTo(30, 6); expect(b.height).toBeCloseTo(40, 6);
  });

  it('applies transforms exactly and builds basic shapes', () => {
    const [r] = applyMatrix([rectContour(0, 0, 10, 20)], { a: 2, b: 0, c: 0, d: 3, e: 5, f: 7 });
    expect(contoursBounds([r])).toEqual({ x: 5, y: 7, width: 20, height: 60 });
    const rounded = rectContour(0, 0, 100, 50, 10);
    expect(rounded.segments.filter(s => s.kind === 'cubic')).toHaveLength(4);
    expect(pointsContour('0,0 10,0 10 10', true)).toMatchObject({ closed: true, segments: [{ to: [10, 0] }, { to: [10, 10] }] });
  });

  it('rejects malformed data', () => {
    expect(() => parsePathData('M 0 0 L x')).toThrow(/Bad path data/);
  });
});
