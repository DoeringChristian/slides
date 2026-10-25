import { describe, expect, test } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  pathExtendPrefix,
  pathArrowGeometry,
  pathArcLength,
  pointAtArcLength,
  arrowheadGeometry,
  pathEndpointDirection,
  type ExtendEffect,
} from './pathShapes';
import { shapeToSvgPaths } from './shapeToPath';
import { interpolateWithVisibility } from './interpolation';
import { createShapeElement } from './slideFactory';
import { SHAPE_VISIBILITY_TYPES } from './easingCatalog';
import { EASING_LABELS } from './transitionProperties';
import { RenderShape } from '../components/svg/ElementRenderer';
import { renderPresenterElement } from '../components/presenter/presenterUtils';
import type { ArrowheadType, PathCurve, ShapeElement } from '../types/presentation';

type Extendable = ShapeElement & { _extendFx?: ExtendEffect };

const STEPS = [0.05, 0.1, 0.2, 0.35, 0.5, 0.65, 0.8, 0.9, 0.97];

/** Every curve family the `extend` animation has to cover. */
const FAMILIES: Array<{ label: string; curve: PathCurve; points: number[]; tangents?: number[] }> = [
  { label: 'straight 2-point', curve: 'linear', points: [0, 0, 120, 0] },
  { label: 'multipoint linear bend', curve: 'linear', points: [0, 0, 60, 0, 60, 80, 140, 80, 140, 160] },
  { label: 'smooth (auto Catmull tangents)', curve: 'smooth', points: [0, 0, 50, -40, 110, 30, 170, -10] },
  {
    label: 'bezier (explicit tangents)',
    curve: 'bezier',
    points: [0, 0, 60, 60, 140, 0],
    tangents: [-20, -20, 20, 20, -30, 10, 30, -10, -20, 20, 20, -20],
  },
  { label: 'legacy b-spline cubic', curve: 'bspline3', points: [0, 0, 40, -60, 100, 60, 160, -20, 220, 20] },
  { label: 'legacy b-spline quadratic', curve: 'bspline2', points: [0, 0, 40, -60, 100, 60, 160, -20] },
];

function path(overrides: Partial<ShapeElement> = {}): ShapeElement {
  return createShapeElement('path', {
    id: 'subject', x: 0, y: 0, points: [0, 0, 120, 0],
    curve: 'linear', closed: false, cornerRadius: 0, strokeWidth: 4,
    startHead: 'none', endHead: 'none', ...overrides,
  });
}

/** A path from one curve family (the `label` key must not leak into the element). */
function familyPath(f: typeof FAMILIES[number], overrides: Partial<ShapeElement> = {}): ShapeElement {
  return path({ curve: f.curve, points: f.points, tangents: f.tangents, ...overrides });
}

/** Arc length actually drawn by a prefix, under the prefix's own curve mode. */
function prefixLength(shape: ShapeElement, progress: number): number {
  const p = pathExtendPrefix(shape, progress);
  if ((p.points?.length ?? 0) < 4) return 0;
  return pathArcLength(p.points!, p.curve ?? 'linear', !!p.closed, p.tangents);
}

function fullLength(shape: ShapeElement): number {
  return pathArcLength(shape.points!, shape.curve ?? 'linear', !!shape.closed, shape.tangents);
}

// =============================================================================
// Endpoints: nothing at t=0, exactly the authored geometry at t=1
// =============================================================================

