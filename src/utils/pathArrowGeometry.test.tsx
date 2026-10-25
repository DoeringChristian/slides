import { describe, expect, test } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { pathArrowGeometry, arrowheadGeometry, pathEndpointDirection, sampledPath } from './pathShapes';
import { renderSlideToSVG } from './svgRenderer';
import { createPresentation, createShapeElement } from './slideFactory';
import { RenderShape } from '../components/svg/ElementRenderer';
import { renderPresenterElement } from '../components/presenter/presenterUtils';
import { SVGPolyDraftPreview } from '../components/svg/SVGDrawingPreview';
import { shapeToSvgPaths } from './shapeToPath';
import type { ArrowheadType, PathCurve } from '../types/presentation';

const screenshot = [325, 370, 233.5, 146.5, 230.5, 145.5];
const shape = (points = screenshot) => createShapeElement('path', { x: 0, y: 0, points, strokeWidth: 9, endHead: 'triangle', cornerRadius: 0 });
function onSegment(x: number, y: number, points: number[]) {
  for (let i = 2; i < points.length; i += 2) {
    const dx = points[i] - points[i - 2], dy = points[i + 1] - points[i - 1];
    const cross = dx * (y - points[i - 1]) - dy * (x - points[i - 2]);
    const dot = (x - points[i - 2]) * dx + (y - points[i - 1]) * dy;
    if (Math.abs(cross) < 1e-6 && dot >= -1e-6 && dot <= dx * dx + dy * dy + 1e-6) return true;
  }
  return false;
}
const reverse = (p: number[]) => Array.from({ length: p.length / 2 }, (_, i) => p.slice(-2 * (i + 1), p.length - 2 * i)).flat();
const subdivide = (p: number[], count: number) => {
  const result = p.slice(0, 2);
  for (let i = 2; i < p.length; i += 2) for (let k = 1; k <= count; k++) result.push(p[i - 2] + (p[i] - p[i - 2]) * k / count, p[i - 1] + (p[i + 1] - p[i - 1]) * k / count);
  return result;
};

describe('pathArrowGeometry original-shaft junction', () => {
  test.each(['start', 'end'] as const)('screenshot %s: no invented vertex, side entry, unchanged glyph', end => {
    const points = end === 'end' ? screenshot : reverse(screenshot);
    const el = { ...shape(points), startHead: end === 'start' ? 'triangle' as const : undefined, endHead: end === 'end' ? 'triangle' as const : undefined };
    const geo = pathArrowGeometry(el);
    expect(geo.shaftPoints).toEqual(points);
    for (let i = 0; i < geo.shaftPoints.length; i += 2) expect(onSegment(geo.shaftPoints[i], geo.shaftPoints[i + 1], points)).toBe(true);
    const head = end === 'end' ? geo.endGeo! : geo.startGeo!;
    expect(head).toEqual(arrowheadGeometry('triangle', 230.5, 145.5, -3, -1, 10, 9));
    expect(geo.shaftClipPaths).toHaveLength(2);
    expect(geo.shaftClipPaths[0]).toContain('230.50 145.50');
  });

  test.each([1, 3, 9, 20])('stroke width %s: head size independent of dense morph tessellation', strokeWidth => {
    for (const points of [screenshot, [0, 0, 100, 0], [0, 0, 99, 90, 100, 90]]) {
      const sparse = pathArrowGeometry({ ...shape(points), strokeWidth });
      const dense = pathArrowGeometry({ ...shape(subdivide(points, 200)), strokeWidth });
      expect(dense.endGeo!.shaftInset).toBe(sparse.endGeo!.shaftInset);
      const actual = dense.shaftPoints.slice(-2), expected = sparse.shaftPoints.slice(-2);
      actual.forEach((v, i) => expect(v).toBeCloseTo(expected[i], 6));
      expect(dense.endGeo!.fills).toEqual(sparse.endGeo!.fills);
    }
  });

  test.each(['linear', 'smooth', 'bezier', 'bspline2', 'bspline3'] as PathCurve[])('%s cuts only original sampled segments; true tangent unchanged', curve => {
    const el = { ...shape([0, 0, 60, 80, 120, 0]), curve, tangents: [0, 0, 20, 40, -20, 0, 20, 0, -20, 40, 0, 0] };
    const samples = sampledPath(el.points!, curve, false, el.tangents);
    const geo = pathArrowGeometry(el);
    for (let i = 0; i < geo.shaftPoints.length; i += 2) expect(onSegment(geo.shaftPoints[i], geo.shaftPoints[i + 1], samples)).toBe(true);
    const dir = pathEndpointDirection(el.points!, curve, false, el.tangents, 'end');
    expect(geo.endGeo).toEqual(arrowheadGeometry('triangle', 120, 0, dir.dx, dir.dy, 10, 9));
  });

  const closedHeads: ArrowheadType[] = ['triangle', 'triangle-outline', 'diamond', 'diamond-outline', 'dot', 'circle', 'circle-outline'];
  test.each(closedHeads)('%s preserves straight base, clips hole/cap, and handles overlapping tiny heads', endHead => {
    const el = { ...shape([0, 0, 100, 0]), endHead };
    const geo = pathArrowGeometry(el);
    expect(geo.shaftPoints).toEqual(el.points);
    expect(geo.shaftClipPaths).toHaveLength(2);
    expect(geo.endGeo!.boundary).toBeDefined();
    const start = pathArrowGeometry({ ...el, points: reverse(el.points!), endHead: undefined, startHead: endHead });
    expect(start.startGeo).toEqual(geo.endGeo);
    start.shaftPoints.forEach((v, i) => expect(v).toBeCloseTo(reverse(geo.shaftPoints)[i], 7));
    const tiny = pathArrowGeometry({ ...el, points: [0, 0, 1, 0], startHead: endHead });
    expect(tiny.shaftPoints).toEqual([0, 0, 1, 0]);
    expect(tiny.shaftClipPaths).toHaveLength(4);
    expect(JSON.stringify(tiny)).not.toMatch(/NaN|Infinity/);
    expect(pathArrowGeometry({ ...el, points: [0, 0, 0, 0] }).shaftPoints).toEqual([0, 0, 0, 0]);
  });

  test('open heads leave shaft and caps alone; earlier self-crossing is not used as entry', () => {
    const open = pathArrowGeometry({ ...shape(), endHead: 'arrow' });
    expect(open.shaftPoints).toEqual(screenshot); expect(open.shaftClipPaths).toEqual([]);
    const points = [90, 0, 90, 50, 80, 50, 80, 0, 100, 0];
    const geo = pathArrowGeometry({ ...shape(points), strokeWidth: 3 });
    expect(geo.shaftPoints.slice(0, 8)).toEqual(points.slice(0, 8));
    expect(geo.shaftPoints.slice(-2)).toEqual([100, 0]);
    expect(geo.shaftClipPaths).toHaveLength(2);
  });
});

