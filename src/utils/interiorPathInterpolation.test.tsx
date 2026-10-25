import { describe, expect, test } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { RenderShape } from '../components/svg/ElementRenderer';
import type { ShapeElement } from '../types/presentation';
import { interpolateElement } from './interpolation';
import { pathGeometryUpdate, pathPointToSlide, pathPointsInSlide } from './pathEditing';
import { stationaryPathPair } from './pathInterpolation';
import { nativePathGeometry, pathArrowGeometry } from './pathShapes';
import { shapeToSvgPaths } from './shapeToPath';
import { createShapeElement } from './slideFactory';

const eased = (t: number, mode: string) => mode === 'const' ? Number(t >= .5) : mode === 'ease' ? (t < .5 ? 4 * t ** 3 : 1 - 4 * (1 - t) ** 3) : t;
const markup = (el: ShapeElement) => renderToStaticMarkup(<svg><RenderShape element={el} /></svg>);
const frame = (a: ShapeElement, b: ShapeElement, t: number, forward = true) => interpolateElement(a, b, t, forward) as ShapeElement;
function fixtures(curve: 'linear' | 'bezier', rotation = 0) {
  const a = createShapeElement('path', { id: 'interior', x: 200, y: 250, width: 360, height: 150,
    points: [0, 0, 180, 0, 260, 150, 360, 80], curve, rotation, cornerRadius: 0,
    tangents: curve === 'bezier' ? [0, 0, 50, -30, -50, -30, 35, 25, -30, -10, 30, 0, -40, 20, 0, 0] : undefined,
    startHead: 'dot', endHead: 'triangle', stroke: '#a02555', strokeStyle: 'dashed', fill: '#12345680',
  });
  const points = [0, 0, 110, -90, ...a.points!.slice(2)];
  const tangents = a.tangents ? [...a.tangents.slice(0, 4), -30, -10, 30, 10, ...a.tangents.slice(4)] : undefined;
  const b: ShapeElement = { ...a, ...pathGeometryUpdate(a, points, tangents), transitions: {
    position: 'const' as const, size: 'ease' as const, controlPoints: 'linear' as const,
  } };
  const c = { ...b, ...pathGeometryUpdate(b, [...b.points!.slice(0, 2), ...b.points!.slice(4)], a.tangents) };
  return { a, b, c };
}
const nearArray = (a: number[], b: number[], digits = 7) => {
  expect(a).toHaveLength(b.length);
  a.forEach((v, i) => expect(v).toBeCloseTo(b[i], digits));
};

