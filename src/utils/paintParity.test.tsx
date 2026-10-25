import { describe, expect, test } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { RenderPaths } from '../components/svg/RenderPaths';
import { RenderShape } from '../components/svg/ElementRenderer';
import { SVGShapeNode } from '../components/svg/SVGShapeNode';
import { renderPresenterElement } from '../components/presenter/presenterUtils';
import { createShapeElement } from './slideFactory';
import { shapeToSvgPaths } from './shapeToPath';
import { pathArrowGeometry } from './pathShapes';

test.each(['rect', 'ellipse', 'triangle', 'star'] as const)('fill-only %s Create traces at t=.2 without manufacturing input stroke', shapeType => {
  const shape = createShapeElement(shapeType, { fill: '#123456', stroke: '', strokeWidth: 0 });
  const paths = shapeToSvgPaths(shape);
  expect(paths[0].strokeColor).toBe('none');
  expect(paths[0].traceStrokeColor).toBe('#123456');
  const frame = renderToStaticMarkup(renderPresenterElement({ ...shape, _writeFx: { mode: 'create', direction: 'in', t: .2 } } as typeof shape, {}));
  expect(frame).toContain('stroke="#123456"');
  expect(frame).toContain('stroke-opacity="1"');
  expect(frame).toContain('fill-opacity="0"');
  expect(frame).toContain('stroke-width="2"');
  const length = Number(frame.match(/stroke-dasharray="([^"]+)"/)?.[1]);
  const offset = Number(frame.match(/stroke-dashoffset="([^"]+)"/)?.[1]);
  expect(offset).toBeGreaterThan(0);
  expect(offset).toBeLessThan(length);
  for (const strokeWidth of [0, 4]) {
    const input = renderToStaticMarkup(<SVGShapeNode element={{ ...shape, strokeWidth }} />).split('class="shape-input"')[1];
    expect(input).toContain('pointer-events:fill');
    expect(input).not.toContain('pointer-events:stroke');
  }
});

const rectangle = createShapeElement('rect', {
  x: 20, y: 20, width: 100, height: 80, cornerRadius: 0,
  fill: 'rgba(255, 0, 0, 0)', stroke: '#000000', strokeWidth: 2,
});

describe.each(['solid', 'hachure', 'crosshatch'] as const)('Create %s paint alpha', fillStyle => {
  test.each([.25, .5, .75, .99, 1])('zero-alpha fill preserves outline at t=%s like no fill', t => {
    const el = { ...rectangle, fillStyle };
    const render = (fill: string, stroke = el.stroke) => renderToStaticMarkup(renderPresenterElement({
      ...el, fill, stroke, _writeFx: { mode: 'create', direction: 'in', t },
    } as typeof el, {}));
    const transparent = render(el.fill), empty = render('none');
    const strokeAttrs = (s: string) => s.match(/stroke(?:-opacity|-dasharray|-dashoffset|-width)?="[^"]*"/g);
    // Hatch definitions contain their own (transparent) stroke, so compare
    // the actual animated/static shape after its paint-server definition.
    expect(strokeAttrs(transparent.split('</defs>').at(-1)!)).toEqual(strokeAttrs(empty));
    expect(transparent).toContain('stroke="#000000"');
    if (t < 1) expect(transparent).toContain('stroke-opacity="1"');
    expect(render(el.fill, 'rgba(0, 0, 255, 0)')).toContain('stroke="rgba(0, 0, 255, 0)"');
    expect(el.fill).toBe('rgba(255, 0, 0, 0)'); // rendering never erases remembered RGB
  });

  test('URL fill carries source alpha for both ordinary and headed shapes', () => {
    for (const el of [rectangle, { ...rectangle, shapeType: 'path' as const, closed: true,
      points: [95, 0, 95, 50, 80, 50, 80, 0, 100, 0], endHead: 'triangle-outline' as const }]) {
      const paths = shapeToSvgPaths({ ...el, fillStyle }, 'url(#hatch)');
      expect(paths[0].fillSourceColor).toBe(rectangle.fill);
      const markup = renderToStaticMarkup(<RenderPaths paths={paths} writeFx={{ mode: 'create', direction: 'in', t: .5 }} strokeWidth={2} />);
      expect(markup).toContain((paths[0].strokePlan?.runs.length ?? 0) > 1 ? 'opacity="1" mask=' : 'stroke-opacity="1"');
      const visible = shapeToSvgPaths({ ...el, fillStyle, fill: 'rgba(255, 0, 0, .5)' }, 'url(#hatch)');
      const filled = renderToStaticMarkup(<RenderPaths paths={visible} writeFx={{ mode: 'create', direction: 'in', t: .5 }} strokeWidth={2} />);
      expect(filled).toContain('fill-opacity="1"');
      expect(filled).toContain('stroke-opacity="0"');
    }
  });
});

test.each(['rgba(255, 0, 0, 0)', '#ff000000', '#f000', 'rgb(100% 0% 0% / 0%)', 'none', 'transparent', ''])('RenderPaths detects invisible solid paint %s', fillColor => {
  const paths = [{ d: 'M 0 0 H 100 V 100 Z', length: 340, transform: '', nonScalingStroke: false, fillColor, strokeColor: '#000' }];
  const markup = renderToStaticMarkup(<RenderPaths paths={paths} writeFx={{ mode: 'create', direction: 'in', t: .75 }} strokeWidth={2} />);
  expect(markup).toContain('stroke-opacity="1"');
});

test('static and intermediate Create keep closed fill outside shaft-only cuts without removing heads', () => {
  const el = createShapeElement('path', { x: 20, y: 20, width: 100, height: 50,
    points: [95, 0, 95, 50, 80, 50, 80, 0, 100, 0], closed: true, cornerRadius: 0,
    fill: '#ff0000', stroke: '#000000', strokeWidth: 3, endHead: 'triangle-outline' });
  const geo = pathArrowGeometry(el);
  expect(geo.shaftClipPaths.length).toBeGreaterThan(0);
  const staticMarkup = renderToStaticMarkup(<RenderShape element={el} />);
  const createMarkup = renderToStaticMarkup(renderPresenterElement({ ...el, _writeFx: { mode: 'create', direction: 'in', t: .425 } } as typeof el, {}));
  for (const markup of [staticMarkup, createMarkup]) {
    const clip = markup.indexOf('<g clip-path=');
    expect(clip).toBeGreaterThan(0);
    expect(markup.slice(0, clip)).toContain(`d="${geo.fillD}" fill="#ff0000"`);
    expect(markup.slice(clip)).toContain(`d="${geo.d}" fill="none"`);
    for (const stroke of geo.endGeo!.strokes) expect(markup).toContain(`d="${stroke.d}"`);
  }
});
