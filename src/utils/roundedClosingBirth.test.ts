import { describe, expect, test } from 'vitest';
import type { ArrowheadType } from '../types/presentation';
import { roundedClosingBirthFamily, evaluateRoundedClosingBirth, type RoundedBirthShape } from './roundedClosingBirth';
import type { BirthSupport } from './closingBirthCohorts';
import { nativePathGeometry, pathArrowGeometry } from './pathShapes';
import { consumeNativeTerminals, nativeBernsteinRoots, nativeSpanInsideIntervals, nativeSpanPart, serializeNativePath } from './nativePathSpans';
import { nativeSpanLength } from './nativeStrokePlan';
const value = <T>(result: BirthSupport<T>): T => {
  if (result.kind !== 'supported') throw new Error(result.reason);
  return result.value;
};
const shape = (points: number[], head: ArrowheadType = 'triangle'): RoundedBirthShape => ({
  points, curve: 'linear', cornerRadius: 25, strokeWidth: 20, startHead: head, endHead: head,
});
const compile = (s: RoundedBirthShape) => value(roundedClosingBirthFamily(s, { geometry: 'fixed' }));
const fixtures = [
  [0, 0, 100, 0, 100, 100], [0, 0, 100, 0, 100, 4, 0, 4],
  [0, 0, 100, 0, 100, .01, 0, .01], [0, .004, 100, .004, 100, .01, 0, .01],
  [0, 0, 100, 0, 100, .004, 0, .004],
];

