import { describe, expect, it } from 'vitest';
import { arrowheadGeometry, nativePathGeometry, pathArrowGeometry, pathClosureD, pathD } from './pathShapes';
import type { ArrowheadType } from '../types/presentation';
import { consumeNativeTerminals, nativeBernsteinRoots, nativeSpanInsideIntervals, nativeSpanPart, nativeSpanPoint, paintedNativePath, serializeNativePath, type NativePath, type NativePathSpan, type NativePoint } from './nativePathSpans';

const span = (controls: NativePoint[]): NativePathSpan => ({ kind: ({ 2: 'L', 3: 'Q', 4: 'C' } as const)[controls.length as 2 | 3 | 4], controls, role: 'authored', index: 0 });
const box = { points: [-1, -1, 1, -1, 1, 1, -1, 1] };
const native = (points: number[], progress = 0, radius = 25, tangents?: number[]) => nativePathGeometry({ points, curve: tangents ? 'bezier' : 'linear', cornerRadius: radius, tangents, strokeWidth: 9,
  closed: progress === 1, ...(progress > 0 && progress < 1 ? { _pathClosure: { progress, fillOpacity: progress } } : {}) })!;
const pointNear = (a: NativePoint, b: NativePoint, digits = 9) => { expect(a[0]).toBeCloseTo(b[0], digits); expect(a[1]).toBeCloseTo(b[1], digits); };

describe('nativePathSpans exact domains and boundary roots', () => {
  it.each([
    [[0, 0], [10, 20]],
    [[0, 0], [10, 30], [30, -10]],
    [[0, 0], [100, -50], [-100, 20], [30, 10]],
  ] as NativePoint[][])('retains the same native curve under de Casteljau subdivision %#', (...controls: NativePoint[]) => {
    const original = span(controls), part = nativeSpanPart(original, 0.17, 0.83);
    expect(part.kind).toBe(original.kind);
    for (let k = 0; k <= 100; k++) pointNear(nativeSpanPoint(part, k / 100), nativeSpanPoint(original, 0.17 + 0.66 * k / 100));
  });
  it('isolates tangent roots, endpoint roots and a narrow pair without sample brackets', () => {
    expect(nativeBernsteinRoots([0, 1])).toEqual([0]);
    expect(nativeBernsteinRoots([0.25, -0.25, 0.25])).toEqual([0.5]);
    // (t-.5001)^2 - 1e-10: both crossings fit between adjacent 1/256 samples.
    const a = 0.5001, c = a * a - 1e-10;
    const roots = nativeBernsteinRoots([c, c - a, c - 2 * a + 1]);
    expect(roots).toHaveLength(2);
    expect(roots[0]).toBeCloseTo(a - 1e-5, 10);
    expect(roots[1]).toBeCloseTo(a + 1e-5, 10);
  });
  it.each([0.01, 0.0001])('finds all circle/C components, not just midpoint or endpoints (radius %s)', radius => {
    // x(t) = 80(t-.2)(t-.5)(t-.8): three distinct visits to the circle.
    const s = span([[-6.4, 0], [11.2, 0], [-11.2, 0], [6.4, 0]]);
    const intervals = nativeSpanInsideIntervals(s, { cx: 0, cy: 0, radius });
    expect(intervals).toHaveLength(3);
    for (const [a, b] of intervals) {
      expect(a).toBeLessThan(b);
      expect(Math.abs(nativeSpanPoint(s, a)[0])).toBeCloseTo(radius, 8);
      expect(Math.abs(nativeSpanPoint(s, b)[0])).toBeCloseTo(radius, 8);
    }
  });
  it('does not turn an isolated outside tangency into consumed paint', () => {
    expect(nativeSpanInsideIntervals(span([[-1, 1], [1, 1]]), { cx: 0, cy: 0, radius: 1 })).toEqual([]);
    expect(nativeSpanInsideIntervals(span([[1, 1], [1, 1]]), box)).toEqual([[0, 1]]);
    expect(nativeSpanInsideIntervals(span([[0, 0], [1e-12, 1e-12]]), box)).toEqual([[0, 1]]);
  });
  it('accepts finite large translated controls and rejects nonfinite input', () => {
    const b = { cx: 1e8, cy: -1e8, radius: 1 };
    const ints = nativeSpanInsideIntervals(span([[1e8 - 2, -1e8], [1e8 + 2, -1e8]]), b);
    expect(ints[0][0]).toBeCloseTo(0.25, 12);
    expect(ints[0][1]).toBeCloseTo(0.75, 12);
    expect(() => nativeSpanInsideIntervals(span([[NaN, 0], [0, 0]]), box)).toThrow(RangeError);
  });
  it('keeps boundary-following spans and is polygon-orientation independent', () => {
    const s = span([[-2, 1], [2, 1]]);
    expect(nativeSpanInsideIntervals(s, box)).toEqual([[0.25, 0.75]]);
    expect(nativeSpanInsideIntervals(s, { points: [-1, 1, 1, 1, 1, -1, -1, -1] })).toEqual([[0.25, 0.75]]);
  });
});