describe('extend endpoints', () => {
  test.each(FAMILIES)('$label draws nothing at progress 0', (f) => {
    const el = familyPath(f, { endHead: 'triangle', startHead: 'bar' });
    // A prefix shorter than one leg collapses to a single vertex, so pathD and
    // both heads bail out: no stroke, no glyph, nothing on screen.
    expect(pathExtendPrefix(el, 0).points).toEqual([f.points[0], f.points[1]]);
    const geo = pathArrowGeometry({ ...el, _extendFx: { progress: 0 } } as Extendable);
    expect(geo.d).toBe('');
    expect(geo.startGeo).toBeNull();
    expect(geo.endGeo).toBeNull();
  });

  test.each(FAMILIES)('$label at progress 1 is the authored geometry, untouched', (f) => {
    const el = familyPath(f, { endHead: 'triangle', startHead: 'circle' });
    const prefix = pathExtendPrefix(el, 1);
    expect(prefix.points).toBe(el.points);   // same array reference: never resampled
    expect(prefix.curve).toBe(f.curve);
    expect(prefix.tangents).toBe(el.tangents);
  });

  test.each(FAMILIES)('$label final frame is byte-equal to the static render', (f) => {
    const el = familyPath(f, { endHead: 'triangle-outline', startHead: 'diamond' });
    const done = { ...el, _extendFx: { progress: 1 } } as Extendable;
    expect(pathArrowGeometry(done)).toEqual(pathArrowGeometry(el));
    expect(renderToStaticMarkup(<RenderShape element={done} />))
      .toBe(renderToStaticMarkup(<RenderShape element={el} />));
  });

  test('progress above 1 and NaN are no-ops, never a resampled lookalike', () => {
    const el = path({ curve: 'smooth', points: [0, 0, 50, -40, 110, 30] });
    for (const progress of [1, 1.5, Number.NaN]) {
      expect(pathExtendPrefix(el, progress).points).toBe(el.points);
    }
  });
});

// =============================================================================
// Monotonic growth along the ROUTE (not a scale, not an all-points morph)
// =============================================================================

describe('extend growth', () => {
  test.each(FAMILIES)('$label grows monotonically in arc length', (f) => {
    const el = familyPath(f);
    let previous = 0;
    for (const t of STEPS) {
      const length = prefixLength(el, t);
      expect(length).toBeGreaterThan(previous);
      previous = length;
    }
    expect(previous).toBeLessThanOrEqual(fullLength(el) + 1e-6);
  });

  test.each(FAMILIES)('$label advances at constant arc-length speed', (f) => {
    const el = familyPath(f);
    const total = fullLength(el);
    for (const t of STEPS) {
      // 2% covers the chord-vs-curve error of 32 samples per segment.
      expect(Math.abs(prefixLength(el, t) - total * t)).toBeLessThan(total * 0.02);
    }
  });

  test('growth starts at the FIRST vertex and walks successive bends', () => {
    const el = path({ points: [0, 0, 60, 0, 60, 80, 140, 80] }); // legs 60 / 80 / 80
    expect(pathExtendPrefix(el, 0.2).points).toEqual([0, 0, 44, 0]);
    expect(pathExtendPrefix(el, 0.5).points).toEqual([0, 0, 60, 0, 60, 50]);
    expect(pathExtendPrefix(el, 0.9).points).toEqual([0, 0, 60, 0, 60, 80, 118, 80]);
    // A global scale would shrink every leg at once; here the far end simply
    // does not exist yet while the first leg is already at full length.
    expect(pathExtendPrefix(el, 0.2).points).toHaveLength(4);
  });

  test('a closed polygon grows through its closing leg last', () => {
    const el = path({ points: [0, 0, 100, 0, 100, 100, 0, 100], closed: true }); // perimeter 400
    const near = pathExtendPrefix(el, 0.95);
    expect(near.closed).toBe(false);
    expect(near.points).toEqual([0, 0, 100, 0, 100, 100, 0, 100, 0, 20]);
    expect(pathExtendPrefix(el, 1).closed).toBe(true);
  });

  test('a smooth/bezier prefix is an exact SUB-CURVE, so the revealed part never wobbles', () => {
    const el = path({ curve: 'smooth', points: [0, 0, 50, -40, 110, 30, 170, -10] });
    // Re-emitted as explicit-tangent bezier precisely so the shorter vertex
    // list cannot re-derive different Catmull-Rom handles.
    const half = pathExtendPrefix(el, 0.5);
    expect(half.curve).toBe('bezier');
    expect(half.tangents).toHaveLength(half.points!.length * 2);
    const later = pathExtendPrefix(el, 0.8);
    // Every segment already fully revealed at t=0.5 carries BIT-identical
    // vertices and handles at t=0.8 — growth only ever appends. (The last full
    // vertex's OUT handle is the live split, so it is excluded.)
    const split = half.points!.length / 2 - 2;
    expect(later.points!.slice(0, 2 * (split + 1))).toEqual(half.points!.slice(0, 2 * (split + 1)));
    expect(later.tangents!.slice(0, 4 * split + 2)).toEqual(half.tangents!.slice(0, 4 * split + 2));
    // ...and so the curve through them does not move (sampling grids differ,
    // hence the 0.05 tolerance rather than exact equality).
    const total = fullLength(el);
    for (const t of [0.1, 0.25, 0.4]) {
      const a = pointAtArcLength(half.points!, 'bezier', false, total * t, half.tangents)!;
      const b = pointAtArcLength(later.points!, 'bezier', false, total * t, later.tangents)!;
      expect(a.x).toBeCloseTo(b.x, 1);
      expect(a.y).toBeCloseTo(b.y, 1);
    }
  });
});

