import { describe, expect, test } from 'vitest';
import type { ShapeElement } from '../types/presentation';
import { createShapeElement } from './slideFactory';
import { pathExtensionUpdate, pathPointsInSlide, pathPointToSlide } from './pathEditing';
import { bsplineExtensionPair } from './bsplineExtension';
import { interpolateElement } from './interpolation';
import { pathArrowGeometry, pathEndpointDirection, sampledPath, type PathExtensionEffect } from './pathShapes';

const frame = (a: ShapeElement, b: ShapeElement, t: number, forward = true) => interpolateElement(a, b, t, forward) as ShapeElement & { _pathExtension?: PathExtensionEffect };
const distance = (x: number, y: number, points: number[]) => {
  let best = Infinity;
  for (let i = 0; i < points.length - 2; i += 2) {
    const dx = points[i + 2] - points[i], dy = points[i + 3] - points[i + 1];
    const t = Math.max(0, Math.min(1, ((x - points[i]) * dx + (y - points[i + 1]) * dy) / (dx * dx + dy * dy || 1)));
    best = Math.min(best, Math.hypot(x - points[i] - dx * t, y - points[i + 1] - dy * t));
  }
  return best;
};
function assertSamePolyline(actual: number[], expected: number[], tolerance = 1e-7) {
  for (const [a, b] of [[actual, expected], [expected, actual]]) {
    for (let i = 0; i < a.length; i += 2) expect(distance(a[i], a[i + 1], b)).toBeLessThan(tolerance);
  }
}
function visibleShaftWorld(el: ShapeElement) {
  const geo = pathArrowGeometry(el);
  const points = geo.shaftCurve === 'linear' ? geo.shaftPoints : sampledPath(geo.shaftPoints, geo.shaftCurve, false, geo.shaftTangents);
  const inside = (x: number, y: number) => [geo.startGeo, geo.endGeo].some(head => {
    const boundary = head?.boundary;
    if (!boundary) return false;
    // The shared local tip guard clips round-cap spill as well as silhouette.
    const isStart = head === geo.startGeo, i = isStart ? 0 : el.points!.length - 2;
    const tipX = el.points![i], tipY = el.points![i + 1];
    const d = (el as ShapeElement & { _pathExtension?: PathExtensionEffect })._pathExtension;
    const direction = d ? (isStart ? d.startDirection : d.endDirection)
      : pathEndpointDirection(el.points!, el.curve!, false, undefined, isStart ? 'start' : 'end');
    const length = Math.hypot(direction.dx, direction.dy), ux = direction.dx / length, uy = direction.dy / length;
    const along = (x - tipX) * ux + (y - tipY) * uy;
    const across = (x - tipX) * uy - (y - tipY) * ux;
    if (along >= -1e-5 && along <= el.strokeWidth / 2 + 1e-5 && Math.abs(across) <= el.strokeWidth / 2 + 1e-5) return true;
    if ('radius' in boundary) return Math.hypot(x - boundary.cx, y - boundary.cy) <= boundary.radius + 1e-6;
    const p = boundary.points;
    const crosses = p.filter((_, i) => i % 2 === 0).map((_, i) => {
      const j = (i * 2 + 2) % p.length;
      return (p[j] - p[i * 2]) * (y - p[i * 2 + 1]) - (p[j + 1] - p[i * 2 + 1]) * (x - p[i * 2]);
    });
    return crosses.every(v => v >= -1e-5) || crosses.every(v => v <= 1e-5);
  });
  const out: number[] = [];
  for (let i = 0; i < points.length; i += 2) if (!inside(points[i], points[i + 1])) {
    const p = pathPointToSlide(el, points[i], points[i + 1]); out.push(p.x, p.y);
  }
  return out;
}
function assertVisibleLimit(actual: ShapeElement, expected: ShapeElement) {
  for (const [a, b] of [[actual, expected], [expected, actual]]) {
    const visible = visibleShaftWorld(a), other = shaftWorld(b);
    expect(visible.length).toBeGreaterThan(0);
    for (let i = 0; i < visible.length; i += 2) expect(distance(visible[i], visible[i + 1], other)).toBeLessThan(1e-4);
  }
}
function shaftWorld(el: ShapeElement) {
  const geo = pathArrowGeometry(el);
  const points = geo.shaftCurve === 'linear' ? geo.shaftPoints : sampledPath(geo.shaftPoints, geo.shaftCurve, false, geo.shaftTangents);
  return pathPointsInSlide({ ...el, points });
}
const source = (curve: 'bspline2' | 'bspline3', rotation = 0, flat = false) => createShapeElement('path', {
  x: 300, y: 300, width: 400, height: 130, rotation, curve,
  points: flat ? [0, 0, 100, 0, 200, 0] : [0, 0, 70, 80, 140, -50, 220, 90, 300, 0, 400, 40],
  startHead: 'diamond', endHead: 'triangle', cornerRadius: 0,
});
function extend(a: ShapeElement, end: 'start' | 'end') {
  const world = pathPointsInSlide(a);
  return { ...a, ...pathExtensionUpdate(a, end === 'start' ? [140, 180, ...world] : [...world, 850, 460], end),
    transitions: { position: 'const' as const, size: 'ease' as const } };
}
describe('native B-spline sampled-span extension correspondence', () => {
  for (const curve of ['bspline2', 'bspline3'] as const) for (const end of ['start', 'end'] as const) {
    test.each([0, 37])(`${curve} ${end} rotated %s: exact native nodes, near-end shafts and reverse`, rotation => {
      const a = source(curve, rotation), b = extend(a, end);
      const pair = bsplineExtensionPair(a, b)!;
      expect(pair).not.toBeNull();
      for (const [points, el] of [[pair.a, a], [pair.b, b]] as const) {
        assertSamePolyline(points, sampledPath(pathPointsInSlide(el), curve, false));
      }
      for (const t of [0, 0.000001, 0.001, 0.25, 0.5, 0.999, 0.999999, 1]) {
        const f = frame(a, b, t), r = frame(b, a, 1 - t, false);
        assertSamePolyline(shaftWorld(f), shaftWorld(r));
        if (t > 0 && t < 1) {
          expect(f._pathExtension).toBeDefined();
          const world = pathPointsInSlide(f);
          // Exact matched native nodes outside changed terminal support stay fixed.
          pair.a.forEach((v, i) => { if (Math.abs(v - pair.b[i]) < 1e-8) expect(world[i]).toBeCloseTo(v, 7); });
        } else expect(f.points).toEqual(t === 0 ? a.points : b.points);
        const far = end === 'start' ? f.points!.length - 2 : 0;
        const tip = pathPointToSlide(f, f.points![far], f.points![far + 1]);
        const aw = pathPointsInSlide(a), ai = end === 'start' ? aw.length - 2 : 0;
        expect(tip.x).toBeCloseTo(aw[ai], 7); expect(tip.y).toBeCloseTo(aw[ai + 1], 7);
      }
      for (const head of ['none', 'arrow', 'triangle', 'triangle-outline', 'circle-outline', 'diamond'] as const) {
        const ah = { ...a, startHead: head, endHead: head }, bh = { ...b, startHead: head, endHead: head };
        // A vanishing added span can exit the head before the old chain does;
        // static clipping still hides that chain inside the head silhouette.
        assertVisibleLimit(frame(ah, bh, 1e-8), ah);
        assertVisibleLimit(frame(ah, bh, 1 - 1e-8), bh);
        const g = pathArrowGeometry(frame(ah, bh, 0.25));
        expect(g.shaftClipPaths.length).toBe(pathArrowGeometry(ah).shaftClipPaths.length);
      }
    });
    test(`${curve} ${end}: const interior uses native curve and world geometry`, () => {
      const a = source(curve), b = { ...extend(a, end), transitions: { position: 'linear' as const, controlPoints: 'const' as const } };
      for (const t of [0.001, 0.25, 0.5, 0.999]) {
        const f = frame(a, b, t), expected = t < 0.5 ? a : b;
        expect(f.curve).toBe(curve); expect(f._pathExtension).toBeUndefined();
        assertSamePolyline(shaftWorld(f), shaftWorld(expected));
      }
    });
  }
  test.each(['start', 'end'] as const)('flat minimal quadratic %s and multiple added spans', end => {
    const a = source('bspline2', 0, true), b = extend(extend(a, end), end);
    expect(bsplineExtensionPair(a, b)).not.toBeNull();
    expect(frame(a, b, 0.25)._pathExtension).toBeDefined();
  });
  test('dormant corner radius stays meaningless for transient B-spline samples', () => {
    const a = { ...source('bspline3'), cornerRadius: 40 }, b = extend(a, 'start');
    for (const t of [0.000001, 0.25, 0.999999]) {
      const f = frame(a, b, t);
      expect(pathArrowGeometry(f).d).toBe(pathArrowGeometry({ ...f, cornerRadius: 0 }).d);
      expect(pathArrowGeometry(f).d).not.toContain('Q');
    }
  });
  test('head angles take a continuous shortest arc, including antiparallel and reverse ownership', () => {
    const a = source('bspline2', 0, true);
    for (const newTip of [[450, 300], [450, 280], [450, 320]]) {
      const b = { ...a, ...pathExtensionUpdate(a, [...newTip, ...pathPointsInSlide(a)], 'start'),
        transitions: { controlPoints: 'linear' as const } };
      const ad = pathEndpointDirection(a.points!, a.curve!, false, undefined, 'start');
      const bd = pathEndpointDirection(b.points!, b.curve!, false, undefined, 'start');
      for (const [t, expected] of [[1e-8, ad], [1 - 1e-8, bd]] as const) {
        const f = frame(a, b, t), d = f._pathExtension!.startDirection;
        const length = Math.hypot(expected.dx, expected.dy);
        expect(d.dx).toBeCloseTo(expected.dx / length, 6);
        expect(d.dy).toBeCloseTo(expected.dy / length, 6);
      }
      for (const t of [0.001, 0.25, 0.5, 0.75, 0.999]) {
        const f = frame(a, b, t), r = frame(b, a, 1 - t, false);
        expect(f._pathExtension!.startDirection.dx).toBeCloseTo(r._pathExtension!.startDirection.dx, 7);
        expect(f._pathExtension!.startDirection.dy).toBeCloseTo(r._pathExtension!.startDirection.dy, 7);
        expect(f._pathExtension!.endDirection.dx).toBeCloseTo(1, 7);
        expect(f._pathExtension!.endDirection.dy).toBeCloseTo(0, 7);
      }
    }
  });
  test('reject changed pose, interior, reversal, curve, rotation, closed, degree fallback and ambiguous chains', () => {
    const a = source('bspline3'), b = extend(a, 'start');
    for (const bad of [
      { ...b, x: b.x + 10 }, { ...b, rotation: 1 }, { ...b, curve: 'bspline2' as const }, { ...b, closed: true },
      { ...b, points: b.points!.map((v, i) => i === 4 ? v + 10 : v) },
      { ...b, points: b.points!.reduce<number[][]>((out, _, i, p) => i % 2 ? out : [...out, p.slice(i, i + 2)], []).reverse().flat() },
    ]) expect(bsplineExtensionPair(a, bad)).toBeNull();
    expect(bsplineExtensionPair({ ...a, points: a.points!.slice(0, 6) }, b)).toBeNull();
    const repeat = { ...a, points: [0, 0, 0, 0, 0, 0, 0, 0] };
    expect(bsplineExtensionPair(repeat, { ...repeat, points: [...repeat.points, 0, 0] })).toBeNull();
  });
});
