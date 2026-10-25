import { describe, expect, test } from 'vitest';
import { createShapeElement } from './slideFactory';
import { pathExtensionUpdate, pathGeometryUpdate, pathPointsInSlide, pathPointToSlide, slidePointToPath } from './pathEditing';
import { catmullTangents, pathD, sampledPath, pathArrowGeometry } from './pathShapes';
import { cornerRadiusControl } from './cornerRadiusControl';

const shape = createShapeElement('path', { x: 50, y: 60, width: 100, height: 80,
  points: [0, 0, 100, 0, 100, 80], curve: 'linear' });

describe('pathEditing', () => {
  test.each([0, 37, 90, 180])('normalizing rotated geometry preserves all visible vertices (%s°)', (rotation) => {
    const el = { ...shape, rotation, curve: 'smooth' as const };
    const old = pathPointsInSlide(el);
    const updated = { ...el, ...pathGeometryUpdate(el, el.points!) };
    pathPointsInSlide(updated).forEach((v, i) => expect(v).toBeCloseTo(old[i], 8));
    const p = pathPointToSlide(el, 31, -8);
    const local = slidePointToPath(el, p.x, p.y);
    expect(local.x).toBeCloseTo(31); expect(local.y).toBeCloseTo(-8);
  });
  test.each(['start', 'end'] as const)('extension at %s preserves manual Bézier tangents and old spans', (end) => {
    const tangents = [0, 0, 12, -20, -25, 6, 10, 20, -8, -30, 0, 0];
    const el = { ...shape, rotation: 31, curve: 'bezier' as const, tangents };
    const original = pathPointsInSlide(el);
    const extra = [300, 200, 350, 280];
    const pts = end === 'start' ? [...extra, ...original] : [...original, ...extra];
    const next = { ...el, ...pathExtensionUpdate(el, pts, end) };
    expect(next.id).toBe(el.id); expect(next.rotation).toBe(el.rotation);
    const offset = end === 'start' ? 8 : 0;
    expect(next.tangents!.slice(offset, offset + tangents.length)).toEqual(tangents);
    pathPointsInSlide(next).forEach((v, i) => expect(v).toBeCloseTo(pts[i], 8));
    const base = next.points!.slice(end === 'start' ? 4 : 0, end === 'start' ? undefined : original.length);
    const before = sampledPath(el.points!, 'bezier', false, tangents);
    const after = sampledPath(base, 'bezier', false, tangents);
    const dx = after[0] - before[0], dy = after[1] - before[1];
    after.forEach((v, i) => expect(v - (i % 2 ? dy : dx)).toBeCloseTo(before[i], 8));
  });
  test('bare Bezier freezes its original estimates before extension; smooth stays automatic', () => {
    const el = { ...shape, curve: 'bezier' as const };
    const next = pathExtensionUpdate(el, [...pathPointsInSlide(el), 250, 230], 'end');
    expect(next.tangents!.slice(0, 12)).toEqual(catmullTangents(el.points!, false));
    const smooth = { ...el, curve: 'smooth' as const };
    expect(pathExtensionUpdate(smooth, [...pathPointsInSlide(el), 250, 230], 'end').tangents).toBeUndefined();
  });
});

describe('cornerRadiusControl', () => {
  test('rect control follows top edge; its range uses the smaller dimension', () => {
    expect(cornerRadiusControl({ ...shape, shapeType: 'rect' })).toEqual({ x: 0, y: 0, dx: 1, dy: 0, maxRadius: 40 });
  });
  test('open arrow/line rounding rides the first ordered segment, not the bbox', () => {
    const c = cornerRadiusControl(shape)!;
    expect(c).toEqual({ x: 0, y: 0, dx: 1, dy: 0, maxRadius: 40, segmentLength: 100 });
    expect(pathD(shape.points!, 'linear', false, 20)).toContain('Q 100.00 0.00 100.00 20.00');
    const diagonal = { ...shape, points: [0, 0, 60, 0, 90, 40] };
    expect(cornerRadiusControl(diagonal)).toMatchObject({ x: 0, y: 0, dx: 1, dy: 0, maxRadius: 25, segmentLength: 60 });
  });
  test('short first leg, prepend, append, reversal and degenerate fallback follow order', () => {
    const control = (points: number[]) => cornerRadiusControl({ ...shape, points });
    expect(control([0,0,10,0,10,200])).toMatchObject({ x:0, y:0, dx:1, dy:0, segmentLength:10 });
    expect(control([-10,-10,0,0,10,0,10,200])).toMatchObject({ x:-10, y:-10, segmentLength:Math.sqrt(200) });
    expect(control([0,0,10,0,10,200,300,200])).toMatchObject({ x:0, y:0, dx:1, dy:0 });
    expect(control([10,200,10,0,0,0])).toMatchObject({ x:10, y:200, dx:0, dy:-1 });
    expect(control([0,0,0,0,10,0,10,200])).toMatchObject({ x:0, y:0, dx:1, dy:0 });
  });
  test('closed polygons wrap adjacency; two-point and curved paths have no radius control', () => {
    expect(cornerRadiusControl({ ...shape, closed: true })).not.toBeNull();
    expect(cornerRadiusControl({ ...shape, points: [0, 0, 100, 0] })).toBeNull();
    expect(cornerRadiusControl({ ...shape, curve: 'smooth' })).toBeNull();
    expect(cornerRadiusControl({ ...shape, points: [0, 0, 50, 0, 100, 0] })).toBeNull();
  });
});

describe('shared headed-path short terminal junction', () => {
  test.each(['start', 'end'] as const)('%s shaft enters the actual head on an original segment without a rejoin', end => {
    const points = end === 'end' ? [0, 0, 100, 80, 101, 78] : [101, 78, 100, 80, 0, 0];
    const geometry = pathArrowGeometry({ points, curve: 'linear', cornerRadius: 0, strokeWidth: 2,
      ...(end === 'end' ? { endHead: 'triangle' as const } : { startHead: 'triangle' as const }) });
    expect(geometry.shaftPoints).toEqual(points);
    expect(geometry.shaftClipPaths).toHaveLength(2);
  });
});