// =============================================================================
// The arrowhead RIDES the growing endpoint
// =============================================================================

const HEADS: ArrowheadType[] = [
  'arrow', 'triangle', 'triangle-outline', 'bar', 'dot', 'circle', 'circle-outline',
  'diamond', 'diamond-outline', 'crowfoot-one', 'crowfoot-many', 'crowfoot-one-many',
];

/** Flatten a head's primitives into a comparable list of numbers. */
function headNumbers(geo: ReturnType<typeof arrowheadGeometry>): number[] {
  const digits = (d: string) => (d.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);
  return [
    geo.shaftInset,
    ...geo.fills.flatMap(f => ('points' in f ? f.points : digits(f.d))),
    ...geo.strokes.flatMap(s => digits(s.d)),
  ];
}

describe('extend arrowheads', () => {
  test.each(HEADS)('end head %s rides the tip at its normal size and stroke', (head) => {
    const el = path({ curve: 'smooth', points: [0, 0, 50, -40, 110, 30, 170, -10], endHead: head, strokeWidth: 4 });
    const total = fullLength(el);
    for (const t of STEPS) {
      const prefix = pathExtendPrefix(el, t);
      const last = prefix.points!.length - 2;
      const tipX = prefix.points![last], tipY = prefix.points![last + 1];
      const onRoute = pointAtArcLength(el.points!, 'smooth', false, total * t)!;
      // Position: the glyph sits on the growing endpoint of the authored route.
      expect(tipX).toBeCloseTo(onRoute.x, 1);
      expect(tipY).toBeCloseTo(onRoute.y, 1);
      // Angle: along the true tangent of the revealed sub-curve at that point.
      const dir = pathEndpointDirection(prefix.points!, 'bezier', false, prefix.tangents, 'end');
      expect(Math.atan2(dir.dy, dir.dx)).toBeCloseTo(Math.atan2(onRoute.dy, onRoute.dx), 1);
      // Size + stroke: exactly the glyph the static renderer draws at that tip —
      // no shrunken "tracing head", no second pen.
      const geo = pathArrowGeometry({ ...el, _extendFx: { progress: t } } as Extendable);
      expect(headNumbers(geo.endGeo!))
        .toEqual(headNumbers(arrowheadGeometry(head, tipX, tipY, dir.dx, dir.dy, 10, 4)));
    }
  });

  test.each(HEADS)('start head %s stays pinned to the first vertex while the path grows', (head) => {
    const el = path({ points: [0, 0, 60, 0, 60, 80, 140, 80], startHead: head, endHead: 'triangle' });
    const authored = headNumbers(pathArrowGeometry(el).startGeo!);
    for (const t of [0.3, 0.6, 0.9]) {
      const geo = pathArrowGeometry({ ...el, _extendFx: { progress: t } } as Extendable);
      expect(headNumbers(geo.startGeo!)).toEqual(authored);
    }
  });

  test('both ends headed at once: start fixed, end riding', () => {
    const el = path({ points: [0, 0, 120, 0], startHead: 'circle-outline', endHead: 'diamond' });
    const geo = pathArrowGeometry({ ...el, _extendFx: { progress: 0.5 } } as Extendable);
    expect(headNumbers(geo.startGeo!)).toEqual(headNumbers(pathArrowGeometry(el).startGeo!));
    // Diamond tip at the halfway point (60, 0), not the authored end (120, 0).
    const fill = geo.endGeo!.fills[0] as { points: number[] };
    expect([fill.points[0], fill.points[1]]).toEqual([60, 0]);
  });

  test('the riding head never lets the shaft overshoot the revealed tip', () => {
    const el = path({ points: [0, 0, 200, 0], endHead: 'triangle', strokeWidth: 6 });
    for (const t of STEPS) {
      const geo = pathArrowGeometry({ ...el, _extendFx: { progress: t } } as Extendable);
      const xs = (geo.d.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number).filter((_, i) => i % 2 === 0);
      expect(Math.max(-Infinity, ...xs)).toBeLessThanOrEqual(200 * t + 1e-6);
    }
  });
});

