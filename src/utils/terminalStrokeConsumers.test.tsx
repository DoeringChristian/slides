import { describe, expect, test } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createShapeElement } from './slideFactory';
import { pathArrowGeometry, type ClosurePathShape } from './pathShapes';
import { shapeToSvgPaths } from './shapeToPath';
import { SVGShapeNode } from '../components/svg/SVGShapeNode';
import { RenderShape } from '../components/svg/ElementRenderer';
import { RenderPaths } from '../components/svg/RenderPaths';
import { SVGStrokeCoverage } from '../components/svg/SVGStrokeCoverage';
import { strokeCoverageDeviceBounds } from './canvasStrokeCoverage';
import type { ArrowheadType } from '../types/presentation';

const shape = createShapeElement('path', { x: 0, y: 0, points: [325, 370, 233.5, 146.5, 230.5, 145.5],
  cornerRadius: 8, strokeWidth: 9, endHead: 'triangle' });
const heads: ArrowheadType[] = ['none', 'arrow', 'triangle', 'triangle-outline', 'bar', 'dot', 'circle', 'circle-outline', 'diamond', 'diamond-outline', 'crowfoot-one', 'crowfoot-many', 'crowfoot-one-many'];

describe('terminal stroke production consumers', () => {
  test('native crescent has one retained original L, not the terminal rounded Q', () => {
    const geo = pathArrowGeometry(shape);
    expect(geo.strokePlan?.runs).toHaveLength(1);
    expect(geo.d).toMatch(/^M 325 370 L /);
    const numbers = geo.d.match(/-?\d+(?:\.\d+)?/g)!.map(Number);
    const [x, y] = numbers.slice(-2);
    // The historical two-decimal rounded-L endpoint is up to .005 off the authored leg.
    const original = geo.originalD.match(/-?\d+(?:\.\d+)?/g)!.map(Number);
    expect((x - 325) * (original[3] - 370) - (y - 370) * (original[2] - 325)).toBeCloseTo(0, 7);
    expect(x).toBeCloseTo(234.890193686, 7);
    expect(y).toBeCloseTo(149.890193687, 7);
    expect(geo.originalD).toContain('Q');
    expect(geo.endGeo!.fills[0]).toHaveProperty('points');
    const markup = renderToStaticMarkup(<RenderShape element={shape} />);
    expect(markup).toContain(`d="${geo.d}"`);
    expect(markup).toContain('stroke-dashoffset="0"');
  });

  test.each(heads)('%s start/end/both finite native plans through degenerate, reversed and crossing routes', head => {
    for (const points of [[0, 0, 1, 0], [0, 0, 0, 0], [100, 0, 0, 0], [0, 0, 100, 0, 0, 0], [90, 0, 90, 50, 80, 50, 80, 0, 100, 0]]) {
      for (const [startHead, endHead] of [[head, 'none'], ['none', head], [head, head]] as const) {
        const el = { ...shape, points, startHead, endHead };
        const geo = pathArrowGeometry(el);
        expect(JSON.stringify(geo)).not.toMatch(/NaN|Infinity/);
        expect(shapeToSvgPaths(el)[0].strokePlan ?? null).toEqual(geo.strokePlan);
        const markup = renderToStaticMarkup(<RenderShape element={el} />);
        if (geo.strokePlan?.runs.length) expect(markup).toContain(`d="${geo.strokePlan.runs[0].d}"`);
      }
    }
  });

  test('empty coverage never falls back to the untrimmed shaft', () => {
    const el = { ...shape, points: [0, 0, 1, 0], startHead: 'triangle' as const, cornerRadius: 0 };
    const geo = pathArrowGeometry(el);
    expect(geo.strokePlan?.runs).toEqual([]);
    expect(geo.d).toBe('');
    const paths = shapeToSvgPaths(el);
    expect(paths[0].strokePlan?.runs).toEqual([]);
    expect(paths[0].length).toBe(1);
    expect(renderToStaticMarkup(<RenderShape element={el} />)).not.toContain('<mask');
    expect(renderToStaticMarkup(<RenderPaths paths={paths} strokeWidth={9} />)).not.toContain('stroke="white"');
  });

  test('single-run fast path preserves phase and applies translucent paint only once', () => {
    const plan = { length: 100, bounds: { x: 0, y: 0, width: 100, height: 100 },
      runs: [{ d: 'M 0 0 L 100 100 L 0 100 L 100 0', offset: 17, length: 80 }] };
    const markup = renderToStaticMarkup(<SVGStrokeCoverage plan={plan} color="rgba(12,34,56,.4)" opacity={.3} width={8} dash="24 16" offset={7} />);
    expect(markup).not.toContain('<mask');
    expect(markup.match(/<path/g)).toHaveLength(1);
    expect(markup).toContain('stroke-dashoffset="24"');
    expect(markup).toContain('stroke-opacity="0.3"');
  });

  test('SVG coverage uses original dash phase, opaque union and paint alpha once', () => {
    const plan = { length: 200, bounds: { x: 0, y: 0, width: 100, height: 100 }, runs: [
      { d: 'M 0 0 L 100 100', offset: 5, length: 100 }, { d: 'M 100 0 L 0 100', offset: 125, length: 70 },
    ] };
    const markup = renderToStaticMarkup(<SVGStrokeCoverage plan={plan} color="rgba(12,34,56,.4)" opacity={.3} width={8} dash="24 16" offset={7} />);
    expect(markup.match(/stroke="white"/g)).toHaveLength(2);
    expect(markup).toContain('stroke-dashoffset="12"');
    expect(markup).toContain('stroke-dashoffset="132"');
    expect(markup.match(/rgba\(12,34,56,.4\)/g)).toHaveLength(1);
    expect(markup).toContain('opacity="0.3" mask=');
    expect(markup).not.toContain('stroke-opacity');
  });

  test.each(['solid', 'hachure', 'crosshatch'] as const)('%s Create keeps original closed fill and arc-length clock', fillStyle => {
    const el = { ...shape, closed: true, fill: 'rgba(200,50,10,.5)', fillStyle };
    const geo = pathArrowGeometry(el), paths = shapeToSvgPaths(el, fillStyle === 'solid' ? el.fill : 'url(#hatch)');
    expect(paths[0].fillD).toBe(geo.fillD);
    expect(paths[0].fillD).not.toBe(paths[0].d);
    expect(paths[0].length).toBe(geo.strokePlan!.length);
    expect(paths[0].length).toBeGreaterThan(geo.strokePlan!.runs.reduce((sum, run) => sum + run.length, 0));
    const markup = renderToStaticMarkup(<RenderPaths paths={paths} strokeWidth={9} writeFx={{ mode: 'create', direction: 'in', t: .45 }} />);
    expect(markup.indexOf(`d="${geo.fillD}"`)).toBeLessThan(markup.indexOf('<g clip-path='));
    expect(markup).toContain(`stroke-dasharray="${paths[0].length}"`);
  });

  test('closed headed input preserves the full original fill region, not retained stroke runs', () => {
    const el = { ...shape, closed: true, fill: '#f00' };
    const geo = pathArrowGeometry(el);
    const markup = renderToStaticMarkup(<SVGShapeNode element={el} />);
    const input = markup.slice(markup.indexOf('class="shape-input"'));
    expect(input).toContain(`d="${geo.fillD}" fill="transparent"`);
    expect(input).not.toContain(`d="${geo.d}" fill="transparent"`);
    expect(input).toContain(`d="${geo.d}" fill="none" stroke="transparent"`);
  });

  test('closure paint timing is separate from consumed stroke near both topology endpoints', () => {
    for (const progress of [0, 1e-9, .3, 1 - 1e-9, 1]) {
      const el: ClosurePathShape = { ...shape, _pathClosure: { progress, fillOpacity: .42 } };
      const geo = pathArrowGeometry(el), paths = shapeToSvgPaths(el);
      expect(paths[0].fillOpacity).toBe(.42);
      expect(paths[0].d).toBe(geo.fillD);
      expect(paths[1].length).toBe(geo.strokePlan!.length);
    }
  });

  test('Canvas bounds respect transform/DPI and clip off-world allocation to the viewport', () => {
    const plan = { runs: [], length: 0, bounds: { x: -10, y: -20, width: 100, height: 80 } };
    expect(strokeCoverageDeviceBounds(plan, { a: 0, b: 2, c: -2, d: 0, e: 200, f: 100 }, 500, 500)).toEqual({ x: 79, y: 79, width: 162, height: 202 });
    expect(strokeCoverageDeviceBounds({ ...plan, bounds: { x: -1e12, y: -1e12, width: 2e12, height: 2e12 } },
      { a: 2, b: 0, c: 0, d: 2, e: 0, f: 0 }, 800, 600)).toEqual({ x: 0, y: 0, width: 800, height: 600 });
    expect(strokeCoverageDeviceBounds(plan, { a: 1, b: 0, c: 0, d: 1, e: -1e9, f: 0 }, 800, 600).width).toBe(0);
  });
});