describe('actual native rounded lifecycle', () => {
  test('protected extension playback returns unsupported rather than reinterpreting geometry or throwing', () => {
    // Structural typing preserves real playback markers outside RoundedBirthShape.
    const extension = { ...shape(fixtures[0]), _pathExtension: { startDirection: { dx: 1, dy: 0 }, endDirection: { dx: 0, dy: 1 } } };
    expect(nativePathGeometry(extension)).toBeNull();
    const result = roundedClosingBirthFamily(extension, { geometry: 'fixed' });
    expect(result.kind).toBe('unsupported');
    if (result.kind === 'unsupported') expect(result.reason).toContain('extension');
  });
  test.each(fixtures.map((points, i) => ({ points, i })))('supports original/tiny fixture $i at endpoints and one-sided limits', ({ points }) => {
    const family = compile(shape(points));
    for (const p of [0, 1e-9, 1e-6, .00001, .001, .1, .5, .5 + 1e-8, .95, 1 - 1e-9, 1]) {
      const plan = value(evaluateRoundedClosingBirth(family, p));
      expect(plan.cohorts.length).toBeGreaterThan(0);
      expect(plan.cohorts.every(c => c.weight >= 0 && c.weight <= 1)).toBe(true);
      if (p === 0) expect(plan.cohorts.every(c => !c.active && c.weight === 0)).toBe(true);
      if (p === 1 || p === 1 - 1e-9) expect(plan.cohorts.every(c => c.active && c.weight === 1)).toBe(true);
      const actual = nativePathGeometry({ ...shape(points), closed: p === 1, _pathClosure: { progress: p, fillOpacity: 0 } })!;
      expect(serializeNativePath(plan.raw)).toBe(serializeNativePath(actual));
      expect(plan.length).toBeCloseTo(plan.painted.spans.reduce((sum, s) => sum + nativeSpanLength(s), 0), 12);
      for (const part of plan.fragments) {
        expect(part.span.controls).toEqual(nativeSpanPart(plan.painted.spans[part.spanIndex], part.from, part.to).controls);
        const expectedOffset = plan.painted.spans.slice(0, part.spanIndex).reduce((sum, s) => sum + nativeSpanLength(s), 0)
          + nativeSpanLength(plan.painted.spans[part.spanIndex], part.from);
        expect(part.offset).toBeCloseTo(expectedOffset, 12);
        if (part.span.role === 'authored') expect(part.cohort).toBeNull();
      }
    }
  });

  test('tiny late start-Q extends the existing born connector cohort, without resetting its clock', () => {
    const family = compile(shape(fixtures[3]));
    const before = value(evaluateRoundedClosingBirth(family, .5));
    const after = value(evaluateRoundedClosingBirth(family, .5 + 1e-8));
    expect(before.raw.spans.at(-1)!.role).toBe('closing');
    const start = after.raw.spans.at(-1)!;
    expect(start.role).toBe('start-corner');
    expect(start.closureSource!.controls).toHaveLength(3);
    expect(start.closureSource!.to).toBeGreaterThan(0);
    expect(start.closureSource!.to).toBeLessThan(1e-6);
    expect(after.cohorts).toHaveLength(1);
    expect(after.cohorts[0].id).toBe('connector');
    expect(after.cohorts[0].budget).toBe(before.cohorts[0].budget);
    expect(before.cohorts[0].weight).toBe(1);
    expect(after.cohorts[0].weight).toBe(1);
    expect(after.fragments.filter(f => f.span.role === 'start-corner').every(f => f.cohort === 'connector')).toBe(true);
    expect(after.rawConsumption.runs.at(-1)!.map(p => p.span.role)).toEqual(['end-corner', 'closing', 'start-corner']);
  });

  test('positive raw / paint-point .004 target and early prefixes stay deliberately blended', () => {
    const family = compile(shape(fixtures[4]));
    const early = value(evaluateRoundedClosingBirth(family, 1e-6));
    expect(early.cohorts[0].rawLength).toBeGreaterThan(0);
    expect(early.cohorts[0].weight).toBeGreaterThan(0);
    expect(early.cohorts[0].weight).toBeLessThan(.001);
    const newPaint = early.fragments.filter(f => f.cohort !== null);
    expect(newPaint.length).toBeGreaterThan(0);
    expect(newPaint.every(f => f.length === 0)).toBe(true);
    const final = value(evaluateRoundedClosingBirth(family, 1));
    expect(final.cohorts[0].referenceLength).toBeGreaterThan(0);
    expect(final.cohorts[0].weight).toBe(1);
    expect(final.fragments.filter(f => f.cohort !== null).every(f => f.length === 0)).toBe(true);
  });

  test('actual opposite-head barrier preserves the end Q, without unioning head interiors', () => {
    const s = { ...shape([0, 0, 100, 0, 0, 0]), endHead: 'none' as const };
    const family = compile(s), plan = value(evaluateRoundedClosingBirth(family, .5));
    const end = plan.raw.spans.findIndex(p => p.role === 'end-corner');
    expect(plan.raw.spans[end].controls).toEqual([[.25, 0], [0, 0], [0, 0]]);
    expect(nativeSpanInsideIntervals(plan.raw.spans[end], family.start!)).toEqual([[0, 1]]);
    expect(plan.rawConsumption.consumed[end]).toEqual([]);
    expect(plan.fragments.some(f => f.span.role === 'end-corner' && f.length > 0 && f.cohort !== null)).toBe(true);
    expect(family.certificate).toBe('coincident-seam');
  });

  test('actual native end-Q island born after90% cannot borrow the connector weight', () => {
    const family = compile({ ...shape([0, 100, -100, 0, 0, 0], 'none'), endHead: 'circle', cornerRadius: 20, strokeWidth: 5.7 });
    expect(family.cohorts).toHaveLength(2);
    const young = family.members.find(m => m.role === 'end-corner' && m.domain[0] === 0)!.cohort;
    expect(young).not.toBe('connector');
    const at = value(evaluateRoundedClosingBirth(family, .95));
    expect(at.cohorts.find(c => c.id === 'connector')!.weight).toBe(1);
    expect(at.cohorts.find(c => c.id === young)!.weight).toBeCloseTo(0, 12);
    const after = value(evaluateRoundedClosingBirth(family, .95 + 1e-8));
    expect(after.cohorts.find(c => c.id === young)!.weight).toBeGreaterThan(0);
    expect(after.cohorts.find(c => c.id === young)!.weight).toBeLessThan(1e-6);
    expect(after.cohorts.find(c => c.id === 'connector')!.weight).toBe(1);
    expect(after.cohorts.map(c => c.budget)).toEqual(at.cohorts.map(c => c.budget));
    expect(value(evaluateRoundedClosingBirth(family, 1)).cohorts.every(c => c.weight === 1)).toBe(true);
  });

  test('a later start-Q basin waits for its drawn prefix, not merely its full-Q radial birth', () => {
    const family = compile({ ...shape([0, 0, 100, 0, 0, 100], 'none'), startHead: 'circle', cornerRadius: 20, strokeWidth: 5.7 });
    const young = family.members.find(m => m.role === 'start-corner' && m.domain[1] === 1)!.cohort;
    expect(young).not.toBe('connector');
    expect(family.cohorts).toHaveLength(2);
    for (const p of [.95, .99]) {
      const plan = value(evaluateRoundedClosingBirth(family, p));
      expect(plan.cohorts.find(c => c.id === young)!.weight).toBe(0);
      expect(plan.cohorts.find(c => c.id === 'connector')!.weight).toBe(1);
      // Analytic drawn front t=3.5-2.5/p still lies inside the circle, even
      // though the complete-Q later island has existed since p=.95.
      const t = 3.5 - 2.5 / p;
      expect(20 * p * (t ** 4 + (1 - t) ** 4) - 19 * t * t).toBeLessThan(0);
    }
    // Substitution of t=(7p-5)/(2p) into that circle equation yields
    // 60520p⁴-190924p³+227320p²-121900p+25000=0. These are its
    // Bernstein coefficients; the isolated root is not a sampled birth search.
    const roots = nativeBernsteinRoots([25000, -5475, 5810 / 3, -496, 16]).filter(p => p > .99 && p < .995);
    expect(roots).toHaveLength(1);
    const birth = roots[0];
    expect(value(evaluateRoundedClosingBirth(family, birth - 1e-8)).cohorts.find(c => c.id === young)!.weight).toBe(0);
    expect(value(evaluateRoundedClosingBirth(family, birth)).cohorts.find(c => c.id === young)!.weight).toBeCloseTo(0, 10);
    const justAfter = value(evaluateRoundedClosingBirth(family, birth + 1e-8)).cohorts.find(c => c.id === young)!;
    expect(justAfter.weight).toBeGreaterThan(0);
    expect(justAfter.weight).toBeLessThan(1e-6);
    const after = value(evaluateRoundedClosingBirth(family, .995));
    expect(after.cohorts.find(c => c.id === young)!.weight).toBeGreaterThan(0);
    expect(after.cohorts.find(c => c.id === young)!.rawLength).toBeGreaterThan(0);
    expect(after.cohorts.find(c => c.id === 'connector')!.weight).toBe(1);
    expect(value(evaluateRoundedClosingBirth(family, .99)).cohorts.find(c => c.id === young)!.weight).toBe(0);
  });

  test('actual Q islands merge/reverse-split but keep distinct complete-source clocks', () => {
    const family = compile({ ...shape([0, 100, -100, 0, 0, 0], 'none'), endHead: 'circle', cornerRadius: 25, strokeWidth: 3 });
    const before = value(evaluateRoundedClosingBirth(family, .9));
    const after = value(evaluateRoundedClosingBirth(family, 1));
    const endParts = (plan: typeof before) => plan.rawConsumption.runs.flat().filter(p => p.span.role === 'end-corner');
    expect(endParts(before)).toHaveLength(2);
    expect(endParts(after)).toHaveLength(1);
    expect(after.fragments.filter(f => f.span.role === 'end-corner').map(f => f.cohort)).toHaveLength(2);
    expect(new Set(after.fragments.filter(f => f.span.role === 'end-corner').map(f => f.cohort)).size).toBe(2);
    expect(before.cohorts.map(c => [c.id, c.budget])).toEqual(after.cohorts.map(c => [c.id, c.budget]));
    expect(value(evaluateRoundedClosingBirth(family, .9))).toEqual(before);
  });

  test('tiny circle painted residue without an active raw basin fails the whole plan', () => {
    const family = compile(shape(fixtures[4], 'circle'));
    const result = evaluateRoundedClosingBirth(family, 1);
    expect(result.kind).toBe('unsupported');
    if (result.kind === 'unsupported') expect(result.reason).toContain('Painted domain lacks an active certified raw cohort');
    // Unlike the supported triangle .004 fixture, conservative painted
    // ownership leaves an unmatched circle residue. Never lend it a mature
    // neighbouring cohort's weight or erase it to manufacture a success.
  });

  test('absent raw target does not manufacture an opaque zero cohort or redefine static zero paint', () => {
    const family = compile(shape([0, 0, 0, 0, 0, 0], 'none'));
    expect(family.cohorts).toEqual([]);
    expect(value(evaluateRoundedClosingBirth(family, 0)).cohorts).toEqual([]);
    // Static zero geometry is left to its existing renderer, not silently
    // discarded or manufactured as an active birth by this helper.
    expect(evaluateRoundedClosingBirth(family, 1).kind).toBe('unsupported');
  });

  test('metadata recovers the complete current start-Q, not a reparameterized drawn prefix', () => {
    const family = compile(shape(fixtures[3]));
    const p = .7, plan = value(evaluateRoundedClosingBirth(family, p));
    const start = plan.raw.spans.find(s => s.role === 'start-corner')!;
    const full = nativePathGeometry({ ...family.shape, closed: true })!.spans.find(s => s.role === 'start-corner')!;
    expect(start.closureSource!.to).toBeCloseTo(4 / 7, 13);
    expect(start.closureSource!.controls[0][1]).toBeCloseTo(.0061, 14);
    expect(start.closureSource!.controls[1]).toEqual([0, .004]);
    expect(start.closureSource!.controls[2][0]).toBeCloseTo(.0021, 14);
    const tip = family.shape.points!.slice(0, 2);
    full.controls.forEach((point, i) => {
      for (const axis of [0, 1]) expect(start.closureSource!.controls[i][axis]).toBeCloseTo(tip[axis] + p * (point[axis] - tip[axis]), 14);
    });
    const prefix = nativeSpanPart({ ...start, controls: start.closureSource!.controls }, 0, start.closureSource!.to);
    prefix.controls.forEach((point, i) => point.forEach((v, axis) => expect(start.controls[i][axis]).toBeCloseTo(v, 14)));
  });

  test('const/reverse/out-of-order evaluation and prefix metadata are history-free', () => {
    const family = compile(shape(fixtures[3]));
    const snapshot = JSON.stringify(family);
    const ps = [0, 1e-9, .001, 1 / 3, .5, .5 + 1e-8, .9, 1 - 1e-9, 1];
    const forward = ps.map(p => value(evaluateRoundedClosingBirth(family, p)));
    expect([...ps].reverse().map(p => value(evaluateRoundedClosingBirth(family, p)))).toEqual([...forward].reverse());
    for (const i of [8, 0, 6, 4, 4, 2, 1]) expect(value(evaluateRoundedClosingBirth(family, ps[i]))).toEqual(forward[i]);
    expect(JSON.stringify(family)).toBe(snapshot);
  });

  const heads: ArrowheadType[] = ['none', 'arrow', 'triangle', 'triangle-outline', 'bar', 'dot', 'circle', 'circle-outline', 'diamond', 'diamond-outline', 'crowfoot-one', 'crowfoot-many', 'crowfoot-one-many'];
  test.each(heads)('actual %s head: own-side exposed-ray certification and positive whole evaluation', head => {
    const family = compile(shape(fixtures[1], head));
    for (const p of [1e-6, .5, 1]) expect(value(evaluateRoundedClosingBirth(family, p)).cohorts.every(c => c.active)).toBe(true);
  });

  test('inward ray counterexample is rejected before its start-Q side-ownership event', () => {
    const s = shape([0, 0, 100, 0, 10, 0]);
    const result = roundedClosingBirthFamily(s, { geometry: 'fixed' });
    expect(result.kind).toBe('unsupported');
    const heads = pathArrowGeometry({ ...s, closed: false });
    const closingLength = (p: number) => {
      const raw = nativePathGeometry({ ...s, closed: false, _pathClosure: { progress: p, fillOpacity: 0 } })!;
      return consumeNativeTerminals(raw, heads.startGeo?.boundary, heads.endGeo?.boundary).runs.flat()
        .filter(part => part.span.role === 'closing').reduce((sum, part) => sum + nativeSpanLength(part.span), 0);
    };
    expect(closingLength(.5 - 1e-8)).toBeGreaterThan(4.99);
    expect(closingLength(.5 + 1e-8)).toBe(0);
  });

  test('independently animated geometry is not silently assigned current-frame reference budgets', () => {
    expect(roundedClosingBirthFamily(shape(fixtures[0]), { geometry: 'animated' }).kind).toBe('unsupported');
    const s = { ...shape([0, 100, -100, 0, 0, 0], 'none'), endHead: 'circle' as const, cornerRadius: 19, strokeWidth: 5.7 };
    const at = compile(s), after = compile({ ...s, cornerRadius: 19 + 1e-5 });
    // At fixed closure p=1, rebuilding as radius creates a new target basin
    // gives its arbitrarily tiny extent weight1 immediately. This is NOT a
    // temporal birth clock for radius animation, so that integration is barred.
    expect(after.cohorts.length).toBeGreaterThan(at.cohorts.length);
    const fresh = after.cohorts.find(c => !at.cohorts.some(a => a.id === c.id))!;
    expect(fresh.referenceLength).toBeLessThan(.001);
    expect(value(evaluateRoundedClosingBirth(after, 1)).cohorts.find(c => c.id === fresh.id)!.weight).toBe(1);
  });
});
