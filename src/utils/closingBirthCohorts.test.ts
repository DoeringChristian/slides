import { describe, expect, test } from 'vitest';
import type { ArrowheadType } from '../types/presentation';
import {
  completeManualClosingBirthFamily, evaluateClosingBirth, homotheticQuadraticBirthFamily,
  manualClosingBirthFamily, partitionClosingBirthPaint, type BirthSupport, type ClosingBirthFamily,
} from './closingBirthCohorts';
import {
  consumeNativeTerminals, nativeSpanInsideIntervals, nativeSpanPart, paintedNativePath,
  serializeNativePath, type NativePath, type NativePathSpan, type SpanBoundary,
} from './nativePathSpans';
import { nativeSpanLength } from './nativeStrokePlan';
import { arrowheadGeometry, nativePathGeometry, pathArrowGeometry } from './pathShapes';

const value = <T>(result: BirthSupport<T>): T => {
  expect(result.kind).toBe('supported');
  if (result.kind !== 'supported') throw new Error(result.reason);
  return result.value;
};
const line = (length = 100): NativePathSpan => ({ kind: 'L', controls: [[0, 0], [length, 0]], role: 'closing', index: 7 });
const q = (controls: NativePathSpan['controls']): NativePathSpan => ({ kind: 'Q', controls, role: 'end-corner', index: 2 });
const radial = (source: NativePathSpan, boundary?: SpanBoundary, width = 20) => value(homotheticQuadraticBirthFamily({ source, tip: [0, 0], boundary, strokeWidth: width }));
const circle = { cx: -1, cy: 0, radius: 1 };
// Genuine rounded-Q form (its middle control IS the authored head tip).
// abs(x(t))/2 = 50(1-t)^2 + 1.05t^2. Two endpoint minima of radial exit,
// separated at t=1000/1021. Their births are 1/50 and 20/21; they merge at
// p=1021/1050. At p=1 all retained paint is a SINGLE connected component.
const lateQ = q([[-100, 0], [0, 0], [-2.1, 0]]);
const box: SpanBoundary = { points: [-1, -1, 1, -1, 1, 1, -1, 1] };

function prefixPath(source: NativePathSpan, p: number): NativePath {
  const authored: NativePathSpan = { kind: 'L', controls: [[-100, 0], source.controls[0]], role: 'authored', index: 0 };
  return { start: [-100, 0], closed: p === 1, spans: [authored, { ...nativeSpanPart(source, 0, p), sourceControls: source.controls, sourceTo: p }] };
}

describe('constructor extent arithmetic support', () => {
  test('extreme finite C derivatives return unsupported rather than throwing RangeError', () => {
    const source: NativePathSpan = { kind: 'C', role: 'closing', index: 0, controls: [[0, 0], [1e308, 0], [0, 0], [0, 0]] };
    expect(manualClosingBirthFamily(source, [[0, 1]], 20).kind).toBe('unsupported');
    const path: NativePath = { start: [0, 0], closed: true, spans: [{ ...line(0), role: 'authored' }, source] };
    expect(completeManualClosingBirthFamily(path, 20, { cx: -1e308, cy: 0, radius: 1 }).kind).toBe('unsupported');
  });
  test('boundary-free Q extent overflow is unsupported, not a discarded NaN/zero reference', () => {
    for (const controls of [ [[0, 0], [1e308, 0], [0, 0]], [[-1e308, 0], [1e308, 0], [0, 0]] ] as NativePathSpan['controls'][]) {
      expect(homotheticQuadraticBirthFamily({ source: q(controls), tip: [0, 0], strokeWidth: 20 }).kind).toBe('unsupported');
    }
  });
});

