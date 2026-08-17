import { describe, expect, test } from 'vitest';
import type { Slide, SlideElement, ShapeElement, TextElement, ImageElement, Resource } from '../types/presentation';
import { SLIDE_WIDTH, SLIDE_HEIGHT, TEXT_BOX_PADDING } from './constants';
import { pathD, arrowheadPoints, insetEndpoints, strokeDashFor } from './pathShapes';
import { renderSlideToSVG } from './svgRenderer';

// =============================================================================
// Regression net for the export SVG renderer.
//
// These tests were first run against the OLD hand-rolled string-template
// implementation of svgRenderer.ts and then kept green across the delegation
// refactor (shapes now render through the shared React <RenderShape> via
// renderToStaticMarkup). They assert on PARSED attributes, never raw strings,
// so attribute order / whitespace / React-vs-template formatting differences
// don't matter — only geometry and paint do.
// =============================================================================

// ── tiny XML attribute parser (no DOM needed; node test environment) ─────────

interface Tag {
  name: string;
  attrs: Record<string, string>;
}

/** All opening tags of `name` in document order, with parsed attributes. */
function tagsOf(svg: string, name: string): Tag[] {
  const out: Tag[] = [];
  const tagRe = new RegExp(`<${name}\\b([^>]*?)/?>`, 'g');
  let m: RegExpExecArray | null;
  while ((m = tagRe.exec(svg)) !== null) {
    const attrs: Record<string, string> = {};
    const attrRe = /([\w:-]+)="([^"]*)"/g;
    let a: RegExpExecArray | null;
    while ((a = attrRe.exec(m[1])) !== null) attrs[a[1]] = a[2];
    out.push({ name, attrs });
  }
  return out;
}

function firstTag(svg: string, name: string): Tag {
  const all = tagsOf(svg, name);
  expect(all.length, `expected at least one <${name}>`).toBeGreaterThan(0);
  return all[0];
}

/** Parse every number out of a string (d attribute, points list, transform). */
function nums(s: string | undefined): number[] {
  if (!s) return [];
  return (s.match(/-?\d+(?:\.\d+)?(?:e-?\d+)?/gi) ?? []).map(Number);
}

function expectNumsClose(actual: number[], expected: number[], precision = 4) {
  expect(actual.length).toBe(expected.length);
  for (let i = 0; i < expected.length; i++) {
    expect(actual[i], `number[${i}]`).toBeCloseTo(expected[i], precision);
  }
}

/** Command letters of a path d string, e.g. "MLLZ". */
function dCommands(d: string | undefined): string {
  return (d ?? '').replace(/[^A-Za-z]/g, '').toUpperCase();
}

// ── fixture builders ─────────────────────────────────────────────────────────

const baseEl = {
  rotation: 0,
  opacity: 1,
  locked: false,
  visible: true,
};

function shape(partial: Partial<ShapeElement> & Pick<ShapeElement, 'id' | 'shapeType' | 'x' | 'y' | 'width' | 'height'>): ShapeElement {
  return {
    ...baseEl,
    type: 'shape',
    fill: '#ff0000',
    stroke: '#00aa00',
    strokeWidth: 4,
    cornerRadius: 0,
    ...partial,
  } as ShapeElement;
}

function slideWith(elements: SlideElement[], background: Slide['background'] = { type: 'solid', color: '#ffffff' }): Slide {
  const map: Record<string, SlideElement> = {};
  for (const el of elements) map[el.id] = el;
  return {
    id: 'slide-1',
    elements: map,
    elementOrder: elements.map(e => e.id),
    background,
    transition: { duration: 0.5 },
    notes: '',
  };
}

const noResources: Record<string, Resource> = {};

function renderOne(el: SlideElement, resources: Record<string, Resource> = noResources): string {
  return renderSlideToSVG(slideWith([el]), resources);
}

// =============================================================================
// Tests
// =============================================================================

