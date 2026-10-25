import { describe, expect, it } from 'vitest';
import { arrowheadGeometry, nativePathGeometry, pathArrowGeometry, type ClosurePathShape } from './pathShapes';
import { createShapeElement } from './slideFactory';
import { interpolateElement } from './interpolation';
import { consumeNativeTerminals, nativeSpanInsideIntervals, nativeSpanPoint, paintedNativePath, serializeNativePath,
  type NativePath, type NativePathSpan, type NativePoint } from './nativePathSpans';

const path = (controls: NativePoint[]): NativePath => ({ start: controls[0], closed: false,
  spans: [{ kind: controls.length === 2 ? 'L' : controls.length === 3 ? 'Q' : 'C', controls, role: 'authored', index: 0 }] });
const box = { points: [-1, -1, 1, -1, 1, 1, -1, 1] };

describe('nativePathSpans paint quantization ownership', () => {
  it.each([.175, .349])('repairs the real moving prefix at %s for positive/mixed rounding and both ends', progress => {
    const first = Math.hypot(91.5, 223.5), last = Math.sqrt(10), distance = (first + last) * progress / .35;
    const finalLeg = distance > first, ux = finalLeg ? -3 / last : -91.5 / first, uy = finalLeg ? -1 / last : -223.5 / first;
    const d = finalLeg ? distance - first : distance;
    const tip: NativePoint = [(finalLeg ? 233.5 : 325) + ux * d, (finalLeg ? 146.5 : 370) + uy * d];
    for (const sign of [-1, 1]) for (const side of ['start', 'end'] as const) {
      const points: NativePoint[] = [[325, 370], ...(finalLeg ? [[233.5, 146.5] as NativePoint] : []), tip];
      if (side === 'start') points.reverse();
      const shape = { points: points.flat().map(v => v * sign), cornerRadius: 0, strokeWidth: 9,
        startHead: side === 'start' ? 'triangle' as const : 'none' as const,
        endHead: side === 'end' ? 'triangle' as const : 'none' as const };
      const raw = nativePathGeometry(shape)!, painted = paintedNativePath(raw);
      const head = arrowheadGeometry('triangle', tip[0] * sign, tip[1] * sign, ux * sign, uy * sign, 10, 9).boundary!;
      const result = consumeNativeTerminals(painted, side === 'start' ? head : undefined, side === 'end' ? head : undefined);
      const terminal = side === 'start' ? 0 : painted.spans.length - 1;
      const ints = nativeSpanInsideIntervals(painted.spans[terminal], head);
      expect(ints).toHaveLength(1);
      expect(side === 'start' ? ints[0][0] : ints[0][1]).not.toBe(side === 'start' ? 0 : 1);
      expect(side === 'start' ? result.consumed[terminal][0][0] : result.consumed[terminal][0][1]).toBe(side === 'start' ? 0 : 1);
      expect(result.runs).toHaveLength(1);
      expect(result.runs[0]).toHaveLength(1);
      const retained = result.runs[0][0];
      // The entry is still the exact painted root, not an unrounded replacement.
      const root = nativeSpanInsideIntervals(painted.spans[retained.spanIndex], head)[0];
      expect(side === 'start' ? retained.from : retained.to).toBe(side === 'start' ? root[1] : root[0]);
      expect(pathArrowGeometry(shape).strokePlan?.runs).toHaveLength(1);
    }
  });

  it.each(['triangle', 'circle', 'diamond'] as const)('owns short/zero and both-end %s heads with serializer provenance', type => {
    for (const length of [0, .001, 1, 100]) {
      const raw = path([[.006, 0], [length + .006, 0]]), painted = paintedNativePath(raw);
      const start = arrowheadGeometry(type, .006, 0, -1, 0, 10, 9).boundary!;
      const end = arrowheadGeometry(type, length + .006, 0, 1, 0, 10, 9).boundary!;
      const result = consumeNativeTerminals(painted, start, end);
      // On the head axis, every short painted point is inside at least one
      // of these opposing heads, including a leg collapsed by serialization.
      if (length < 2) expect(result.runs).toEqual([]);
      else {
        expect(result.consumed[0]).toHaveLength(2);
        expect(result.consumed[0][0][0]).toBe(0);
        expect(result.consumed[0][1][1]).toBe(1);
      }
    }
  });

  it('bridges painted islands only within the same raw-inside owned component', () => {
    const raw = path([[-.5, .0051], [0, .0251], [.5, .0051]]);
    const boundary = { points: [-1, -1, 1, -1, 1, .017, -1, .017] };
    const painted = paintedNativePath(raw);
    expect(nativeSpanInsideIntervals(raw.spans[0], boundary)).toEqual([[0, 1]]);
    expect(nativeSpanInsideIntervals(painted.spans[0], boundary)).toHaveLength(2);
    expect(consumeNativeTerminals(painted, boundary).consumed).toEqual([[[0, 1]]]);
    for (let i = 0; i <= 100; i++) {
      const a = nativeSpanPoint(raw.spans[0], i / 100), b = nativeSpanPoint(painted.spans[0], i / 100);
      expect(Math.abs(a[1] - b[1])).toBeLessThanOrEqual(.005);
    }
  });

  it.each(['start', 'end'] as const)('retains a painted component merging unrelated raw components: %s', side => {
    for (const reversed of [false, true]) for (const role of ['authored', 'start-corner', 'end-corner', 'closing'] as const) {
      const controls: NativePoint[] = [[-.5, .999], [0, 1.004], [.5, .999]];
      if (reversed) controls.reverse();
      const raw = path(controls);
      raw.spans[0].role = role;
      if (role !== 'authored') {
        if (role === 'closing') Object.assign(raw.spans[0], { sourceControls: controls, sourceTo: 1 });
        raw.spans.unshift({ kind: 'L', controls: [[5, 5], [6, 6]], role: 'authored', index: 1 });
      }
      const i = raw.spans.length - 1, painted = paintedNativePath(raw);
      expect(nativeSpanInsideIntervals(raw.spans[i], box)).toHaveLength(2);
      expect(nativeSpanInsideIntervals(painted.spans[i], box)).toEqual([[0, 1]]);
      const owned = consumeNativeTerminals(painted, side === 'start' ? box : undefined, side === 'end' ? box : undefined);
      expect(owned.consumed[i]).toEqual([]);
      expect(consumeNativeTerminals(painted, box, box).consumed[i]).toEqual([]);
    }
  });

  it('retains only ambiguous components without dropping a separate valid owned span', () => {
    const raw = path([[0, 0], [.5, 0]]);
    raw.spans.push({ kind: 'Q', role: 'start-corner', index: 1, controls: [[-.5, .999], [0, 1.004], [.5, .999]] });
    expect(consumeNativeTerminals(paintedNativePath(raw), box).consumed).toEqual([[[0, 1]], []]);
  });

  it('does not manufacture ownership from a painted-only near-tangent interval', () => {
    const raw = path([[-1, 1.004], [1, 1.004]]), boundary = { cx: 0, cy: 0, radius: 1.004 };
    const painted = paintedNativePath(raw);
    expect(nativeSpanInsideIntervals(raw.spans[0], boundary)).toEqual([]);
    expect(nativeSpanInsideIntervals(painted.spans[0], boundary)).toHaveLength(1);
    expect(consumeNativeTerminals(painted, boundary, boundary).consumed).toEqual([[]]);
  });

  it('rejects a painted-only polygon boundary-following component', () => {
    const raw = path([[-.5, 1.004], [.5, 1.004]]), painted = paintedNativePath(raw);
    expect(nativeSpanInsideIntervals(painted.spans[0], box)).toEqual([[0, 1]]);
    expect(consumeNativeTerminals(painted, box, box).consumed).toEqual([[]]);
  });

  it('keeps paint when quantization erases every inside seed, rather than inventing a cut', () => {
    const raw = path([[-.5, .006], [.5, .006]]), boundary = { points: [-1, .0055, 1, .0055, 1, .0065, -1, .0065] };
    const painted = paintedNativePath(raw);
    expect(nativeSpanInsideIntervals(raw.spans[0], boundary)).toEqual([[0, 1]]);
    expect(nativeSpanInsideIntervals(painted.spans[0], boundary)).toEqual([]);
    expect(consumeNativeTerminals(painted, boundary, boundary).consumed).toEqual([[]]);
  });

  it('does not cross a raw-outside loop into its unrelated narrow re-entry', () => {
    const raw = path([[.003, 0], [20.003, 0], [-19.997, 0], [.003, 0]]);
    const boundary = { cx: .003, cy: 0, radius: .0001 }, painted = paintedNativePath(raw);
    const inside = nativeSpanInsideIntervals(painted.spans[0], boundary);
    expect(inside.length).toBeGreaterThan(1);
    const result = consumeNativeTerminals(painted, boundary);
    // The tiny raw-start component does not overlap a painted component after
    // rounding; conservative no-seed handling cannot grab a later circle visit.
    expect(result.consumed[0]).toEqual([]);
  });

  it.each(['start', 'end'] as const)('preserves coincident/wrap barriers and full manual-seam provenance: %s', side => {
    for (const progress of [0, 1e-9, .001, .3, .9, 1 - 1e-9, 1]) {
      const p = [.003, .006, 100.003, .006, .003, .006];
      const raw = nativePathGeometry({ points: p, cornerRadius: 25, strokeWidth: 9, closed: progress === 1,
        _pathClosure: { progress, fillOpacity: progress } })!;
      const boundary = arrowheadGeometry('triangle', .003, .006, -1, 0, 10, 20).boundary;
      const painted = paintedNativePath(raw), result = consumeNativeTerminals(painted, side === 'start' ? boundary : undefined, side === 'end' ? boundary : undefined);
      const authored = raw.spans.map((s, i) => s.role === 'authored' ? i : -1).filter(i => i >= 0);
      expect(result.consumed[side === 'start' ? authored.at(-1)! : authored[0]]).toEqual([]);
      const manual = nativePathGeometry({ points: [0, 0, 100, 0], curve: 'bezier', cornerRadius: 0, strokeWidth: 9,
        tangents: [400, 0, 20, 0, -20, 0, -400, 0], closed: progress === 1,
        _pathClosure: { progress, fillOpacity: progress } })!;
      const a = consumeNativeTerminals(manual, box).consumed;
      const b = consumeNativeTerminals(paintedNativePath(manual), box).consumed;
      if (!a.at(-1)!.length) expect(b.at(-1)).toEqual([]);
      // Prefix truncation never manufactures a new head seed at its moving tip.
      expect(paintedNativePath(manual).spans.at(-1)?.sourceControls).toEqual(manual.spans.at(-1)?.sourceControls);
    }
  });

  it('keeps quantized near-closure, reversed and const playback equivalent', () => {
    const source = createShapeElement('path', { points: [.003, .006, 100.003, .006, 100.003, 100.006],
      cornerRadius: 25, strokeWidth: 9, startHead: 'triangle', endHead: 'circle', closed: false });
    const target = { ...source, closed: true };
    const plan = (shape: ClosurePathShape) => pathArrowGeometry(shape).strokePlan;
    for (const t of [0, 1e-9, .1, .5, .938, 1 - 1e-9, 1]) {
      expect(plan(interpolateElement(source, target, t, true) as ClosurePathShape)).toEqual(
        plan(interpolateElement(target, source, 1 - t, false) as ClosurePathShape));
    }
    const constant = { ...target, transitions: { controlPoints: 'const' as const } };
    for (const t of [.25, .75]) expect(plan(interpolateElement(source, constant, t, true) as ClosurePathShape))
      .toEqual(plan(t < .5 ? source : target));
  });

  it('keeps provenance through repeated paint adaptation and rejects forged controls', () => {
    const raw = path([[0, 0], [10.003, .006]]), once = paintedNativePath(raw), twice = paintedNativePath(once);
    expect(twice.paintSource).toBe(raw);
    expect(serializeNativePath(twice)).toBe(serializeNativePath(raw));
    expect(consumeNativeTerminals(twice, box)).toEqual(consumeNativeTerminals(once, box));
    const bad: NativePathSpan = { ...once.spans[0], controls: [[0, 0], [10.1, 0]] };
    expect(() => consumeNativeTerminals({ ...once, spans: [bad] }, box)).toThrow('quantization provenance');
  });
});
