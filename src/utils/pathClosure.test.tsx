import { describe, expect, test } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { RenderShape } from '../components/svg/ElementRenderer';
import { interpolateElement } from './interpolation';
import { createShapeElement } from './slideFactory';
import { cubicPrefix, pathArrowGeometry, pathClosureD, pathD, supportsPathClosure, type ClosurePathShape } from './pathShapes';
import { shapeToSvgPaths } from './shapeToPath';
import { resolveShapePaint } from './shapePaint';
import { hasPatternFill } from './shapeFill';
import { pathPointToSlide } from './pathEditing';
import type { ArrowheadType, ShapeElement } from '../types/presentation';

const points = [0, 0, 100, 0, 100, 100];
const tangents = [-20, 10, 30, 0, -20, -10, 0, 30, 10, -20, -30, 10];
const shape = (options: Partial<ShapeElement> = {}) => createShapeElement('path', {
  x: 200, y: 200, width: 100, height: 100, points, curve: 'linear', closed: false,
  cornerRadius: 0, strokeWidth: 3, stroke: '#123456', fill: '#ff000080', ...options,
});
const frame = (a: ShapeElement, b: ShapeElement, t: number, forward = true) =>
  interpolateElement(a, b, t, forward) as ClosurePathShape;

describe('path closure authored-chain growth', () => {
  test.each(['linear', 'bezier'] as const)('%s keeps native spans, exact endpoints and inverse direction', curve => {
    const a = shape({ curve, tangents: curve === 'bezier' ? tangents : undefined });
    const b = { ...a, closed: true, transitions: { controlPoints: 'linear' as const } };
    const openD = pathD(points, curve, false, 0, a.tangents);
    for (const t of [0, .001, .25, .5, .999, 1]) {
      const el = frame(a, b, t), reverse = frame(b, a, 1 - t, false);
      expect(el.points).toEqual(points);
      expect(el.tangents).toEqual(a.tangents);
      const geo = pathArrowGeometry(el);
      expect(geo.d.startsWith(openD)).toBe(true);
      expect(geo.d).toBe(pathArrowGeometry(reverse).d);
      expect(geo.fillD).toBe(pathD(points, curve, true, 0, a.tangents));
      if (t === 0 || t === 1) {
        expect(el._pathClosure).toBeUndefined();
        expect(el.closed).toBe(t === 1);
        expect(geo.d).toBe(pathD(points, curve, t === 1, 0, a.tangents));
      } else {
        expect(el._pathClosure?.progress).toBeCloseTo(t);
        expect(geo.d).toBe(pathClosureD(points, curve, a.tangents, t));
        if (curve === 'linear') expect(geo.d).toBe(`${openD} L ${(100 * (1 - t)).toFixed(2)} ${(100 * (1 - t)).toFixed(2)}`);
      }
    }
  });

  test('de Casteljau prefix is exact, clamped, degenerate-safe and parametric', () => {
    const controls = [100, 100, 70, 110, -20, 10, 0, 0];
    expect(cubicPrefix(controls, .5)).toEqual([100, 100, 85, 105, 55, 82.5, 31.25, 57.5]);
    expect(cubicPrefix(controls, -1)).toEqual([100, 100, 100, 100, 100, 100, 100, 100]);
    expect(cubicPrefix(controls, 2)).toEqual(controls);
    expect(cubicPrefix(Array(8).fill(5), .3)).toEqual(Array(8).fill(5));
    expect(pathClosureD([0, 0, 0, 0], 'linear', undefined, .5)).toBe('M 0.00 0.00 L 0.00 0.00 L 0.00 0.00');
  });

  test('control const endpoints retain native geometry while independently eased fill remains visible', () => {
    const a = shape(), b = { ...a, closed: true, transitions: { controlPoints: 'const' as const, fill: 'linear' as const } };
    for (const t of [.25, .75]) {
      const el = frame(a, b, t), geo = pathArrowGeometry(el);
      expect(el.points).toEqual(points);
      expect(el.closed).toBe(t > .5);
      expect(geo.d).toBe(pathD(points, 'linear', t > .5));
      expect(resolveShapePaint(el).fillOpacity).toBe(t);
      const markup = renderToStaticMarkup(<svg><RenderShape element={el} /></svg>);
      expect(markup).toContain(`fill-opacity="${t}"`);
      expect(markup).toContain(`d="${geo.fillD}"`);
      expect(markup).toContain('rgba(255, 0, 0, 0.502)');
      const paths = shapeToSvgPaths(el);
      expect(paths[0].d).toBe(geo.fillD);
      expect(paths[0].fillOpacity).toBe(t);
      expect(paths[0].shaftClipPaths).toBeUndefined();
      expect(paths[1].d).toBe(geo.d);
    }
    const fillConst = frame(a, { ...b, transitions: { controlPoints: 'linear', fill: 'const' } }, .25);
    expect(fillConst._pathClosure).toEqual({ progress: .25, fillOpacity: 0 });
    const reverse = frame(b, a, .25, false);
    expect(reverse._pathClosure).toEqual({ progress: 1, fillOpacity: .75 });
  });

  test.each(['hachure', 'crosshatch'] as const)('%s stays patterned while the closure fill fades', fillStyle => {
    const a = shape({ fillStyle }), b = { ...a, closed: true };
    expect(hasPatternFill(a)).toBe(false);
    for (const t of [.001, .25, .999]) {
      const el = frame(a, b, t);
      expect(el.closed).toBe(false);
      expect(hasPatternFill(el)).toBe(true);
      const markup = renderToStaticMarkup(<svg><RenderShape element={el} /></svg>);
      expect(markup).toContain('<pattern');
      expect(markup).toContain('fill="url(#');
      expect(markup).toContain(`fill-opacity="${t}"`);
    }
  });

  test('independent position/size/rotation and normalized local controls are not world-pinned', () => {
    const a = shape({ rotation: 20 });
    const b = shape({ x: 400, y: 300, width: 200, height: 300, points: [0, 0, 200, 0, 200, 300], rotation: 60, closed: true,
      transitions: { position: 'const', size: 'ease', rotation: 'linear', controlPoints: 'linear' } });
    const el = frame(a, b, .25);
    expect([el.x, el.y, el.width, el.height, el.rotation]).toEqual([200, 200, 106.25, 112.5, 30]);
    expect(el.points).toEqual([0, 0, 106.25, 0, 106.25, 112.5]);
    const world = pathPointToSlide(el, el.points![4], el.points![5]);
    expect(world).not.toEqual(pathPointToSlide(a, 100, 100));
    const c = { ...b, points: [0, 0, 180, 0, 200, 300] };
    expect(frame(a, c, .25).points![2]).toBeCloseTo(106.25 * .975);
  });

  test.each(['none', 'arrow', 'triangle', 'triangle-outline', 'bar', 'dot', 'circle', 'circle-outline', 'diamond', 'diamond-outline', 'crowfoot-one', 'crowfoot-many', 'crowfoot-one-many'] as ArrowheadType[])('%s heads stay authored and do not ride closing tip', head => {
    for (const curve of ['linear', 'bezier'] as const) for (const strokeWidth of [1, 9, 20]) for (const end of ['start', 'end'] as const) {
      const a = shape({ curve, tangents: curve === 'bezier' ? tangents : undefined, strokeWidth, [end === 'start' ? 'startHead' : 'endHead']: head });
      const b = { ...a, closed: true };
      const initial = pathArrowGeometry(a), final = pathArrowGeometry(b);
      expect(initial.startGeo).toEqual(final.startGeo);
      expect(initial.endGeo).toEqual(final.endGeo);
      for (const t of [.001, .5, .999]) {
        const el = frame(a, b, t), geo = pathArrowGeometry(el);
        expect(geo.startGeo).toEqual(final.startGeo);
        expect(geo.endGeo).toEqual(final.endGeo);
        expect(geo.shaftClipPaths).toEqual(final.shaftClipPaths);
        expect(geo.fillD).toBe(pathD(points, curve, true, 0, a.tangents));
        const markup = renderToStaticMarkup(<svg><RenderShape element={el} /></svg>);
        expect(markup.indexOf(`d="${geo.fillD}"`)).toBeLessThan(markup.indexOf('clip-path=') < 0 ? Infinity : markup.indexOf('clip-path='));
      }
    }
  });

  test('native manual Bezier head clips contain long-handle bulges, including closure prefixes', () => {
    const a = shape({ curve: 'bezier', points: [0, 0, 100, 0], width: 100, height: 1,
      tangents: [0, 0, 0, -2000, 0, -2000, 0, 2000], endHead: 'triangle' });
    const b = { ...a, closed: true };
    for (const el of [a, b, frame(a, b, .25)]) {
      const geo = pathArrowGeometry(el);
      // First cubic reaches y=-1500 at its midpoint, outside vertex bounds.
      const clipTop = Number(geo.shaftClipPaths[0].split(' ')[2]);
      expect(clipTop).toBeLessThanOrEqual(-1600);
      expect(geo.originalD).toContain('C 0.00 -2000.00 100.00 -2000.00 100.00 0.00');
    }
  });

  test('long closing-only handles retain their envelope during forward growth and reverse opening', () => {
    const a = shape({ curve: 'bezier', points: [0, 0, 100, 0], width: 100, height: 1,
      tangents: [0, 2400, 0, 0, 0, 0, 0, 2400], endHead: 'triangle' });
    const b = { ...a, closed: true };
    const forward = frame(a, b, .25), reverse = frame(b, a, .75, false);
    for (const el of [forward, reverse]) {
      expect(el.closed).toBe(false);
      const geo = pathArrowGeometry(el);
      expect(geo.originalD).toBe('M 0.00 0.00 L 100.00 0.00 C 100.00 600.00 93.75 1050.00 84.38 1350.00');
      expect(geo.shaftClipPaths[0]).toContain('V 1900 ');
      expect(geo.fillD).toBe('M 0.00 0.00 L 100.00 0.00 C 100.00 2400.00 0.00 2400.00 0.00 0.00 Z');
      const markup = renderToStaticMarkup(<svg><RenderShape element={el} /></svg>);
      expect(markup.indexOf(`d="${geo.fillD}"`)).toBeLessThan(markup.indexOf('clip-path='));
      expect(markup).toContain('fill-opacity="0.25"');
    }
  });

  test('unsupported automatic and spline closure pairs keep legacy branch explicitly', () => {
    for (const a of [shape({ curve: 'smooth' }), shape({ curve: 'bezier' }), shape({ curve: 'bezier', tangents: [0] }), shape({ curve: 'bspline2' }), shape({ curve: 'bspline3' })]) {
      expect(supportsPathClosure(a)).toBe(false);
      expect(frame(a, { ...a, closed: true }, .25)._pathClosure).toBeUndefined();
    }
    const a = shape();
    expect(frame(a, { ...a, closed: true, points: [...points, 0, 100] }, .25)._pathClosure).toBeUndefined();
  });
});