describe('svgRenderer geometry (stable across renderer unification)', () => {
  test('svg root has slide dimensions and viewBox', () => {
    const svg = renderOne(shape({ id: 'r', shapeType: 'rect', x: 0, y: 0, width: 10, height: 10 }));
    const root = firstTag(svg, 'svg');
    expect(root.attrs.width).toBe(String(SLIDE_WIDTH));
    expect(root.attrs.height).toBe(String(SLIDE_HEIGHT));
    expect(root.attrs.viewBox).toBe(`0 0 ${SLIDE_WIDTH} ${SLIDE_HEIGHT}`);
  });

  test('solid background rect', () => {
    const svg = renderOne(shape({ id: 'r', shapeType: 'rect', x: 0, y: 0, width: 10, height: 10 }), noResources);
    const bg = firstTag(svg, 'rect');
    expect(bg.attrs.fill).toBe('#ffffff');
    expect(nums(bg.attrs.width)[0]).toBe(SLIDE_WIDTH);
    expect(nums(bg.attrs.height)[0]).toBe(SLIDE_HEIGHT);
  });

  test('rect with corner radius, stroke and rotation', () => {
    const el = shape({
      id: 'rect1', shapeType: 'rect',
      x: 100, y: 50, width: 200, height: 120,
      cornerRadius: 12, fill: '#ff0000', stroke: '#00aa00', strokeWidth: 4,
      opacity: 0.8, rotation: 30,
    });
    const svg = renderOne(el);
    const rect = tagsOf(svg, 'rect')[1]; // [0] is the background
    expect(rect).toBeDefined();
    expect(nums(rect.attrs.x)[0]).toBe(100);
    expect(nums(rect.attrs.y)[0]).toBe(50);
    expect(nums(rect.attrs.width)[0]).toBe(200);
    expect(nums(rect.attrs.height)[0]).toBe(120);
    expect(nums(rect.attrs.rx)[0]).toBe(12);
    expect(nums(rect.attrs.ry)[0]).toBe(12);
    expect(rect.attrs.fill).toBe('#ff0000');
    expect(rect.attrs.stroke).toBe('#00aa00');
    expect(nums(rect.attrs['stroke-width'])[0]).toBe(4);
    expect(nums(rect.attrs.opacity)[0]).toBeCloseTo(0.8);
    // Rotation wraps the shape in a g with rotate(angle, cx, cy)
    const gs = tagsOf(svg, 'g').filter(g => (g.attrs.transform ?? '').includes('rotate'));
    expect(gs.length).toBeGreaterThan(0);
    expectNumsClose(nums(gs[0].attrs.transform), [30, 200, 110]);
  });

  test('non-rotated shapes have no rotate transform', () => {
    const svg = renderOne(shape({ id: 'r', shapeType: 'rect', x: 5, y: 6, width: 7, height: 8 }));
    const rotated = tagsOf(svg, 'g').filter(g => (g.attrs.transform ?? '').includes('rotate'));
    expect(rotated.length).toBe(0);
  });

  test('ellipse geometry', () => {
    const el = shape({
      id: 'ell1', shapeType: 'ellipse',
      x: 400, y: 200, width: 300, height: 180,
      fill: '#123456', stroke: '', strokeWidth: 0,
    });
    const svg = renderOne(el);
    const ell = firstTag(svg, 'ellipse');
    expect(nums(ell.attrs.cx)[0]).toBe(550);
    expect(nums(ell.attrs.cy)[0]).toBe(290);
    expect(nums(ell.attrs.rx)[0]).toBe(150);
    expect(nums(ell.attrs.ry)[0]).toBe(90);
    expect(ell.attrs.fill).toBe('#123456');
    expect(ell.attrs.stroke).toBe('none');
    expect(nums(ell.attrs['stroke-width'])[0]).toBe(0);
  });

  test('triangle path math (equilateral inscribed in min-dimension circle)', () => {
    const el = shape({
      id: 'tri1', shapeType: 'triangle',
      x: 50, y: 400, width: 160, height: 140,
      fill: '#abcdef', stroke: '#000000', strokeWidth: 2,
    });
    const svg = renderOne(el);
    const path = firstTag(svg, 'path');
    expect(dCommands(path.attrs.d)).toBe('MLLZ');
    const tcx = 50 + 160 / 2;
    const tcy = 400 + 140 / 2;
    const r = Math.min(160, 140) / 2;
    expectNumsClose(nums(path.attrs.d), [
      tcx, tcy - r,
      tcx - r * Math.cos(Math.PI / 6), tcy + r * Math.sin(Math.PI / 6),
      tcx + r * Math.cos(Math.PI / 6), tcy + r * Math.sin(Math.PI / 6),
    ]);
    expect(path.attrs.fill).toBe('#abcdef');
    expect(path.attrs.stroke).toBe('#000000');
  });

  test('star polygon math (10 alternating vertices, inner = outer/2)', () => {
    const el = shape({
      id: 'star1', shapeType: 'star',
      x: 600, y: 80, width: 150, height: 150,
      fill: '#ffcc00', stroke: '', strokeWidth: 0,
    });
    const svg = renderOne(el);
    const poly = firstTag(svg, 'polygon');
    const scx = 600 + 75, scy = 80 + 75;
    const outerR = 75, innerR = 37.5;
    const expected: number[] = [];
    for (let i = 0; i < 10; i++) {
      const rr = i % 2 === 0 ? outerR : innerR;
      const angle = (i * Math.PI) / 5 - Math.PI / 2;
      expected.push(scx + rr * Math.cos(angle), scy + rr * Math.sin(angle));
    }
    expectNumsClose(nums(poly.attrs.points), expected);
    expect(poly.attrs.fill).toBe('#ffcc00');
  });

  test('open path with arrowheads: shaft d, translate, caps, arrow polygons', () => {
    const points = [0, 0, 120, 40, 240, 10];
    const el = shape({
      id: 'path1', shapeType: 'path',
      x: 800, y: 500, width: 240, height: 40,
      points, closed: false, curve: 'linear', cornerRadius: 8,
      startArrow: true, endArrow: true,
      fill: '', stroke: '#0000ff', strokeWidth: 3,
      opacity: 0.7,
    });
    const svg = renderOne(el);

    // Shaft geometry must come from the shared pathShapes helpers.
    const path = firstTag(svg, 'path');
    const expectedD = pathD(insetEndpoints(points, true, true), 'linear', false, 8);
    expect(path.attrs.d).toBe(expectedD);
    expect(path.attrs.fill).toBe('none'); // open path never fills
    expect(path.attrs.stroke).toBe('#0000ff');
    expect(nums(path.attrs['stroke-width'])[0]).toBe(3);
    expect(path.attrs['stroke-linecap']).toBe('round');
    expect(path.attrs['stroke-linejoin']).toBe('round');
    expect(nums(path.attrs.opacity)[0]).toBeCloseTo(0.7);

    // Position via translate(x, y) on an inner g.
    const translated = tagsOf(svg, 'g').filter(g => (g.attrs.transform ?? '').includes('translate'));
    expect(translated.length).toBe(1);
    expectNumsClose(nums(translated[0].attrs.transform), [800, 500]);

    // Arrowhead triangles at the ORIGINAL (un-inset) endpoints.
    const polys = tagsOf(svg, 'polygon');
    expect(polys.length).toBe(2);
    const expectedStart = arrowheadPoints(0, 0, 0 - 120, 0 - 40);
    const expectedEnd = arrowheadPoints(240, 10, 240 - 120, 10 - 40);
    expectNumsClose(nums(polys[0].attrs.points), expectedStart);
    expectNumsClose(nums(polys[1].attrs.points), expectedEnd);
    expect(polys[0].attrs.fill).toBe('#0000ff');
    expect(polys[1].attrs.fill).toBe('#0000ff');
    expect(nums(polys[0].attrs.opacity)[0]).toBeCloseTo(0.7);
    expect(nums(polys[1].attrs.opacity)[0]).toBeCloseTo(0.7);
  });

  test('closed path (polygon) fills and closes', () => {
    const points = [0, 0, 100, 0, 100, 80, 0, 80];
    const el = shape({
      id: 'poly1', shapeType: 'path',
      x: 10, y: 20, width: 100, height: 80,
      points, closed: true, curve: 'linear',
      fill: '#00ffcc', stroke: '#111111', strokeWidth: 2,
    });
    const svg = renderOne(el);
    const path = firstTag(svg, 'path');
    expect(path.attrs.d).toBe(pathD(points, 'linear', true, 0));
    expect(dCommands(path.attrs.d).endsWith('Z')).toBe(true);
    expect(path.attrs.fill).toBe('#00ffcc');
    expect(path.attrs.stroke).toBe('#111111');
    expect(tagsOf(svg, 'polygon').length).toBe(0); // no arrowheads
  });

  test('open path stroke falls back to fill, then black; default width 3', () => {
    const el = shape({
      id: 'line1', shapeType: 'path',
      x: 0, y: 0, width: 100, height: 10,
      points: [0, 0, 100, 10], closed: false,
      fill: '#ff00ff', stroke: '', strokeWidth: 0,
    });
    const svg = renderOne(el);
    const path = firstTag(svg, 'path');
    expect(path.attrs.stroke).toBe('#ff00ff');
    expect(nums(path.attrs['stroke-width'])[0]).toBe(3);

    const el2 = shape({ ...el, id: 'line2', fill: '', stroke: '' });
    const path2 = firstTag(renderOne(el2), 'path');
    expect(path2.attrs.stroke).toBe('#000');
  });

  test('bspline path pre-samples to line segments via shared pathD', () => {
    const points = [0, 0, 50, 100, 100, 0, 150, 100];
    const el = shape({
      id: 'spline1', shapeType: 'path',
      x: 30, y: 40, width: 150, height: 100,
      points, closed: false, curve: 'bspline3',
      fill: '', stroke: '#333333', strokeWidth: 2,
    });
    const svg = renderOne(el);
    const path = firstTag(svg, 'path');
    expect(path.attrs.d).toBe(pathD(points, 'bspline3', false, 0));
  });

  test('hidden elements render nothing', () => {
    const el = shape({ id: 'h1', shapeType: 'rect', x: 0, y: 0, width: 10, height: 10, visible: false });
    const svg = renderOne(el);
    expect(tagsOf(svg, 'rect').length).toBe(1); // background only
  });

  test('text element: foreignObject box, padding, style passthrough', () => {
    const el: TextElement = {
      ...baseEl,
      id: 'txt1', type: 'text',
      x: 200, y: 300, width: 400, height: 150,
      rotation: 15,
      text: 'Hello **world**',
      style: {
        fontFamily: 'Inter', fontSize: 32, fontWeight: 'normal', fontStyle: 'italic',
        textDecoration: 'none', color: '#222222', align: 'center', verticalAlign: 'middle',
        lineHeight: 1.2,
      },
    };
    const svg = renderOne(el);
    const fo = firstTag(svg, 'foreignObject');
    expect(nums(fo.attrs.x)[0]).toBe(200 + TEXT_BOX_PADDING);
    expect(nums(fo.attrs.y)[0]).toBe(300 + TEXT_BOX_PADDING);
    expect(nums(fo.attrs.width)[0]).toBe(400 - 2 * TEXT_BOX_PADDING);
    expect(nums(fo.attrs.height)[0]).toBe(150 - 2 * TEXT_BOX_PADDING);
    // Rotation around the element centre.
    const gs = tagsOf(svg, 'g').filter(g => (g.attrs.transform ?? '').includes('rotate'));
    expectNumsClose(nums(gs[0].attrs.transform), [15, 400, 375]);
    // Markdown made it into HTML (bold run rendered, delimiters stripped).
    expect(svg).toContain('world');
    expect(svg).not.toContain('**world**');
    expect(svg).toContain('font-family:Inter');
    expect(svg).toContain('font-style:italic');
    expect(svg).toContain('text-align:center');
  });

  test('image element renders SVG <image> (NOT foreignObject — must rasterize in PNG path)', () => {
    const resources: Record<string, Resource> = {
      res1: { id: 'res1', name: 'pic', type: 'image', src: 'data:image/png;base64,AAAA', originalWidth: 800, originalHeight: 600 },
    };
    const el: ImageElement = {
      ...baseEl,
      id: 'img1', type: 'image', resourceId: 'res1',
      x: 100, y: 120, width: 400, height: 300,
      cropX: 0, cropY: 0, cropWidth: 0, cropHeight: 0,
      opacity: 0.9,
    };
    const svg = renderOne(el, resources);
    expect(tagsOf(svg, 'foreignObject').length).toBe(0);
    const img = firstTag(svg, 'image');
    expect(img.attrs.href).toBe('data:image/png;base64,AAAA');
    expect(nums(img.attrs.x)[0]).toBe(100);
    expect(nums(img.attrs.y)[0]).toBe(120);
    expect(nums(img.attrs.width)[0]).toBe(400);
    expect(nums(img.attrs.height)[0]).toBe(300);
    expect(img.attrs.preserveAspectRatio).toBe('none');
  });

  test('cropped image: clipPath + scaled/offset image', () => {
    const resources: Record<string, Resource> = {
      res1: { id: 'res1', name: 'pic', type: 'image', src: 'data:image/png;base64,BBBB', originalWidth: 1000, originalHeight: 500 },
    };
    const el: ImageElement = {
      ...baseEl,
      id: 'img2', type: 'image', resourceId: 'res1',
      x: 50, y: 60, width: 200, height: 100,
      cropX: 100, cropY: 50, cropWidth: 400, cropHeight: 200,
    };
    const svg = renderOne(el, resources);
    expect(tagsOf(svg, 'clipPath').length).toBe(1);
    const img = firstTag(svg, 'image');
    const scaleX = 200 / 400, scaleY = 100 / 200;
    expect(nums(img.attrs.x)[0]).toBeCloseTo(50 - 100 * scaleX);
    expect(nums(img.attrs.y)[0]).toBeCloseTo(60 - 50 * scaleY);
    expect(nums(img.attrs.width)[0]).toBeCloseTo(1000 * scaleX);
    expect(nums(img.attrs.height)[0]).toBeCloseTo(500 * scaleY);
  });

  test('video resource renders a dark placeholder rect (video cannot rasterize)', () => {
    const resources: Record<string, Resource> = {
      vid1: { id: 'vid1', name: 'clip', type: 'video', src: 'blob:x', originalWidth: 1920, originalHeight: 1080 },
    };
    const el: ImageElement = {
      ...baseEl,
      id: 'v1', type: 'image', resourceId: 'vid1',
      x: 10, y: 20, width: 300, height: 200,
      cropX: 0, cropY: 0, cropWidth: 0, cropHeight: 0,
    };
    const svg = renderOne(el, resources);
    const rects = tagsOf(svg, 'rect');
    expect(rects.length).toBe(2); // background + placeholder
    expect(rects[1].attrs.fill).toBe('#1f2937');
    expect(nums(rects[1].attrs.width)[0]).toBe(300);
  });

  test('gradient background emits linearGradient + stops', () => {
    const svg = renderSlideToSVG(
      slideWith(
        [shape({ id: 'r', shapeType: 'rect', x: 0, y: 0, width: 10, height: 10 })],
        { type: 'gradient', from: '#ff0000', to: '#0000ff', direction: 90 },
      ),
      noResources,
    );
    expect(tagsOf(svg, 'linearGradient').length).toBe(1);
    const stops = tagsOf(svg, 'stop');
    expect(stops.length).toBe(2);
    expect(stops[0].attrs['stop-color']).toBe('#ff0000');
    expect(stops[1].attrs['stop-color']).toBe('#0000ff');
  });
});