// =============================================================================
// Interpolation wiring — forward, backward, and the non-path fallback
// =============================================================================

describe("visibility easing 'extend'", () => {
  const subject = path({ points: [0, 0, 60, 0, 60, 80], endHead: 'triangle', transitions: { visibility: 'extend' } });

  test('an appearing path carries _extendFx spanning the FULL window', () => {
    for (const t of [0, 0.25, 0.5, 0.75, 1]) {
      const out = interpolateWithVisibility(undefined, subject, t) as Extendable;
      expect(out._extendFx).toEqual({ progress: t });
      expect(out.visible).toBe(true);
    }
  });

  test('backward playback retracts toward the first vertex', () => {
    for (const t of [0, 0.25, 0.5, 0.75, 1]) {
      const out = interpolateWithVisibility(subject, undefined, t) as Extendable;
      expect(out._extendFx).toEqual({ progress: 1 - t });
    }
    const retracting = [0.25, 0.5, 0.75].map(t =>
      prefixLength(subject, (interpolateWithVisibility(subject, undefined, t) as Extendable)._extendFx!.progress));
    expect(retracting[0]).toBeGreaterThan(retracting[1]);
    expect(retracting[1]).toBeGreaterThan(retracting[2]);
  });

  test('no _writeFx is attached — extend is geometry, not a render mode', () => {
    const out = interpolateWithVisibility(undefined, subject, 0.5) as Extendable & { _writeFx?: unknown };
    expect(out._writeFx).toBeUndefined();
  });

  test('shapes with no route to grow along fall back to the opacity ramp', () => {
    const rect = createShapeElement('rect', { id: 'r', transitions: { visibility: 'extend' } });
    expect(interpolateWithVisibility(undefined, rect, 0.25)).toBeNull(); // still invisible
    const late = interpolateWithVisibility(undefined, rect, 0.75) as Extendable;
    expect(late._extendFx).toBeUndefined();
    expect(late.opacity).toBeCloseTo(0.5);
  });

  test('a degenerate vertex list degenerates to the fade instead of throwing', () => {
    const stub = path({ points: [0, 0], transitions: { visibility: 'extend' } });
    expect((interpolateWithVisibility(undefined, stub, 0.75) as Extendable)._extendFx).toBeUndefined();
  });

  test('is selectable in the shape visibility picker, with a label', () => {
    expect(SHAPE_VISIBILITY_TYPES).toContain('extend');
    expect(EASING_LABELS.extend).toBe('Extend');
  });
});

// =============================================================================
// Shared-path parity: one geometry source feeds every consumer
// =============================================================================