describe('manual complete-source birth cohorts', () => {
  test('later interval gets its own >90% clock and a fixed budget, not a current-length denominator', () => {
    const family = value(manualClosingBirthFamily(line(), [[0, .2], [.95, 1]], 20));
    expect(family.basins.map(b => b.budget)).toEqual([2, .5]);
    expect(family.basins.map(b => b.birth)).toEqual([0, .95]);
    const at = evaluateClosingBirth(family, .95).cohorts;
    expect(at.map(c => c.weight)).toEqual([1, 0]);
    const after = evaluateClosingBirth(family, .950001).cohorts;
    expect(after[0].weight).toBe(1);
    expect(after[1].rawLength).toBeCloseTo(.0001, 10);
    expect(after[1].weight).toBeGreaterThan(0);
    expect(after[1].weight).toBeLessThan(1e-6);
    expect(after[1].budget).toBe(.5);
    expect(evaluateClosingBirth(family, 1).cohorts.map(c => c.weight)).toEqual([1, 1]);
  });

  test('manual C source parameter is not arc length, and sourceTo never seeds ownership', () => {
    const source: NativePathSpan = { kind: 'C', controls: [[0, 0], [0, 0], [0, 0], [100, 0]], role: 'closing', index: 4 };
    const family = value(manualClosingBirthFamily(source, [[.5, .75], [.9, 1]], 20));
    const state = evaluateClosingBirth(family, .6).cohorts;
    expect(state[0].rawDomains).toEqual([[.5, .6]]);
    expect(state[0].rawLength).toBeCloseTo(100 * (.6 ** 3 - .5 ** 3), 12);
    expect(state[0].referenceLength).toBeCloseTo(100 * (.75 ** 3 - .5 ** 3), 12);
    expect(state[1].rawDomains).toEqual([]);
    expect(state[1].weight).toBe(0);
  });

  test('actual looping manual C uses complete-source ownership; later re-entry is NOT owned', () => {
    const shape = { points: [0, 0, 100, 0], tangents: [400, 0, 20, 0, -20, 0, -400, 0],
      curve: 'bezier' as const, closed: true, cornerRadius: 0, strokeWidth: 20 };
    const full = nativePathGeometry(shape)!;
    const family = value(completeManualClosingBirthFamily(full, 20, box));
    const inside = nativeSpanInsideIntervals(full.spans[1], box);
    expect(inside.length).toBeGreaterThan(1);
    const owned = consumeNativeTerminals(full, box).consumed[1];
    expect(owned).toEqual([inside.at(-1)]);
    for (const p of [.01, .4, .9, .99, 1 - 1e-9, 1]) {
      const current = nativePathGeometry({ ...shape, _pathClosure: { progress: p, fillOpacity: 0 } })!;
      const retained = consumeNativeTerminals(current, box).runs.flat().filter(s => s.spanIndex === 1);
      const actual = evaluateClosingBirth(family, p).cohorts.flatMap(c => c.rawDomains);
      expect(actual.length).toBe(retained.length);
      retained.forEach((part, i) => {
        expect(actual[i][0]).toBeCloseTo(part.from * p, 11);
        expect(actual[i][1]).toBeCloseTo(part.to * p, 11);
      });
    }
  });

  test('complete-source adapter honors both heads without confusing same-coordinate re-entries', () => {
    const full = prefixPath(line(), 1);
    const end = { cx: 0, cy: 0, radius: 5 }, start = { cx: 100, cy: 0, radius: 5 };
    const family = value(completeManualClosingBirthFamily(full, 20, start, end));
    expect(family.basins[0].domain[0]).toBeCloseTo(.05, 12);
    expect(family.basins[0].domain[1]).toBeCloseTo(.95, 12);
    expect(evaluateClosingBirth(family, .05).cohorts[0].weight).toBeCloseTo(0, 12);
    expect(evaluateClosingBirth(family, .051).cohorts[0].weight).toBeLessThan(.001);
  });

  test.each([0, -1, Infinity, NaN])('invalid effective width %s is explicit unsupported, not opaque fallback', width => {
    expect(manualClosingBirthFamily(line(), [[0, 1]], width).kind).toBe('unsupported');
  });
  test('rejects moving-prefix source and ambiguous domains', () => {
    expect(manualClosingBirthFamily({ ...line(), sourceTo: .5 }, [[0, 1]], 20).kind).toBe('unsupported');
    expect(manualClosingBirthFamily({ ...line(), sourceControls: [[0, 0], [200, 0]] }, [[0, 1]], 20).kind).toBe('unsupported');
    for (const intervals of [[[.5, .2]], [[0, .5], [.5, 1]], [[0, .6], [.5, 1]], [[NaN, 1]]]) {
      expect(manualClosingBirthFamily(line(), intervals as [number, number][], 20).kind).toBe('unsupported');
    }
  });
});

