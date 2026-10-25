import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { CURATED_ICONS } from './curatedIcons';
import { createShapeElement, createTextElement } from './slideFactory';
import { resolveShapeGeometry, vectorContourD, interpolateVectorGeometry } from './vectorGeometry';
import { shapeToPathD, shapeToSvgPaths } from './shapeToPath';
import { RenderShape } from '../components/svg/ElementRenderer';
import { RenderPaths } from '../components/svg/RenderPaths';
import { interpolateElement, lerpColor } from './interpolation';
import { officeShapeNeedsSvg, officeShapeSvg } from './officeShape';
import { transitionPropertiesDiffer } from './transitionProperties';
import { drawShapeElement } from './exportPdf';
import type { ShapeElement, SlideElement, VectorGeometry } from '../types/presentation';
vi.mock('./keyboard', () => ({ isShiftHeld: () => false, isCtrlHeld: () => false }));
const icon = (name: string) => createShapeElement('vector', { x: 10, y: 20, width: 240, height: 120, geometry: structuredClone(CURATED_ICONS.find(i => i.id === name)!.geometry) });

it('curates exactly 24 persisted native definitions, with provenance and independent stroke starts', () => {
  expect(CURATED_ICONS).toHaveLength(24);
  for (const definition of CURATED_ICONS) {
    expect(definition.geometry.provenance).toMatchObject({ library: 'Lucide', icon: definition.id, license: 'ISC' });
    const shape = icon(definition.id), geometry = resolveShapeGeometry(shape);
    expect(shapeToPathD(shape).match(/M /g)).toHaveLength(definition.geometry.contours.length);
    expect(geometry.strokes).toHaveLength(definition.geometry.strokes.length);
    expect(officeShapeNeedsSvg(shape)).toBe(true);
    expect(officeShapeSvg(shape)).toContain(geometry.strokes.join(' '));
  }
  expect(resolveShapeGeometry(icon('plus')).fills).toEqual([]);
  expect(resolveShapeGeometry(icon('lightbulb')).fills).toEqual([]);
  expect(resolveShapeGeometry(icon('heart')).fills).toHaveLength(1);
});

it('preserves exact axis-aligned arcs under non-square scaling; degeneracies are deterministic', () => {
  const contour = { id: 'a', start: [0, 0] as [number, number], closed: false, segments: [
    { kind: 'arc' as const, radii: [.25, .5] as [number, number], largeArc: true, sweep: false, to: [1, 1] as [number, number] },
  ] };
  const shape = icon('search');
  expect(vectorContourD(contour, shape)).toBe('M 10 20 A 60 60 0 1 0 250 140');
  expect(vectorContourD({ ...contour, segments: [{ ...contour.segments[0], radii: [0, 1] }] }, shape)).toBe('M 10 20 L 250 140');
  expect(vectorContourD({ ...contour, segments: [{ ...contour.segments[0], to: [0, 0] }] }, shape)).toBe('M 10 20');
});

it('keeps holes in one evenodd paint, with separate strokes and one element alpha', () => {
  const shape = { ...icon('settings'), fill: '#ff000080', opacity: .4 };
  const geometry = resolveShapeGeometry(shape);
  expect(geometry.fills[0].d.match(/M /g)).toHaveLength(2);
  const markup = renderToStaticMarkup(<RenderShape element={shape} />);
  expect(markup.match(/opacity="0.4"/g)).toHaveLength(1);
  expect(markup).toContain('fill-rule="evenodd"');
  expect(markup).toContain(`d="${geometry.strokes.join(' ')}" fill="none"`);
  const paths = shapeToSvgPaths(shape);
  expect(paths[0].fillRule).toBe('evenodd');
  expect(paths[1].fillColor).toBe('none');
  expect(renderToStaticMarkup(<RenderPaths paths={paths} strokeWidth={2} />)).toContain('fill-rule="evenodd"');
});

it('Canvas/PDF consumes the same regions, rule and joined-independent-stroke operation', () => {
  const shape = { ...icon('settings'), fill: '#f00' };
  const geometry = resolveShapeGeometry(shape);
  class TestPath { d: string; constructor(d: string) { this.d = d; } }
  vi.stubGlobal('Path2D', TestPath);
  const ctx = { globalAlpha: 1, save: vi.fn(), restore: vi.fn(), fill: vi.fn(), stroke: vi.fn(), setLineDash: vi.fn() };
  drawShapeElement(ctx as unknown as CanvasRenderingContext2D, shape);
  expect(ctx.fill).toHaveBeenCalledWith(new TestPath(geometry.fills[0].d), 'evenodd');
  expect(ctx.stroke).toHaveBeenCalledWith(new TestPath(geometry.strokes.join(' ')));
  vi.unstubAllGlobals();
});

