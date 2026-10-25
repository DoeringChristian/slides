import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createShapeElement, createPresentation } from './slideFactory';
import { parsePaintColor, withPaintAlpha, withPaintRgb } from './paintColor';
import { lerpColor, interpolateElement } from './interpolation';
import { hasPatternFill, hatchPath } from './shapeFill';
import { RenderShape } from '../components/svg/ElementRenderer';
import { SVGDrawingPreview } from '../components/svg/SVGDrawingPreview';
import { jsonToYDoc, yDocToJson } from '../collab/ySchema';
import { officePaint, officeShapeNeedsSvg, officeShapeSvg } from './officeShape';

it('central defaults are black 2px/no fill, radius8 only for rect; explicit styles win', () => {
  for (const type of ['rect', 'ellipse', 'triangle', 'star', 'path'] as const) {
    expect(createShapeElement(type)).toMatchObject({ stroke: '#000000', strokeWidth: 2, fill: '', cornerRadius: type === 'rect' ? 8 : 0 });
    expect(createShapeElement(type, { cornerRadius: 0, fill: '#f00', stroke: '#abc', strokeWidth: 7 })).toMatchObject({ cornerRadius: 0, fill: '#f00', stroke: '#abc', strokeWidth: 7 });
  }
  const markup = renderToStaticMarkup(<SVGDrawingPreview tool="rect" drawState={{ isDrawing: true, startX: 0, startY: 0, currentX: 80, currentY: 60, snappedStartX: 0, snappedStartY: 0, snappedCurrentX: 80, snappedCurrentY: 60 }} />);
  expect(markup).toContain('rx="8"'); expect(markup).toContain('stroke="#000000"'); expect(markup).toContain('fill="transparent"');
});

it('parses supported alpha syntax without dropping channels; RGB picks retain alpha', () => {
  expect(parsePaintColor('rgba(., 0, 0, .)')).toBeNull();
  expect(parsePaintColor('#1234')).toEqual({ r: 17, g: 34, b: 51, a: 68 / 255 });
  expect(parsePaintColor('#ff000080')?.a).toBeCloseTo(128 / 255);
  expect(parsePaintColor('rgb(100% 0% 0% / 25%)')?.a).toBe(.25);
  expect(parsePaintColor('rgba(20, 30, 40, 0.6)')).toEqual({ r: 20, g: 30, b: 40, a: .6 });
  expect(withPaintAlpha('#123456', .25)).toBe('rgba(18, 52, 86, 0.25)');
  expect(withPaintRgb('rgba(18, 52, 86, 0.25)', '#ffffff')).toBe('rgba(255, 255, 255, 0.25)');
  expect(withPaintRgb('transparent', '#123456')).toBe('#123456');
});

it('fill and stroke alpha interpolate separately without changing stored/global opacity', () => {
  expect(lerpColor('#ff000080', 'rgba(0, 0, 255, 0)', .5)).toBe('rgba(128, 0, 128, 0.251)');
  expect(lerpColor('transparent', '#ff0000', .5)).toBe('rgba(255, 0, 0, 0.5)');
  const a = createShapeElement('rect', { opacity: .4, fill: '#ff0000', stroke: '#0000ff' });
  const b = { ...a, fill: 'rgba(255, 0, 0, 0)', fillStyle: 'crosshatch' as const, stroke: 'rgba(0, 0, 255, 0.5)', transitions: { fill: 'linear' as const, stroke: 'linear' as const } };
  expect(interpolateElement(a, b, .5)).toMatchObject({ opacity: .4, fill: 'rgba(255, 0, 0, 0.5)', stroke: 'rgba(0, 0, 255, 0.75)', fillStyle: 'crosshatch' });
});

describe.each(['solid', 'hachure', 'crosshatch'] as const)('%s fill', fillStyle => {
  it('roundtrips through Yjs with alpha and legacy opacity; absent style stays absent', () => {
    const p = createPresentation(), sid = p.slideOrder[0];
    const el = createShapeElement('star', { id: 'paint', fillStyle, fill: 'rgba(255, 0, 0, 0.25)', stroke: '#0000ff80', opacity: .4 });
    p.slides[sid].elements = { paint: el }; p.slides[sid].elementOrder = ['paint'];
    const doc = jsonToYDoc(p); expect(yDocToJson(doc).slides[sid].elements.paint).toEqual(el); doc.destroy();
    delete el.fillStyle;
    const old = jsonToYDoc(p); expect(yDocToJson(old).slides[sid].elements.paint).not.toHaveProperty('fillStyle'); old.destroy();
  });
  it('no colour remains transparent regardless of mode', () => {
    for (const fill of ['', 'none', 'transparent']) {
      const el = createShapeElement('rect', { fillStyle, fill });
      expect(hasPatternFill(el)).toBe(false);
      expect(renderToStaticMarkup(<RenderShape element={el} />)).not.toContain('<pattern');
    }
  });
});

it('shared paint server is clipped by the actual star fill; intersections are one paint operation', () => {
  const el = createShapeElement('star', { fill: 'rgba(255, 0, 0, 0.25)', fillStyle: 'crosshatch', opacity: .5, rotation: 22 });
  const svg = officeShapeSvg(el);
  expect(svg).toContain('<pattern'); expect(svg).toContain('<polygon'); expect(svg).toContain('fill="url(#fill-');
  expect(svg).toContain('stroke="rgba(255, 0, 0, 0.25)"'); expect(svg).toContain('opacity="0.5"');
  expect(hatchPath(80, 60, 'crosshatch').match(/M /g)?.length).toBe(2 * (hatchPath(80, 60, 'hachure').match(/M /g)?.length ?? 0));
});

it('office exports keep native solid alpha but require images for hatch/composition', () => {
  const el = createShapeElement('rect', { fill: '#ff000080', stroke: 'rgba(0, 0, 255, 0.25)' });
  expect(officeShapeNeedsSvg(el)).toBe(false);
  expect(officePaint(el.stroke)).toEqual({ color: '#0000ff', alpha: .25 });
  expect(officeShapeNeedsSvg({ ...el, opacity: .5 })).toBe(true);
  expect(officeShapeNeedsSvg({ ...el, fillStyle: 'hachure' })).toBe(true);
  expect(officeShapeNeedsSvg({ ...el, shapeType: 'path', closed: true, points: [0, 0, 100, 0, 80, 80], stroke: '#000000' })).toBe(true);
});