describe('svgRenderer parity with the editor renderer', () => {
  // The string-template fork once silently dropped strokeStyle — dashed /
  // dotted paths exported as solid until strokeDashFor was shared. Now that
  // shapes render through the shared RenderShape, this class of drift is
  // structurally impossible; these tests pin the dash behaviour anyway.
  test('dashed path exports stroke-dasharray matching strokeDashFor', () => {
    const el = shape({
      id: 'dash1', shapeType: 'path',
      x: 0, y: 0, width: 100, height: 10,
      points: [0, 0, 100, 10], closed: false,
      fill: '', stroke: '#000000', strokeWidth: 3,
      strokeStyle: 'dashed',
    });
    const svg = renderOne(el);
    const path = firstTag(svg, 'path');
    expect(path.attrs['stroke-dasharray']).toBe(strokeDashFor('dashed', 3));
  });

  test('dotted path exports stroke-dasharray', () => {
    const el = shape({
      id: 'dot1', shapeType: 'path',
      x: 0, y: 0, width: 100, height: 10,
      points: [0, 0, 100, 10], closed: false,
      fill: '', stroke: '#000000', strokeWidth: 4,
      strokeStyle: 'dotted',
    });
    const svg = renderOne(el);
    const path = firstTag(svg, 'path');
    expect(path.attrs['stroke-dasharray']).toBe(strokeDashFor('dotted', 4));
  });
});