describe('vector animation', () => {
  it('interpolates coordinates only within matching contours, independently of the size/position groups', () => {
    const a = icon('plus'), b = structuredClone(a);
    b.x = 300; b.width = 480;
    b.geometry!.contours[0].start[0] += .1;
    b.transitions = { position: 'const', size: 'linear', controlPoints: 'ease' };
    const mid = interpolateElement(a, b, .25) as ShapeElement;
    expect(mid.x).toBe(a.x); expect(mid.width).toBe(300);
    expect(mid.geometry!.contours[0].start[0]).toBeCloseTo(a.geometry!.contours[0].start[0] + .00625);
    expect(mid.geometry!.contours[1]).toEqual(a.geometry!.contours[1]);
    expect(interpolateVectorGeometry(a.geometry!, b.geometry!, 0)).toBe(a.geometry);
    expect(interpolateVectorGeometry(a.geometry!, b.geometry!, 1)).toBe(b.geometry);
    expect(transitionPropertiesDiffer(a, b, 'controlPoints')).toBe(true);
    expect((interpolateElement(b, a, .75, false) as ShapeElement).geometry).toEqual(mid.geometry);
    b.transitions.controlPoints = 'const';
    expect((interpolateElement(a, b, .25) as ShapeElement).geometry).toEqual(a.geometry);
  });
  it.each(['vector', 'rect', 'text'])('crossfades unsupported %s topology without legacy outline bridging', type => {
    const a = icon('settings');
    const b = type === 'vector' ? icon('plus') : type === 'rect' ? createShapeElement('rect') : createTextElement();
    b.transitions = { morph: 'linear' };
    const mid = interpolateElement(a, b, .5) as SlideElement & { _vectorCrossfade: { from: SlideElement; to: SlideElement } };
    expect(mid).not.toHaveProperty('_morphFx');
    expect(mid._vectorCrossfade.from.opacity).toBe(.5);
    expect(mid._vectorCrossfade.to.opacity).toBe(.5);
    expect(mid._vectorCrossfade.from).not.toHaveProperty('points');
  });
});

export const ringGeometry: VectorGeometry = {
  kind: 'vector', version: 1,
  contours: [0, 1].map((n) => ({ id: String(n), start: [n * .25, n * .25], closed: true,
    segments: [{ kind: 'line', to: [1 - n * .25, n * .25] }, { kind: 'line', to: [1 - n * .25, 1 - n * .25] }, { kind: 'line', to: [n * .25, 1 - n * .25] }] })),
  fills: [{ contourIds: ['0', '1'], rule: 'evenodd' }], strokes: ['0', '1'],
};
it('schema supports future rings without implementing a parametric catalogue', () => {
  const shape = createShapeElement('vector', { geometry: ringGeometry });
  expect(resolveShapeGeometry(shape).fills[0].d.match(/M /g)).toHaveLength(2);
});

it.each([0, .25, .75, 1])('unsupported vector topology keeps paint easing independent at t=%s', t => {
  const a = { ...icon('plus'), fill: '#ff0000', stroke: '#000000', strokeWidth: 2 };
  const b: ShapeElement = { ...icon('settings'), fill: '#0000ff', stroke: '#ffffff', strokeWidth: 10,
    transitions: { controlPoints: 'const', fill: 'linear', stroke: 'const', strokeWidth: 'linear' } };
  const frame = interpolateElement(a, b, t) as ShapeElement;
  expect(frame.fill).toBe(lerpColor(a.fill, b.fill, t));
  expect(frame.stroke).toBe(t < .5 ? a.stroke : b.stroke);
  expect(frame.strokeWidth).toBe(2 + t * 8);
  expect(frame.geometry).toEqual(t < .5 ? a.geometry : b.geometry);
  const reverse = interpolateElement(b, a, 1 - t, false) as ShapeElement;
  expect(reverse.fill).toBe(frame.fill); expect(reverse.strokeWidth).toBe(frame.strokeWidth);
});

