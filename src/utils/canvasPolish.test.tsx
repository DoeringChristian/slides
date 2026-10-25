import { describe, expect, test } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createPresentation, createShapeElement } from './slideFactory';
import { jsonToYDoc, yDocToJson } from '../collab/ySchema';
import { assertCurrentPresentation } from './currentPresentation';
import { pathD, sampledPath } from './pathShapes';
import { renderSlideToSVG } from './svgRenderer';
import { SVGDrawingPreview } from '../components/svg/SVGDrawingPreview';
import { DEFAULT_SHAPE_PROPS } from './constants';
import type { PathCurve, ShapeElement, ShapeType } from '../types/presentation';

const modes: PathCurve[] = ['linear', 'smooth', 'bspline2', 'bspline3', 'bezier'];
const points = [0, 0, 30, 80, 75, -20, 100, 0];

describe('canvas mode roundtrip and shared export', () => {
  test.each(modes)('%s survives JSON/Yjs/migration with manual tangent data intact', (curve) => {
    const deck = createPresentation();
    const slide = deck.slides[deck.slideOrder[0]];
    const shape = createShapeElement('path', { points, curve, tangents: Array(16).fill(5) });
    slide.elements = { [shape.id]: shape }; slide.elementOrder = [shape.id];
    const doc = jsonToYDoc(deck);
    const out = assertCurrentPresentation(yDocToJson(doc));
    const saved = out.slides[slide.id].elements[shape.id] as ShapeElement;
    expect(saved.curve).toBe(curve); expect(saved.tangents).toEqual(shape.tangents);
    expect(saved.points).toEqual(points);
    expect(sampledPath(saved.points!, curve, false, saved.tangents)).toEqual(sampledPath(points, curve, false, shape.tangents));
    const svg = renderSlideToSVG(out.slides[slide.id], out.resources);
    expect(svg).toContain(`d="${pathD(points, curve, false, 0, shape.tangents)}"`);
    doc.destroy();
  });
});

describe('new shape defaults and live preview', () => {
  const types: ShapeType[] = ['rect', 'ellipse', 'triangle', 'star', 'path'];
  test.each(types)('%s defaults stroke-only and does not override explicit styles', (type) => {
    expect(createShapeElement(type)).toMatchObject({ fill: '', strokeWidth: 2 });
    expect(createShapeElement(type, { fill: '#f00', strokeWidth: 7 })).toMatchObject({ fill: '#f00', strokeWidth: 7 });
  });
  test.each(['rect', 'ellipse', 'triangle', 'star', 'line', 'arrow'] as const)('%s drawing preview uses actual shared geometry/default style', (tool) => {
    const markup = renderToStaticMarkup(<SVGDrawingPreview tool={tool} zoom={0.5} drawState={{
      startX: 20, startY: 30, currentX: 120, currentY: 90, isDrawing: true,
      snappedStartX: 20, snappedStartY: 30, snappedCurrentX: 120, snappedCurrentY: 90,
    }} />);
    expect(markup).toContain(`stroke="${DEFAULT_SHAPE_PROPS.stroke}"`);
    expect(markup).toContain('stroke-width="2"');
    expect(markup).not.toContain('rgba');
    if (tool === 'triangle') expect(markup).toContain('<path');
    if (tool === 'star') expect(markup).toContain('<polygon');
  });
});