describe('homothetic Q analytic radial-exit basins', () => {
  test('late independent head-exit island starts at zero while the old island is saturated', () => {
    const family = radial(lateQ, circle);
    expect(family.basins).toHaveLength(2);
    expect(family.basins[0].domain[1]).toBeCloseTo(1000 / 1021, 12);
    expect(family.basins[1].domain[0]).toBeCloseTo(1000 / 1021, 12);
    expect(family.basins[0].birth).toBeCloseTo(.02, 14);
    expect(family.basins[1].birth).toBeCloseTo(20 / 21, 14);
    const birth = family.basins[1].birth;
    expect(birth).toBeGreaterThan(.9);
    expect(evaluateClosingBirth(family, birth).cohorts.map(c => c.weight)).toEqual([1, 0]);
    const after = evaluateClosingBirth(family, birth + 1e-9).cohorts;
    expect(after[0].weight).toBe(1);
    expect(after[1].active).toBe(true);
    expect(after[1].weight).toBeGreaterThan(0);
    expect(after[1].weight).toBeLessThan(1e-8);
    expect(after[1].referenceLength).toBeCloseTo(2.1 - 2100 / 1021, 11);
    expect(after[1].budget).toBeCloseTo(.1 * (2.1 - 2100 / 1021), 11);
  });

  test('41 analytically located late-birth samples agree with raw arc, not serialized length', () => {
    const family = radial(lateQ, circle);
    const budget = .1 * (2.1 - 2100 / 1021);
    for (let i = -20; i <= 20; i++) {
      const p = 20 / 21 + i * 1e-7;
      const expectedLength = Math.max(0, 2.1 * p - 2);
      const u = Math.min(1, expectedLength / budget);
      const state = evaluateClosingBirth(family, p).cohorts;
      expect(state[0].weight).toBe(1);
      expect(state[1].rawLength).toBeCloseTo(expectedLength, 12);
      expect(state[1].weight).toBeCloseTo(u * u * (3 - 2 * u), 10);
      expect(state[1].budget).toBeCloseTo(budget, 12);
    }
  });

  test('islands merge and reverse-split without changing their parameter provenance', () => {
    const family = radial(lateQ, circle), merge = 1021 / 1050;
    const before = evaluateClosingBirth(family, merge - 1e-6);
    const after = evaluateClosingBirth(family, merge + 1e-6);
    expect(before.cohorts[0].rawDomains.at(-1)![1]).toBeLessThan(before.cohorts[1].rawDomains[0][0]);
    expect(after.cohorts[0].rawDomains.at(-1)![1]).toBe(after.cohorts[1].rawDomains[0][0]);
    expect(after.cohorts.map(c => c.domain)).toEqual(before.cohorts.map(c => c.domain));
    expect(nativeSpanInsideIntervals(lateQ, circle)).toEqual([]); // final SINGLE retained component
    expect(after.cohorts).toHaveLength(2); // still TWO clocks, not final-component matching
    expect(evaluateClosingBirth(family, merge - 1e-6)).toEqual(before);
    expect(evaluateClosingBirth(family, 20 / 21).cohorts.map(c => c.weight)).toEqual([1, 0]);
  });

  test('tangent endpoint at p=1 has no positive raw target and no forced endpoint jump', () => {
    const family = radial(q([[-2, 0], [0, 0], [-2, 0]]), circle);
    expect(family.basins).toEqual([]);
    for (const p of [0, .5, .999999, 1]) expect(evaluateClosingBirth(family, p).cohorts).toEqual([]);
  });

  test('circle interior-tip critical polynomial and tangent merge have analytic roots', () => {
    const family = radial(q([[2, 0], [1, 0], [1.05, 0]]), { cx: 0, cy: 0, radius: 1 });
    expect(family.basins).toHaveLength(2);
    expect(family.basins[0].domain[1]).toBeCloseTo(20 / 21, 12);
    expect(family.basins[1].birth).toBeCloseTo(20 / 21, 12);
    const tangent = evaluateClosingBirth(family, 21 / 22);
    expect(tangent.cohorts.every(c => c.weight === 1)).toBe(true);
  });

  test('polygon face switch creates a basin separator without nearest roots', () => {
    const source = q([[-4, 0], [0, 0], [0, 2]]);
    const family = radial(source, box);
    // exit = min(1/[4(1-t)^2], 1/[2t^2]); switch at t=2-sqrt(2).
    expect(family.basins).toHaveLength(2);
    expect(family.basins[0].domain[1]).toBeCloseTo(2 - Math.sqrt(2), 12);
    expect(family.basins.map(b => b.birth)).toEqual([.25, .5]);
    expect(evaluateClosingBirth(family, .5).cohorts.map(c => c.weight)).toEqual([1, 0]);
  });

  test('zero vector, repeated derivative roots, and zero exit plateau do not manufacture cohorts', () => {
    expect(radial(q([[0, 0], [0, 0], [0, 0]]), circle).basins).toEqual([]);
    const outward = radial(q([[1, 0], [1, 0], [1, 0]]), circle);
    expect(outward.basins).toEqual([]); // moving point has zero raw arc extent
    const noHead = radial(q([[0, 0], [0, 0], [2, 0]]));
    expect(noHead.basins).toHaveLength(1);
    expect(noHead.basins[0].birth).toBe(0);
    expect(evaluateClosingBirth(noHead, .001).cohorts[0].weight).toBeCloseTo(.000298, 12);
    const triangle = arrowheadGeometry('triangle', 0, 0, 1, 0, 10, 3).boundary;
    const plateau = radial(q([[1, 1], [0, 0], [2, 1]]), triangle);
    expect(plateau.basins).toHaveLength(1);
    expect(plateau.basins[0].birth).toBe(0);
  });

  const heads: ArrowheadType[] = ['none', 'arrow', 'triangle', 'triangle-outline', 'bar', 'dot', 'circle', 'circle-outline', 'diamond', 'diamond-outline', 'crowfoot-one', 'crowfoot-many', 'crowfoot-one-many'];
  test.each(heads)('actual %s head geometry: finite supported primitive, no invented boundary for open heads', head => {
    const geo = arrowheadGeometry(head, 0, 0, 1, 0, 10, 3);
    const source = q([[-100, 0], [0, 0], [0, 100]]);
    const family = radial(source, geo.boundary);
    expect(family.basins.length).toBeGreaterThan(0);
    expect(evaluateClosingBirth(family, 0).cohorts.every(c => c.weight === 0)).toBe(true);
    expect(evaluateClosingBirth(family, 1).cohorts.every(c => c.weight === 1)).toBe(true);
    if (!geo.boundary) expect(family.basins.map(c => c.birth)).toEqual([0]);
  });

  test.each(['triangle', 'diamond', 'circle'] as const)('rotated actual %s boundary supports the same radial family', head => {
    const rotate = ([x, y]: number[]): [number, number] => [.6 * x - .8 * y, .8 * x + .6 * y];
    const original = radial(q([[-100, 0], [0, 0], [0, 100]]), arrowheadGeometry(head, 0, 0, 1, 0, 10, 3).boundary);
    const rotated = radial(q([[-100, 0], [0, 0], [0, 100]].map(rotate)), arrowheadGeometry(head, 0, 0, 3, 4, 10, 3).boundary);
    expect(rotated.basins.length).toBe(original.basins.length);
    for (const p of [0, .001, .1, .9, 1]) {
      const a = evaluateClosingBirth(original, p), b = evaluateClosingBirth(rotated, p);
      a.cohorts.forEach((c, i) => expect(b.cohorts[i].weight).toBeCloseTo(c.weight, 10));
    }
  });

  test('head assumptions are checked; nonconvex / outside-tip / zero-circle are unsupported', () => {
    for (const boundary of [
      { cx: 2, cy: 0, radius: 1 }, { cx: 0, cy: 0, radius: 0 },
      { points: [0, 0, 2, 0, 1, 1, 2, 2, 0, 2] },
      { points: [1, 1, 2, 1, 2, 2, 1, 2] }, { points: [0, 0, 1, 0, 2, 0] },
    ]) expect(homotheticQuadraticBirthFamily({ source: lateQ, tip: [0, 0], boundary, strokeWidth: 20 }).kind).toBe('unsupported');
  });

  test('retained domain and weights grow monotonically across analytically isolated births/merger', () => {
    const family = radial(lateQ, circle);
    const events = [0, .02, 20 / 21, 1021 / 1050, 1];
    const values = [...new Set(events.flatMap(p => [Math.max(0, p - 1e-8), p, Math.min(1, p + 1e-8)]))].sort((a, b) => a - b);
    let previous = [0, 0];
    for (const p of values) {
      const state = evaluateClosingBirth(family, p);
      state.cohorts.forEach((c, i) => {
        expect(c.weight).toBeGreaterThanOrEqual(previous[i]);
        expect(c.weight).toBeLessThanOrEqual(1);
      });
      previous = state.cohorts.map(c => c.weight);
    }
  });

  test('opposite head and partial start-Q are explicitly NOT a whole-closure fallback', () => {
    expect(homotheticQuadraticBirthFamily({ source: lateQ, tip: [0, 0], boundary: circle, oppositeBoundary: box, strokeWidth: 20 }).kind).toBe('unsupported');
    expect(homotheticQuadraticBirthFamily({ source: { ...lateQ, role: 'start-corner' }, tip: [0, 0], boundary: circle, drawnTo: .2, strokeWidth: 20 }).kind).toBe('unsupported');
  });
});