it('crossfade layers share independent paint even while both contours are visible', () => {
  const a = { ...icon('plus'), fill: '#ff0000', stroke: '#000000', strokeWidth: 2 };
  const b: ShapeElement = { ...icon('settings'), fill: '#0000ff', stroke: '#ffffff', strokeWidth: 10,
    transitions: { controlPoints: 'linear', fill: 'const', stroke: 'linear', strokeWidth: 'ease' } };
  const frame = interpolateElement(a, b, .25) as ShapeElement & { _vectorCrossfade: { from: ShapeElement; to: ShapeElement } };
  for (const layer of [frame._vectorCrossfade.from, frame._vectorCrossfade.to]) {
    expect(layer.fill).toBe(a.fill); expect(layer.stroke).toBe(lerpColor(a.stroke, b.stroke, .25));
    expect(layer.strokeWidth).toBe(2.5);
    expect(renderToStaticMarkup(<RenderShape element={layer} />)).toContain('stroke-width="2.5"');
  }
});

it.each([false, true])('vector/path fallback scales actual vertices and tangent deltas in both directions reverse=%s', reverse => {
  const vector = { ...icon('plus'), width: 100, height: 50, fill: '#ff0000', strokeWidth: 2 };
  const path = createShapeElement('path', { x: 20, y: 40, width: 200, height: 200, curve: 'bezier',
    points: [-20, 0, 200, 180], tangents: [0, 0, 40, 60, -40, -60, 0, 0], fill: '#0000ff', strokeWidth: 10,
    transitions: { size: 'const', controlPoints: 'linear', fill: 'linear', strokeWidth: 'const' } });
  const t = reverse ? .75 : .25;
  const frame = interpolateElement(reverse ? path : vector, reverse ? vector : path, t, !reverse) as SlideElement & {
    _vectorCrossfade: { from: ShapeElement; to: ShapeElement };
  };
  const layer = reverse ? frame._vectorCrossfade.from : frame._vectorCrossfade.to;
  expect(layer).toMatchObject({ width: 100, height: 50, points: [-10, 0, 100, 45], tangents: [0, 0, 20, 15, -20, -15, 0, 0], strokeWidth: 2 });
  expect(layer.fill).toBe(lerpColor(vector.fill, path.fill, .25));
  const markup = renderToStaticMarkup(<RenderShape element={layer} />);
  expect(markup).toContain('M -10.00 0.00 C 10.00 15.00 80.00 30.00 100.00 45.00');
  for (const endpoint of [0, 1]) {
    const el = interpolateElement(vector, path, endpoint) as ShapeElement;
    if (endpoint === 1) { expect(el.points).toEqual(path.points); expect(el.tangents).toEqual(path.tangents); }
    else expect(el.geometry).toEqual(vector.geometry);
  }
  // A geometry cut at the target still respects an independently eased box.
  const cut = interpolateElement(vector, { ...path, transitions: { controlPoints: 'const', size: 'ease' } }, .6) as ShapeElement;
  expect(cut.points![2]).toBeCloseTo(cut.width);
  expect(cut.tangents![3]).toBeCloseTo(60 * cut.height / path.height);
});

it.each(['#ff0000', '#ff000000'])('vector Create coordinates stroke/fill roles on one clock for fill=%s', fill => {
  const shape = { ...icon('settings'), fill };
  const paths = shapeToSvgPaths(shape);
  const frames = (t: number) => renderToStaticMarkup(<RenderPaths paths={paths} strokeWidth={2} writeFx={{ mode: 'create', t, direction: 'in' }} />)
    .match(/<path [^>]+>/g)!;
  const attr = (path: string, name: string) => Number(path.match(new RegExp(`${name}="([^"]+)"`))![1]);
  for (const t of [.1, .4, .69]) {
    const [paint, stroke] = frames(t);
    expect(attr(paint, 'fill-opacity')).toBe(0);
    expect(attr(stroke, 'stroke-opacity')).toBe(1);
    expect(attr(stroke, 'stroke-dashoffset')).toBeCloseTo(paths[1].length * (1 - t / .7));
    expect(stroke).toContain(`d="${resolveShapeGeometry(shape).strokes.join(' ')}"`);
  }
  const [paint, stroke] = frames(.85);
  expect(attr(paint, 'fill-opacity')).toBeCloseTo(.5);
  expect(attr(stroke, 'stroke-dashoffset')).toBe(0);
  expect(attr(stroke, 'stroke-opacity')).toBe(1);
});
