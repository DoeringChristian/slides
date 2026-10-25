import { describe, expect, test } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { RenderShape } from '../components/svg/ElementRenderer';
import { createShapeElement } from './slideFactory';
import { interpolateElement } from './interpolation';
import { pathArrowGeometry, pathClosureD, pathD, type ClosurePathShape } from './pathShapes';
import { shapeToSvgPaths } from './shapeToPath';
import type { ArrowheadType } from '../types/presentation';

const fixtures = [
  [0, 0, 100, 0, 100, 100],
  [0, 0, 100, 0, 100, 4, 0, 4],
  [0, 0, 0, 0, 100, 100],
  [0, 0, 100, 0, 0, 0],
  [0, 0, 0, 0, 0, 0],
];
const make = (points = fixtures[0]) => createShapeElement('path', {
  points, width: 100, height: 100, cornerRadius: 25, curve: 'linear', closed: false,
  fill: '#ff000080', stroke: '#123456', strokeWidth: 9,
});
const times = [0, 1e-6, .001, .25, .5, .999, 1 - 1e-6, 1];

describe('roundedPathClosure local seam', () => {
  test.each(fixtures)('native endpoints, degenerates and reverse remain exact for %j', (...points) => {
    const a = make(points), b = { ...a, closed: true };
    for (const t of times) {
      const el = interpolateElement(a, b, t, true) as ClosurePathShape;
      const reverse = interpolateElement(b, a, 1 - t, false) as ClosurePathShape;
      const geo = pathArrowGeometry(el);
      expect(el.points).toEqual(points);
      expect(geo.d).not.toMatch(/NaN|Infinity/);
      expect(geo.d).toBe(pathArrowGeometry(reverse).d);
      expect(geo.fillD).toBe(pathD(points, 'linear', true, 25));
      if (t === 0 || t === 1) {
        expect(geo.d).toBe(pathD(points, 'linear', t === 1, 25));
        expect(el._pathClosure).toBeUndefined();
        expect(el.closed).toBe(t === 1);
      }
    }
  });

  test('interior radius obeys its own easing, not the closure seam factor', () => {
    const a = make(), b = { ...a, cornerRadius: 45, closed: true,
      transitions: { cornerRadius: 'const' as const, controlPoints: 'linear' as const } };
    for (const t of [.001, .25, .75, .999]) {
      const el = interpolateElement(a, b, t, true) as ClosurePathShape;
      const radius = t < .5 ? 25 : 45;
      expect(el.cornerRadius).toBe(radius);
      expect(pathArrowGeometry(el).d).toContain(`L ${(100 - radius).toFixed(2)} 0.00 Q 100.00 0.00 100.00 ${radius.toFixed(2)}`);
    }
  });

  test('closing route advances monotonically through straight-to-Q boundary without jumps', () => {
    const points = [0, 0, 100, 0, 100, 100, 0, 100];
    let previous = [0, 100];
    let sawQ = false;
    for (let i = 1; i < 10000; i++) {
      const d = pathClosureD(points, 'linear', undefined, i / 10000, 25);
      const numbers = d.match(/-?\d+\.\d+/g)!.map(Number);
      const tip = numbers.slice(-2);
      expect(tip[0]).toBeGreaterThanOrEqual(previous[0] - .011);
      expect(tip[1]).toBeLessThanOrEqual(previous[1] + .011);
      expect(Math.hypot(tip[0] - previous[0], tip[1] - previous[1])).toBeLessThan(.06);
      if (d.slice(d.lastIndexOf('L')).includes('Q')) sawQ = true;
      previous = tip;
    }
    expect(sawQ).toBe(true);
    expect(previous[0]).toBeCloseTo(25, 1);
    expect(previous[1]).toBeCloseTo(0, 1);
  });

  test.each(['none', 'arrow', 'triangle', 'triangle-outline', 'bar', 'dot', 'circle', 'circle-outline', 'diamond', 'diamond-outline', 'crowfoot-one', 'crowfoot-many', 'crowfoot-one-many'] as ArrowheadType[])('%s uses authored heads, native untrimmed region and stroke-only cuts', head => {
    for (const points of fixtures) for (const strokeWidth of [1, 9, 20]) {
      const a = { ...make(points), startHead: head, endHead: head, strokeWidth };
      const b = { ...a, closed: true };
      const initial = pathArrowGeometry(a);
      for (const t of times) {
        const el = interpolateElement(a, b, t, true) as ClosurePathShape;
        const geo = pathArrowGeometry(el);
        expect(geo.startGeo).toEqual(initial.startGeo);
        expect(geo.endGeo).toEqual(initial.endGeo);
        expect(geo.shaftPoints).toEqual(points);
        expect(geo.fillD).toBe(pathD(points, 'linear', true, 25));
      }
    }
  });

  test('const geometry and fill easing stay independent, including hatch and head alpha', () => {
    const a = { ...make(), fillStyle: 'crosshatch' as const, endHead: 'none' as const };
    const b = { ...a, closed: true, endHead: 'triangle-outline' as const,
      transitions: { controlPoints: 'const' as const, fill: 'linear' as const, endArrow: 'linear' as const } };
    for (const t of [.25, .75]) {
      const el = interpolateElement(a, b, t, true) as ClosurePathShape;
      expect(pathArrowGeometry(el).originalD).toBe(pathD(a.points!, 'linear', t > .5, 25));
      expect(el._pathClosure?.fillOpacity).toBe(t);
      const markup = renderToStaticMarkup(<svg><RenderShape element={el} /></svg>);
      expect(markup).toContain('<pattern');
      expect(markup).toContain(`fill-opacity="${t}"`);
      expect(markup).toContain(`opacity="${t}"`);
      const paths = shapeToSvgPaths(el);
      expect(paths[0].d).toBe(pathD(a.points!, 'linear', true, 25));
      expect(paths[0].shaftClipPaths).toBeUndefined();
    }
  });

  test('genuine pose and design-box size keep independent transition groups', () => {
    const a = make();
    const b = { ...a, x: a.x + 100, width: 200, points: [0, 0, 200, 0, 200, 100], closed: true,
      transitions: { position: 'const' as const, size: 'ease' as const, controlPoints: 'linear' as const } };
    const el = interpolateElement(a, b, .25, true) as ClosurePathShape;
    expect(el.x).toBe(a.x);
    expect(el.width).toBe(106.25);
    expect(el.points).toEqual([0, 0, 106.25, 0, 106.25, 100]);
    expect(el._pathClosure?.progress).toBe(.25);
  });
});