describe('birth purity, serialization and original paint clock', () => {
  const families = (): ClosingBirthFamily[] => [
    value(manualClosingBirthFamily(line(), [[0, .2], [.95, 1]], 20)), radial(lateQ, circle),
  ];
  test('exact endpoints, repeated/const progress, reverse and out-of-order evaluations are identical', () => {
    for (const family of families()) {
      const frozen = JSON.stringify(family);
      const sequence = [0, 1e-9, .02, .5, .95, .9524, .99, 1 - 1e-9, 1];
      const forward = sequence.map(p => evaluateClosingBirth(family, p));
      expect(forward[0].cohorts.every(c => c.weight === 0 && !c.active)).toBe(true);
      expect(forward.at(-1)!.cohorts.every(c => c.weight === 1 && c.active)).toBe(true);
      expect([...sequence].reverse().map(p => evaluateClosingBirth(family, p))).toEqual([...forward].reverse());
      for (const i of [6, 2, 8, 0, 4, 4, 4, 1]) expect(evaluateClosingBirth(family, sequence[i])).toEqual(forward[i]);
      expect(JSON.stringify(family)).toBe(frozen);
    }
  });

  test('raw-positive .004 static painted-point target is distinct from absent raw target', () => {
    const source = line(.004), family = value(manualClosingBirthFamily(source, [[0, 1]], 20));
    expect(family.basins[0].referenceLength).toBe(.004);
    const point = value(manualClosingBirthFamily(line(0), [[0, 1]], 20));
    expect(point.basins).toEqual([]);
    for (const p of [1e-9, .001, .01, 1]) {
      const raw = prefixPath(source, p), painted = paintedNativePath(raw);
      const state = evaluateClosingBirth(family, p).cohorts[0];
      expect(nativeSpanLength(painted.spans[1])).toBe(0);
      expect(state.active).toBe(true);
      expect(state.weight).toBeGreaterThan(0);
      if (p === 1) expect(state.weight).toBe(1);
      const partition = value(partitionClosingBirthPaint(painted, consumeNativeTerminals(painted).runs, family, p));
      expect(partition.fragments[1].cohort).toBe(0);
      expect(partition.fragments[1].length).toBe(0); // intentionally blended, not filtered
      expect(partition.fragments[0].cohort).toBeNull();
      if (p < .01) expect(state.weight).toBeLessThan(.03);
    }
  });

  test('paint fragment domains split but preserve original offsets, total clock and 2dp controls', () => {
    const family = radial(lateQ, circle), p = .96;
    const raw: NativePath = { start: [-110, 0], closed: false, spans: [
      { kind: 'L', role: 'authored', index: 0, controls: [[-110, 0], [-100 * p, 0]] },
      { ...lateQ, controls: lateQ.controls.map(([x, y]) => [x * p, y * p]) },
    ] };
    const painted = paintedNativePath(raw), retained = consumeNativeTerminals(painted, undefined, circle).runs;
    const snapshot = serializeNativePath(painted);
    const result = value(partitionClosingBirthPaint(painted, retained, family, p));
    expect(result.length).toBeCloseTo(painted.spans.reduce((sum, s) => sum + nativeSpanLength(s), 0), 12);
    for (const part of result.fragments) {
      const expected = painted.spans.slice(0, part.spanIndex).reduce((sum, s) => sum + nativeSpanLength(s), 0)
        + nativeSpanLength(painted.spans[part.spanIndex], part.from);
      expect(part.offset).toBeCloseTo(expected, 12);
      expect(part.span.controls).toEqual(nativeSpanPart(painted.spans[part.spanIndex], part.from, part.to).controls);
    }
    expect(result.fragments.filter(f => f.cohort !== null).map(f => f.cohort)).toEqual([0, 1]);
    expect(serializeNativePath(painted)).toBe(snapshot);
    expect(result.length).toBeGreaterThan(result.fragments.reduce((sum, s) => sum + s.length, 0));
  });

  test('a geometry family cannot be reused for another radius or forged paint provenance', () => {
    const family = value(manualClosingBirthFamily(line(), [[0, 1]], 20));
    const wrongRadius = paintedNativePath(prefixPath(line(200), .5));
    expect(partitionClosingBirthPaint(wrongRadius, consumeNativeTerminals(wrongRadius).runs, family, .5).kind).toBe('unsupported');
    const valid = paintedNativePath(prefixPath(line(), .5));
    const retained = consumeNativeTerminals(valid).runs;
    valid.spans[1].controls[1][0] += .01;
    expect(partitionClosingBirthPaint(valid, retained, family, .5).kind).toBe('unsupported');
  });

  test('ownership/paint ambiguity and unmatched new span fail the ENTIRE partition', () => {
    const family = value(manualClosingBirthFamily(line(), [[.2, .8]], 20));
    const painted = paintedNativePath(prefixPath(line(), .5));
    expect(partitionClosingBirthPaint(painted, consumeNativeTerminals(painted).runs, family, .5).kind).toBe('unsupported');
    const qPath: NativePath = { ...painted, spans: [...painted.spans, lateQ], paintSource: undefined };
    expect(partitionClosingBirthPaint(qPath, consumeNativeTerminals(qPath).runs, value(manualClosingBirthFamily(line(), [[0, 1]], 20)), .5).kind).toBe('unsupported');
  });

  test('independent radius is compiled into a new fixed reference, never read from current progress', () => {
    const small = radial(lateQ, circle), large = radial({ ...lateQ, controls: lateQ.controls.map(([x, y]) => [2 * x, 2 * y]) }, circle);
    expect(small.basins[1].birth).toBeCloseTo(20 / 21, 12);
    expect(large.basins[1].birth).toBeCloseTo(10 / 21, 12);
    const reference = JSON.stringify(small.basins);
    for (const p of [.999, .001, .95, .5]) evaluateClosingBirth(small, p);
    expect(JSON.stringify(small.basins)).toBe(reference);
    expect(evaluateClosingBirth(small, .5).cohorts[1].weight).toBe(0);
    expect(evaluateClosingBirth(large, .5).cohorts[1].weight).toBe(1);
  });

  test('opposite head can contain an entire Q without owning it: radial clipping would erase protected paint', () => {
    const shape = { points: [0, 0, 100, 0, 0, 0], curve: 'linear' as const,
      closed: false, cornerRadius: 25, strokeWidth: 20, startHead: 'triangle' as const, endHead: 'none' as const,
      _pathClosure: { progress: .5, fillOpacity: 0 } };
    const raw = nativePathGeometry(shape)!, head = pathArrowGeometry(shape).startGeo!.boundary!;
    const index = raw.spans.findIndex(s => s.role === 'end-corner');
    expect(raw.spans[index].controls).toEqual([[.25, 0], [0, 0], [0, 0]]);
    expect(nativeSpanInsideIntervals(raw.spans[index], head)).toEqual([[0, 1]]);
    expect(consumeNativeTerminals(raw, head).consumed[index]).toEqual([]);
    const result = homotheticQuadraticBirthFamily({ source: raw.spans[index], tip: [0, 0], oppositeBoundary: head, strokeWidth: 20 });
    expect(result.kind).toBe('unsupported');
  });

  test('actual tiny start-Q attachment is rejected rather than resetting the existing closing cohort', () => {
    const shape = { points: [0, .004, 100, .004, 100, .01, 0, .01], curve: 'linear' as const,
      closed: false, cornerRadius: 25, strokeWidth: 20, startHead: 'triangle' as const, endHead: 'triangle' as const };
    const at = (p: number) => nativePathGeometry({ ...shape, _pathClosure: { progress: p, fillOpacity: 0 } })!;
    const heads = pathArrowGeometry(shape);
    expect(at(.5).spans.at(-1)!.role).toBe('closing');
    expect(at(.5 + 1e-8).spans.at(-1)!.role).toBe('start-corner');
    expect(consumeNativeTerminals(at(.5 + 1e-8), heads.startGeo?.boundary, heads.endGeo?.boundary).runs.at(-1)!.map(p => p.span.role))
      .toEqual(['end-corner', 'closing', 'start-corner']);
    const result = completeManualClosingBirthFamily(at(1), 20, heads.startGeo?.boundary, heads.endGeo?.boundary);
    expect(result.kind).toBe('unsupported');
    if (result.kind === 'unsupported') expect(result.reason).toContain('no partial closure plan');
  });
});
