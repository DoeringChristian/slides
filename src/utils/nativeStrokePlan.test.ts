import { describe, expect, it } from 'vitest';
import { nativePathGeometry, arrowheadGeometry, pathArrowGeometry, type ClosurePathShape } from './pathShapes';
import { createShapeElement } from './slideFactory';
import { interpolateElement } from './interpolation';
import { consumeNativeTerminals, nativeSpanPart, nativeSpanPoint, paintedNativePath, type NativePath, type NativePathSpan } from './nativePathSpans';
import { nativeSpanLength, nativeStrokeBounds, nativeTerminalStrokePlan } from './nativeStrokePlan';

const arch: NativePathSpan = { kind: 'C', controls: [[0, 0], [0, 100], [100, 100], [100, 0]], role: 'authored', index: 0 };

describe('nativeStrokePlan original paint clock, dash phase and coverage bounds', () => {
  it('integrates exact line and curved/cusped cubic lengths without repainting samples', () => {
    expect(nativeSpanLength({ ...arch, kind: 'L', controls: [[1, 2], [4, 6]] })).toBe(5);
    expect(nativeSpanLength(arch)).toBeCloseTo(200, 8);
    expect(nativeSpanLength({ ...arch, controls: [[0, 0], [1, 0], [-1, 0], [0, 0]] })).toBeCloseTo(2 / Math.sqrt(3), 10);
    const split = 0.314;
    expect(nativeSpanLength(nativeSpanPart(arch, 0, split)) + nativeSpanLength(nativeSpanPart(arch, split, 1))).toBeCloseTo(200, 8);
  });
  it('bounds exact native extrema and round caps, not merely authored vertices', () => {
    const path: NativePath = { start: [0, 0], spans: [arch], closed: false };
    expect(nativeStrokeBounds(path, 4)).toEqual({ x: -3, y: -3, width: 106, height: 81 });
  });
  it('keeps original dash distances across consumed gaps and one unchanged paint clock', () => {
    const first: NativePathSpan = { kind: 'L', controls: [[-4, 0], [-2, 0]], role: 'authored', index: 0 };
    // A bowed quadratic visits a circle in two components, not at its middle.
    const corner: NativePathSpan = { kind: 'Q', controls: [[-2, 0], [0, 6], [2, 0]], role: 'end-corner', index: 1 };
    const closing: NativePathSpan = { kind: 'L', controls: [[2, 0], [4, 0]], role: 'closing', index: 1 };
    const path: NativePath = { start: [-4, 0], spans: [first, corner, closing], closed: false };
    const plan = nativeTerminalStrokePlan(path, 3, undefined, { cx: 0, cy: 0, radius: 2.1 })!;
    expect(plan.runs).toHaveLength(3);
    expect(plan.runs[0].offset).toBe(0);
    expect(plan.runs[1].offset).toBeGreaterThan(2);
    expect(plan.runs[2].offset).toBeGreaterThan(2 + nativeSpanLength(corner));
    expect(plan.length).toBeCloseTo(4 + nativeSpanLength(corner), 10);
    expect(plan.runs.reduce((sum, run) => sum + run.length, 0)).toBeLessThan(plan.length);
    expect(plan.runs[0].length).toBeCloseTo(1.9, 10);
    expect(plan.runs[2].length).toBeCloseTo(1.9, 10);
    expect(plan.runs[2].offset).toBeCloseTo(plan.length - 1.9, 10);
    // The next run starts after BOTH consumed components, not after the sum
    // of preceding visible lengths (which would incorrectly restart dashes).
    expect(plan.runs[2].offset).toBeGreaterThan(plan.runs[0].length + plan.runs[1].length);
  });
  it('returns null for unchanged geometry and retains an empty consumed plan', () => {
    const path: NativePath = { start: [0, 0], spans: [arch], closed: false };
    expect(nativeTerminalStrokePlan(path, 4)).toBeNull();
    const empty = nativeTerminalStrokePlan(path, 4, { cx: 0, cy: 0, radius: 1000 })!;
    expect(empty.runs).toEqual([]);
    expect(empty.length).toBeCloseTo(200, 8);
  });
  it('retains exact polynomial points and original offsets in the crescent fixture', () => {
    const shape = { points: [325, 370, 233.5, 146.5, 230.5, 145.5], cornerRadius: 8, strokeWidth: 9 };
    const path = paintedNativePath(nativePathGeometry(shape)!);
    const end = arrowheadGeometry('triangle', 230.5, 145.5, -3, -1, 10, 9).boundary;
    const plan = nativeTerminalStrokePlan(path, 9, undefined, end)!;
    expect(plan.runs).toHaveLength(1);
    expect(plan.runs[0].offset).toBe(0);
    expect(plan.runs[0].d).toMatch(/^M 325 370 L 234\.890/);
    expect(plan.length).toBeGreaterThan(plan.runs[0].length);
    expect(plan.runs[0].length).toBeCloseTo(Math.hypot(325 - 234.8901936865, 370 - 149.8901936869), 7);
  });
  it('keeps forward/reverse and const interpolation on the same native consumption plan', () => {
    const source = createShapeElement('path', { points: [0, 0, 100, 0, 100, 100], cornerRadius: 25,
      startHead: 'triangle-outline', endHead: 'circle-outline', strokeWidth: 9, fill: '#12345680', fillStyle: 'crosshatch', closed: false });
    const target = { ...source, closed: true };
    const plan = (shape: ClosurePathShape) => {
      const geo = pathArrowGeometry(shape);
      return nativeTerminalStrokePlan(paintedNativePath(nativePathGeometry(shape)!), shape.strokeWidth, geo.startGeo?.boundary, geo.endGeo?.boundary);
    };
    for (const t of [0, 1e-6, 0.1, 0.5, 0.938, 1 - 1e-6, 1]) {
      const forward = interpolateElement(source, target, t, true) as ClosurePathShape;
      const reverse = interpolateElement(target, source, 1 - t, false) as ClosurePathShape;
      expect(plan(forward)).toEqual(plan(reverse));
    }
    const constant = { ...target, transitions: { controlPoints: 'const' as const, fill: 'linear' as const } };
    for (const t of [0.25, 0.75]) {
      const frame = interpolateElement(source, constant, t, true) as ClosurePathShape;
      expect(plan(frame)).toEqual(plan(t < 0.5 ? source : target));
      expect(frame._pathClosure?.fillOpacity).toBe(t);
    }
  });
  it.each([[0, 0, 100, 0, 100, 100], [0, 0, 100, 0, 100, 4, 0, 4]])(
    'normalizes the exact two-decimal rounded closing point without granting ownership: %j', (...points) => {
      const shape = { points, cornerRadius: 25, strokeWidth: 20, startHead: 'triangle' as const, endHead: 'triangle' as const };
      const open = pathArrowGeometry(shape).strokePlan!;
      for (const progress of [1e-9, 1e-6, 1e-5]) {
        const frame = { ...shape, _pathClosure: { progress, fillOpacity: progress } };
        const raw = nativePathGeometry(frame)!, painted = paintedNativePath(raw), geo = pathArrowGeometry(frame);
        const consumed = consumeNativeTerminals(painted, geo.startGeo?.boundary, geo.endGeo?.boundary);
        expect(consumed.consumed.at(-1)).toEqual([]); // Raw-outside seam still UNOWNED.
        expect(consumed.runs.at(-1)![0].span.role).toBe('closing');
        expect(painted.spans.at(-1)!.controls[0]).toEqual(painted.spans.at(-1)!.controls[1]);
        expect(geo.strokePlan!.runs).toEqual(open.runs);
        expect(geo.strokePlan!.length).toBe(open.length);
      }
      // Nonzero birth is deliberately NOT hidden: cap presentation needs a
      // separate decision. This assertion prevents a length threshold waiver.
      const progress = .005 / (points.length === 6 ? 100 + 25 / Math.SQRT2 : 6) * (1 + 1e-7);
      const born = pathArrowGeometry({ ...shape, _pathClosure: { progress, fillOpacity: progress } }).strokePlan!;
      expect(born.runs).toHaveLength(2);
      expect(born.runs[1].length).toBeGreaterThan(0);
      expect(born.runs[1].length).toBeLessThan(.02);
    });

  it('preserves native/authored zero paths and requires consumed terminal-corner adjacency', () => {
    const zero: NativePath = { start: [3, 4], closed: false,
      spans: [{ kind: 'L', controls: [[3, 4], [3, 4]], role: 'authored', index: 0 }] };
    expect(nativeTerminalStrokePlan(paintedNativePath(zero), 20)).toBeNull();
    const boundary = { cx: 0, cy: 0, radius: 1 };
    const raw: NativePath = { start: [0, 0], closed: false, spans: [
      { kind: 'L', controls: [[0, 0], [.5, 0]], role: 'authored', index: 0 },
      { kind: 'L', controls: [[3, 4], [3, 4]], role: 'authored', index: 1 },
    ] };
    expect(nativeTerminalStrokePlan(paintedNativePath(raw), 20, boundary)!.runs[0].d).toBe('M 3 4 L 3 4');
    raw.spans[1].role = 'closing'; // Not isolated by a terminal corner.
    expect(nativeTerminalStrokePlan(paintedNativePath(raw), 20, boundary)!.runs[0].d).toBe('M 3 4 L 3 4');
    raw.spans[0].role = 'end-corner';
    raw.spans.unshift({ kind: 'L', controls: [[0, 0], [0, 0]], role: 'authored', index: 0 });
    // A disconnected zero subpath is not a newly isolated seam residue.
    expect(nativeTerminalStrokePlan(paintedNativePath(raw), 20, undefined, boundary)!.runs).toHaveLength(1);
    const frame = { points: [0, 0, 10, 0, 10, 10], cornerRadius: 2, strokeWidth: 20,
      startHead: 'triangle' as const, endHead: 'triangle' as const, _pathClosure: { progress: 1e-6, fillOpacity: 1e-6 } };
    const geo = pathArrowGeometry(frame), native = nativePathGeometry(frame)!;
    // Complete removal is an EMPTY plan, never null/native fallback.
    expect(geo.strokePlan).not.toBeNull();
    expect(geo.strokePlan!.runs).toEqual([]);
    // Without serializer provenance, nonzero native seam paint is unchanged.
    expect(nativeTerminalStrokePlan(native, 20, geo.startGeo?.boundary, geo.endGeo?.boundary)!.runs.length).toBeGreaterThan(0);
  });

  it('length of a partial span agrees with its original-parameter prefix', () => {
    for (const t of [0, 1e-8, 0.2, 0.9, 1]) {
      expect(nativeSpanLength(arch, t)).toBeCloseTo(nativeSpanLength(nativeSpanPart(arch, 0, t)), 7);
      expect(nativeSpanPoint(nativeSpanPart(arch, 0, t), 1)).toEqual(nativeSpanPoint(arch, t));
    }
  });
});