describe('nativePathSpans serialization and authored provenance', () => {
  const points = [0, 0, 100, 0, 100, 100];
  it('preserves native rounded commands and assigns seam roles rather than inferring joins', () => {
    expect(serializeNativePath(native(points, 0))).toBe('M 0.00 0.00 L 75.00 0.00 Q 100.00 0.00 100.00 25.00 L 100.00 100.00');
    expect(serializeNativePath(native(points, 1))).toBe('M 25.00 0.00 L 75.00 0.00 Q 100.00 0.00 100.00 25.00 L 100.00 75.00 Q 100.00 100.00 82.32 82.32 L 17.68 17.68 Q 0.00 0.00 25.00 0.00 Z');
    expect(native(points, 1).spans.map(s => s.role)).toEqual(['authored', 'authored', 'authored', 'end-corner', 'closing', 'start-corner']);
    for (const t of [0, 1e-9, 0.1, 0.938, 1 - 1e-9, 1]) expect(serializeNativePath(native(points, t))).toBe(pathClosureD(points, 'linear', undefined, t, 25));
  });
  it('preserves native zero-leg fallback Q commands at full closure', () => {
    const p = [0, 0, 100, 0, 0, 0];
    expect(serializeNativePath(native(p, 1))).toBe('M 0.50 0.00 L 75.00 0.00 Q 100.00 0.00 75.00 0.00 L 0.50 0.00 Q 0.00 0.00 0.00 0.00 L 0.00 0.00 Q 0.00 0.00 0.50 0.00 Z');
  });
  it('preserves straight Z and manual cubic prefixes', () => {
    const tangents = [0, 60, 20, -10, -40, 30, 70, 20, -10, -50, -80, 90];
    for (const t of [0, 1e-9, 0.3, 1 - 1e-9, 1]) expect(serializeNativePath(native(points, t, 0, tangents))).toBe(pathClosureD(points, 'bezier', tangents, t));
    expect(serializeNativePath(native(points, 1, 0))).toBe(pathD(points, 'linear', true));
    expect(native(points, 1, 0).spans.at(-1)?.implicitClose).toBe(true);
  });
  it('consumes the exact crescent fixture to a prefix of its ORIGINAL first L', () => {
    const p = [325, 370, 233.5, 146.5, 230.5, 145.5];
    const path = paintedNativePath(native(p, 0, 8));
    const head = arrowheadGeometry('triangle', 230.5, 145.5, -3, -1, 10, 9);
    const result = consumeNativeTerminals(path, undefined, head.boundary);
    expect(result.runs).toHaveLength(1);
    expect(result.runs[0]).toHaveLength(1);
    const retained = result.runs[0][0];
    expect(retained.span.kind).toBe('L');
    pointNear(retained.span.controls[0], [325, 370]);
    pointNear(retained.span.controls[1], [234.8901936864617, 149.89019368693027], 7);
    expect(retained.from).toBe(0);
    expect(retained.to).toBeLessThan(1);
  });
  it('does not consume a looping manual C re-entry after the first endpoint exit', () => {
    const s = span([[0, 0], [20, 0], [-20, 0], [0, 0]]);
    const path: NativePath = { start: [0, 0], spans: [s], closed: false };
    const ints = nativeSpanInsideIntervals(s, box);
    expect(ints.length).toBeGreaterThan(1);
    const start = consumeNativeTerminals(path, box);
    expect(start.consumed[0]).toEqual([ints[0]]);
    const end = consumeNativeTerminals(path, undefined, box);
    expect(end.consumed[0]).toEqual([ints.at(-1)]);
  });
  it('owns all terminal Q components even when its midpoint is outside', () => {
    const path = native(points, 0.938);
    const head = arrowheadGeometry('triangle', 100, 100, 0, 100, 10, 1);
    const result = consumeNativeTerminals(path, undefined, head.boundary);
    expect(result.consumed[3]).toHaveLength(1);
    expect(result.consumed[3][0][0]).toBeGreaterThan(0.5);
    expect(result.consumed[3][0][1]).toBeLessThan(1);
    const full = native(points, 1);
    expect(consumeNativeTerminals(full, undefined, head.boundary).consumed[3]).toEqual([]);
  });
  it.each(['start', 'end'] as const)('never crosses coincident seam/zero Q/Z into the opposite original leg: %s', side => {
    const p = [0, 0, 100, 0, 0, 0];
    const head = arrowheadGeometry('triangle', 0, 0, -1, 0, 10, 20).boundary;
    for (const t of [0, 1e-9, 0.5, 1 - 1e-9, 1]) {
      const path = native(p, t);
      const result = consumeNativeTerminals(path, side === 'start' ? head : undefined, side === 'end' ? head : undefined);
      const authored = path.spans.map((s, i) => s.role === 'authored' ? i : -1).filter(i => i >= 0);
      expect(result.consumed[side === 'start' ? authored.at(-1)! : authored[0]]).toEqual([]);
    }
  });
  it('seeds a manual closing C in its full domain before truncation, not only at raw1', () => {
    const p = [0, 0, 100, 0];
    const tangents = [0, 20, 20, 0, -20, 0, -20, 20];
    for (const t of [0.99, 1 - 1e-9, 1]) {
      const path = native(p, t, 0, tangents);
      const result = consumeNativeTerminals(path, box);
      const seam = path.spans.length - 1;
      if (t > 0.999) expect(result.consumed[seam].length).toBe(1);
      expect(result.consumed[0][0][0]).toBe(0);
    }
  });
  it('consumes only the stable authored-end component of a looping manual closing prefix', () => {
    const p = [0, 0, 100, 0];
    const tangents = [400, 0, 20, 0, -20, 0, -400, 0];
    const full = native(p, 1, 0, tangents).spans[1];
    const all = nativeSpanInsideIntervals(full, box);
    expect(all.length).toBeGreaterThan(1);
    const owned = all.at(-1)!;
    expect(owned[1]).toBe(1);
    for (const t of [1e-9, 0.001, 0.1, 0.3, 0.6, 0.9, 0.99, 1 - 1e-9, 1]) {
      const path = native(p, t, 0, tangents);
      const consumed = consumeNativeTerminals(path, box).consumed[1];
      if (t <= owned[0]) expect(consumed).toEqual([]);
      else {
        expect(consumed).toHaveLength(1);
        expect(consumed[0][0] * t).toBeCloseTo(owned[0], 10);
        expect(consumed[0][1]).toBe(1);
      }
    }
  });
  it('unions overlapping head intervals without XOR and handles an empty shaft', () => {
    const path = native([0, 0, 1, 0], 0, 0);
    const result = consumeNativeTerminals(path, box, box);
    expect(result.consumed).toEqual([[[0, 1]]]);
    expect(result.runs).toEqual([]);
  });
  it('keeps near0/near1 consumption continuous by original span across all heads and provenance counterexamples', () => {
    const heads: ArrowheadType[] = ['none', 'arrow', 'triangle', 'triangle-outline', 'bar', 'dot', 'circle', 'circle-outline', 'diamond', 'diamond-outline', 'crowfoot-one', 'crowfoot-many', 'crowfoot-one-many'];
    const routes = [[0, 0, 100, 0, 100, 100], [0, 0, 100, 0, 100, 4, 0, 4], [0, 0, 0, 0, 100, 100], [0, 0, 100, 0, 0, 0], [0, 0, 0, 0, 0, 0], [0, 0, 100, 100, 0, 100, 100, 0, 0, 0], [0, 0, 3, 1, 94.5, 224.5]];
    const signature = (p: NativePath, start?: ReturnType<typeof arrowheadGeometry>['boundary'], end?: ReturnType<typeof arrowheadGeometry>['boundary']) => {
      const result = consumeNativeTerminals(p, start, end);
      return new Map(p.spans.map((s, i) => [`${s.role}/${s.index}/${s.kind}`, { span: s, intervals: result.consumed[i] }]));
    };
    const disagreement = (a: ReturnType<typeof signature>, b: ReturnType<typeof signature>) => {
      let bound = 0;
      for (const key of new Set([...a.keys(), ...b.keys()])) {
        const aa = a.get(key), bb = b.get(key);
        const sa = aa?.span, sb = bb?.span;
        const polygonLength = (s: NativePathSpan | undefined) => s ? s.controls.slice(1).reduce((sum, p, i) => sum + Math.hypot(p[0] - s.controls[i][0], p[1] - s.controls[i][1]), 0) : 0;
        if (!sa || !sb) { bound += polygonLength(sa ?? sb); continue; }
        const intervalsA = aa!.intervals, intervalsB = bb!.intervals;
        const cuts = [...new Set([0, 1, ...intervalsA.flat(), ...intervalsB.flat()])].sort((x, y) => x - y);
        const inIntervals = (t: number, intervals: number[][]) => intervals.some(([x, y]) => t >= x && t <= y);
        const speedBound = (sa.controls.length - 1) * Math.max(polygonLength(sa), polygonLength(sb));
        for (let i = 1; i < cuts.length; i++) {
          const mid = (cuts[i - 1] + cuts[i]) / 2;
          if (inIntervals(mid, intervalsA) !== inIntervals(mid, intervalsB)) bound += (cuts[i] - cuts[i - 1]) * speedBound;
        }
        bound += Math.max(...sa.controls.map((p, i) => Math.hypot(p[0] - sb.controls[i][0], p[1] - sb.controls[i][1])));
      }
      return bound;
    };
    let cases = 0;
    for (const points of routes) for (const head of heads) for (const side of ['start', 'end', 'both']) for (const width of [1, 9, 20]) {
      const signatures = [0, 1e-9, 1 - 1e-9, 1].map(progress => {
        const shape = { points, cornerRadius: 25, strokeWidth: width, closed: progress === 1,
          startHead: side === 'end' ? 'none' as const : head, endHead: side === 'start' ? 'none' as const : head,
          _pathClosure: { progress, fillOpacity: progress } };
        const geo = pathArrowGeometry(shape);
        return signature(nativePathGeometry(shape)!, geo.startGeo?.boundary, geo.endGeo?.boundary);
      });
      expect(disagreement(signatures[0], signatures[1]), JSON.stringify({ points, head, side, width, end: 0 })).toBeLessThan(0.001);
      expect(disagreement(signatures[2], signatures[3]), JSON.stringify({ points, head, side, width, end: 1 })).toBeLessThan(0.001);
      cases++;
    }
    expect(cases).toBe(819);
  });
  it('excludes legacy modes and the B-spline extension guard', () => {
    const shape = { points, cornerRadius: 8, strokeWidth: 9 };
    expect(nativePathGeometry({ ...shape, curve: 'bspline2' })).toBeNull();
    expect(nativePathGeometry({ ...shape, curve: 'bezier' })).toBeNull();
    expect(nativePathGeometry({ ...shape, _pathExtension: { startDirection: { dx: 1, dy: 0 }, endDirection: { dx: 1, dy: 0 } } })).toBeNull();
  });
});