describe('shared headed-path rendering', () => {
  test('independently serialized SVG export shapes have distinct clip IDs', () => {
    const deck = createPresentation(), slide = deck.slides[deck.slideOrder[0]];
    const first = { ...shape(), id: 'first' }, second = { ...shape(), id: 'second', x: 300 };
    slide.elements = { first, second }; slide.elementOrder = ['first', 'second'];
    const svg = renderSlideToSVG(slide, {});
    const ids = Array.from(svg.matchAll(/<clipPath[^>]*id="([^"]+)"/g), m => m[1]);
    expect(ids).toHaveLength(4); expect(new Set(ids).size).toBe(4);
  });
  test('static, presenter, draft preview and Create use shared shaft rather than a tangent rejoin', () => {
    const el = shape();
    const geo = pathArrowGeometry(el);
    expect(renderToStaticMarkup(<svg><RenderShape element={el} /></svg>)).toContain(`d="${geo.d}"`);
    expect(renderToStaticMarkup(<svg>{renderPresenterElement(el, {})}</svg>)).toContain(`d="${geo.d}"`);
    const paths = shapeToSvgPaths(el);
    expect(paths[0].d).toBe(geo.d);
    expect(paths[0].shaftClipPaths).toEqual(geo.shaftClipPaths);
    expect(paths[1].shaftClipPaths).toBeUndefined();
    const preview = renderToStaticMarkup(<SVGPolyDraftPreview polyDraft={{ vertices: screenshot.slice(0, 4), previewX: 230.5, previewY: 145.5, curve: 'linear', endHead: 'triangle' }} zoom={1} />);
    expect(preview).toContain('clipPath');
  });

  test.each([0, 0.15, 0.35, 1])('tipDraw at %s keeps endpoint on original prefix and completes with static geometry', t => {
    const el = shape([0, 0, 100, 0, 100, 100]);
    const markup = renderToStaticMarkup(renderPresenterElement({ ...el, _writeFx: { mode: 'create', t, tipDraw: true } } as typeof el, {}));
    if (t === 0) expect(markup).not.toContain('<polygon');
    else if (t < 0.35) expect(markup).toContain(`${200 * t / 0.35},0`);
    else expect(markup).toContain(`d="${pathArrowGeometry(el).d}"`);
  });
});