describe('native interior insertion/deletion correspondence', () => {
  test.each(['linear', 'bezier'] as const)('%s: exact endpoints, fixed survivors, reverse and out-of-order shared renderer frames', curve => {
    for (const rotation of [0, 37]) {
      const { a, b, c } = fixtures(curve, rotation), original = pathPointsInSlide(a);
      const before = JSON.stringify([a, b, c]);
      for (const [source, target] of [[a, b], [b, c]]) {
        expect(stationaryPathPair(source, target)?.interior).toBe(true);
        for (const t of [1, .000001, .75, 0, .999999, .5, .25, .000001]) {
          const el = frame(source, target, t), world = pathPointsInSlide(el);
          const retained = world.length === original.length ? world : [...world.slice(0, 2), ...world.slice(4)];
          nearArray(retained, original);
          expect(world.every(Number.isFinite)).toBe(true);
          expect(el.tangents?.every(Number.isFinite) ?? true).toBe(true);
          const reverse = frame(target, source, 1 - t, false);
          nearArray(pathPointsInSlide(reverse), world);
          if (el.tangents) nearArray(reverse.tangents!, el.tangents);
          const svg = markup(el), geometry = pathArrowGeometry(el);
          expect(svg).not.toMatch(/NaN|Infinity/);
          expect(svg).toContain('stroke-dasharray=');
          expect(['#12345680', 'rgba(18, 52, 86, 0.502)']).toContain(el.fill);
          expect(svg).toContain('clip-path=');
          const unheaded = { ...el, startHead: 'none' as const, endHead: 'none' as const };
          expect(markup(unheaded)).toContain(`d="${pathArrowGeometry(unheaded).d}"`);
          expect(shapeToSvgPaths(el)[0].d).toBe(geometry.d);
          expect(geometry.startGeo).toBeDefined(); expect(geometry.endGeo).toBeDefined();
          expect(el.startHead).toBe('dot'); expect(el.endHead).toBe('triangle');
          if (t === 0 || t === 1) {
            const endpoint = t === 0 ? source : target;
            expect(el.points).toEqual(endpoint.points);
            expect(el.tangents).toEqual(endpoint.tangents);
            expect(markup(el)).toBe(markup(endpoint));
          }
        }
      }
      expect(JSON.stringify([a, b, c])).toBe(before);
    }
  });

  test('linear deterministic bracket midpoint stays on destination edge; drag does not masquerade as stored lineage', () => {
    const { a, b, c } = fixtures('linear');
    const pair = stationaryPathPair(a, b)!;
    // This is the declared deterministic parameter .5, NOT projection of the
    // dragged x=110 or recovery of an original native Alt-click parameter.
    nearArray(pair.a.slice(2, 4), [290, 250]);
    const deletion = stationaryPathPair(b, c)!;
    nearArray(deletion.b.slice(2, 4), [290, 250]);
    nearArray(pathPointsInSlide(frame(b, c, .5)).slice(2, 4), [300, 205]);
  });

  test('manual cubic source is exactly subdivided; endpoint limits preserve every rendered native span', () => {
    const { a, b } = fixtures('bezier');
    const original = nativePathGeometry(a)!;
    // Independently evaluate the polynomial, not the subdivision helper.
    const polynomial = (controls: number[][], t: number) => [0, 1].map(axis =>
      (1 - t) ** 3 * controls[0][axis] + 3 * (1 - t) ** 2 * t * controls[1][axis]
      + 3 * (1 - t) * t ** 2 * controls[2][axis] + t ** 3 * controls[3][axis]);
    const nearSource = frame(a, b, 1e-10), spans = nativePathGeometry(nearSource)!.spans;
    for (let segment = 0; segment < original.spans.length; segment++) for (const t of [0, .1, .25, .5, .7, 1]) {
      const index = segment === 0 ? (t < .5 ? 0 : 1) : segment + 1;
      const parameter = segment === 0 ? (t < .5 ? t * 2 : (t - .5) * 2) : t;
      const actual = polynomial(spans[index].controls, parameter);
      const expected = polynomial(original.spans[segment].controls, t);
      const p = pathPointToSlide(nearSource, actual[0], actual[1]);
      const q = pathPointToSlide(a, expected[0], expected[1]);
      nearArray([p.x, p.y], [q.x, q.y], 5);
    }
    const nearTarget = frame(a, b, 1 - 1e-10);
    nearArray(pathPointsInSlide(nearTarget), pathPointsInSlide(b), 5);
    nearArray(nearTarget.tangents!, b.tangents!, 5);
    expect(markup(nearSource)).toContain(' C ');
  });

  test.each(['linear', 'ease', 'const'] as const)('controlPoints %s owns geometry; paint and bounds retain independent easing', easing => {
    const { a, b } = fixtures('linear');
    b.opacity = .2; b.strokeWidth = 9;
    b.transitions = { position: 'const', size: 'ease', controlPoints: easing, opacity: 'linear', strokeWidth: 'linear' };
    for (const t of [.25, .75]) {
      const el = frame(a, b, t), g = eased(t, easing), world = pathPointsInSlide(el);
      expect(el.x).toBe(t < .5 ? a.x : b.x);
      expect(el.width).toBeCloseTo(a.width + (b.width - a.width) * eased(t, 'ease'));
      expect(el.opacity).toBeCloseTo(a.opacity + (.2 - a.opacity) * t);
      expect(el.strokeWidth).toBeCloseTo(a.strokeWidth + (9 - a.strokeWidth) * t);
      if (g === 0) nearArray(world, pathPointsInSlide(a));
      else nearArray(world.slice(2, 4), [290 + 20 * g, 250 - 90 * g]);
    }
  });

  test('multiple interior insertions refine only their own brackets', () => {
    const { a } = fixtures('linear');
    const b = { ...a, ...pathGeometryUpdate(a, [0, 0, 40, -50, 130, -30, 180, 0, 260, 150, 300, 200, 360, 80]) };
    const pair = stationaryPathPair(a, b)!;
    nearArray(pair.a, [200, 250, 260, 250, 320, 250, 380, 250, 460, 400, 510, 365, 560, 330]);
    nearArray(stationaryPathPair(b, a)!.b, pair.a);
  });

  test('rounded, basis-changing, ambiguous or independently moved survivors are not claimed by this adapter', () => {
    const { a, b } = fixtures('linear');
    for (const curve of ['bspline2', 'bspline3'] as const) expect(stationaryPathPair({ ...a, curve }, { ...b, curve })).toBeNull();
    expect(stationaryPathPair({ ...a, cornerRadius: 20 }, { ...b, cornerRadius: 20 })).toBeNull();
    expect(stationaryPathPair(a, { ...b, x: b.x + 50 })).toBeNull();
    expect(stationaryPathPair(a, { ...b, rotation: 30 })).toBeNull();
    expect(stationaryPathPair({ ...a, closed: true }, { ...b, closed: true })).toBeNull();
    const duplicate = { ...a, ...pathGeometryUpdate(a, [0, 0, 90, -50, 180, 0, 180, 0, 260, 150, 360, 80]) };
    expect(stationaryPathPair(a, duplicate)).toBeNull();
    // Rejection must not change the ordinary independently eased pose path.
    const moved = { ...b, x: b.x + 50, transitions: { position: 'linear' as const } };
    expect(frame(a, moved, .25).x).toBeCloseTo(a.x + (moved.x - a.x) * .25);
  });
});