describe('extend renders through the shared path', () => {
  test.each(FAMILIES)('$label: the presenter frame equals the static leaf render', (f) => {
    const el = familyPath(f, { endHead: 'triangle', startHead: 'bar', transitions: { visibility: 'extend' } });
    for (const t of [0.25, 0.6, 0.95]) {
      const frame = interpolateWithVisibility(undefined, el, t)! as ShapeElement;
      // renderPresenterElement drives the presenter, audience view, the
      // standalone/viewer builds and the picker's preview tiles; RenderShape
      // drives the editor canvas, thumbnails and the SVG/PDF export. They must
      // agree glyph for glyph, which they do because neither resolves the hint
      // itself — pathArrowGeometry does.
      expect(renderToStaticMarkup(<svg>{renderPresenterElement(frame, {})}</svg>))
        .toBe(renderToStaticMarkup(<svg><RenderShape element={frame} /></svg>));
    }
  });

  test('the Create pen-trace builder also honours the hint (no stale geometry cache)', () => {
    const el = path({ points: [0, 0, 200, 0] });
    const d = (progress: number) =>
      shapeToSvgPaths({ ...el, _extendFx: { progress } } as Extendable).map(p => p.d).join('|');
    expect(d(0.25)).not.toBe(d(0.75));
    expect(d(1)).toBe(shapeToSvgPaths(el).map(p => p.d).join('|'));
  });
});

// =============================================================================
// Regression pin: `create` must be completely unaffected
// =============================================================================

describe("'create' is unaffected by extend", () => {
  // Literal pin on the un-hinted geometry every Create frame is built from.
  // `extend` resolution lives in the same function, so a leak would show here.
  const PINS: Array<[string, Partial<ShapeElement>, string, string]> = [
    ['line + end triangle', { points: [0, 0, 120, 0], endHead: 'triangle' },
      'M 0 0 L 106.66666666666714 0', 'M 0.00 0.00 L 120.00 0.00 Z'],
    ['smooth polyline', { points: [0, 0, 50, -40, 110, 30], curve: 'smooth' },
      'M 0.00 0.00 C 8.33 -6.67 31.67 -45.00 50.00 -40.00 C 68.33 -35.00 100.00 18.33 110.00 30.00',
      'M 0.00 0.00 C 8.33 -6.67 31.67 -45.00 50.00 -40.00 C 68.33 -35.00 100.00 18.33 110.00 30.00'],
    ['closed polygon + start bar', { points: [0, 0, 100, 0, 100, 100, 0, 100], closed: true, startHead: 'bar' },
      'M 0.00 0.00 L 100.00 0.00 L 100.00 100.00 L 0.00 100.00 Z',
      'M 0.00 0.00 L 100.00 0.00 L 100.00 100.00 L 0.00 100.00 Z'],
  ];

  test.each(PINS)('%s keeps its authored d / fillD', (_label, overrides, d, fillD) => {
    const geo = pathArrowGeometry(path(overrides));
    expect(geo.d).toBe(d);
    expect(geo.fillD).toBe(fillD);
  });

  test('a finished extend hint cannot perturb a Create frame', () => {
    const el = path({ points: [0, 0, 50, -40, 110, 30], curve: 'smooth', endHead: 'triangle' });
    const fx = { mode: 'create' as const, direction: 'in' as const, t: 0.425 };
    const frame = (extra: object) =>
      renderToStaticMarkup(<svg>{renderPresenterElement({ ...el, _writeFx: fx, ...extra } as ShapeElement, {})}</svg>);
    expect(frame({ _extendFx: { progress: 1 } })).toBe(frame({}));
  });

  test('create still defaults for path shapes and keeps its tipDraw option', () => {
    expect(interpolateWithVisibility(undefined, path({}), 0.3)).toMatchObject({
      _writeFx: { t: 0.3, direction: 'in', mode: 'create' },
    });
    const tipped = path({ transitions: { visibility: 'create', visibilityOptions: { create: { tipDraw: true } } } });
    const out = interpolateWithVisibility(undefined, tipped, 0.3) as Extendable & { _writeFx?: unknown };
    expect(out._writeFx).toEqual({ t: 0.3, direction: 'in', mode: 'create', tipDraw: true });
    expect(out._extendFx).toBeUndefined();
  });
});
