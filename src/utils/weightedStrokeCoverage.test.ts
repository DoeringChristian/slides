import { expect, test } from 'vitest';
import { collapsedCoverageCapVisible, coverageLayerSvg, weightedStrokeCoveragePlan, type CoveragePartition } from './weightedStrokeCoverage';
import { strokeCoverageDeviceBounds } from './canvasStrokeCoverage';
import { evaluateRoundedClosingBirth, roundedClosingBirthFamily } from './roundedClosingBirth';
import type { BirthSupport } from './closingBirthCohorts';
const value = <T>(r: BirthSupport<T>): T => { if (r.kind !== 'supported') throw Error(r.reason); return r.value; };
function partition(): CoveragePartition {
  const family = value(roundedClosingBirthFamily({ points: [0, 0, 100, 0, 100, 100], cornerRadius: 25, strokeWidth: 20, startHead: 'triangle', endHead: 'triangle' }, { geometry: 'fixed' }));
  return value(evaluateRoundedClosingBirth(family, .01));
}
test('certified complete partition preserves original clock, authored alpha and native controls', () => {
  const input = partition(), before = JSON.stringify(input), plan = value(weightedStrokeCoveragePlan(input, 20));
  expect(plan.length).toBe(input.length);
  expect(plan.layers.find(l => l.cohort === null)?.weight).toBe(1);
  expect(plan.layers.some(l => l.weight > 0 && l.weight < 1)).toBe(true);
  for (const f of input.fragments) expect(plan.layers.find(l => l.cohort === f.cohort)?.runs.some(r => r.d.includes(f.span.kind))).toBe(true);
  expect(JSON.stringify(input)).toBe(before);
});
test.each([
  ['missing fragment', (p: CoveragePartition) => { p.fragments.pop(); }],
  ['duplicate fragment', (p: CoveragePartition) => { p.fragments.push(p.fragments[0]); }],
  ['wrong weight', (p: CoveragePartition) => { p.cohorts[0].weight = 2; }],
  ['duplicate cohort', (p: CoveragePartition) => { p.cohorts.push(p.cohorts[0]); }],
  ['inactive ink', (p: CoveragePartition) => { p.cohorts[0].active = false; }],
  ['unknown owner', (p: CoveragePartition) => { p.fragments[0].cohort = 'unknown'; }],
  ['wrong clock', (p: CoveragePartition) => { p.length++; }],
  ['wrong offset', (p: CoveragePartition) => { p.fragments[0].offset++; }],
  ['wrong controls', (p: CoveragePartition) => { p.fragments[0].span.controls[0][0]++; }],
  ['nonfinite domain', (p: CoveragePartition) => { p.fragments[0].to = NaN; }],
  ['absent retained span', (p: CoveragePartition) => { p.paintConsumption.runs[0][0].spanIndex = 999; }],
  ['nonfinite retained domain', (p: CoveragePartition) => { p.paintConsumption.runs[0][0].to = NaN; }],
  ['nonfinite start', (p: CoveragePartition) => { p.painted.start[0] = Infinity; }],
] as const)('rejects %s atomically without throwing', (_, change) => {
  const p = structuredClone(partition()); change(p);
  expect(weightedStrokeCoveragePlan(p, 20).kind).toBe('unsupported');
});
test.each([0, -1, Infinity, NaN])('rejects invalid width %s', width => {
  expect(weightedStrokeCoveragePlan(partition(), width).kind).toBe('unsupported');
});
test('raw-positive collapsed prefixes retain caps at weight1, even across repeated evaluation', () => {
  const family = value(roundedClosingBirthFamily({ points: [0, 0, 100, 0, 100, .004, 0, .004], cornerRadius: 25, strokeWidth: 20, startHead: 'triangle', endHead: 'triangle' }, { geometry: 'fixed' }));
  for (const p of [1e-6, 1, 1e-6, 1]) {
    const plan = value(weightedStrokeCoveragePlan(value(evaluateRoundedClosingBirth(family, p)), 20));
    const layer = plan.layers.find(l => l.cohort !== null)!;
    expect(layer.runs.every(r => r.collapsedPoint !== undefined)).toBe(true);
    const svg = coverageLayerSvg(plan, layer.runs, [], 0);
    expect(svg).toContain('<circle'); expect(svg).toContain(`viewBox="${plan.bounds.x} ${plan.bounds.y} ${plan.bounds.width} ${plan.bounds.height}"`);
    if (p === 1) expect(layer.weight).toBe(1);
  }
});
test('collapsed caps respect full-clock dash/Create gaps and odd patterns', () => {
  expect(collapsedCoverageCapVisible(0, [])).toBe(true);
  expect(collapsedCoverageCapVisible(10, [0, 0])).toBe(true);
  for (const offset of [0, 9, 20, -11]) expect(collapsedCoverageCapVisible(offset, [10, 10])).toBe(true);
  for (const offset of [10, 19, -1]) expect(collapsedCoverageCapVisible(offset, [10, 10])).toBe(false);
  expect(collapsedCoverageCapVisible(15, [10])).toBe(false);
  expect(collapsedCoverageCapVisible(100, [100, 100])).toBe(false);
});
test('device bounds intersect viewport for translation, shear, rotation and offscreen geometry', () => {
  const plan = { bounds: { x: -1e8, y: -20, width: 2e8, height: 40 } };
  for (const m of [{ a: 1, b: .2, c: .3, d: 1, e: 10, f: 20 }, { a: 0, b: 2, c: -2, d: 0, e: 50, f: 50 }]) {
    const b = strokeCoverageDeviceBounds(plan, m, 320, 240);
    expect(b.width).toBeLessThanOrEqual(320); expect(b.height).toBeLessThanOrEqual(240);
    expect(b.x).toBeGreaterThanOrEqual(0); expect(b.y).toBeGreaterThanOrEqual(0);
  }
  expect(strokeCoverageDeviceBounds({ bounds: { x: 1000, y: 1000, width: 10, height: 10 } }, { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }, 320, 240)).toMatchObject({ width: 0, height: 0 });
});
test('fractional-width SVG inputs use integral enclosing viewports without rescaling', () => {
  const input = partition(), plan = value(weightedStrokeCoveragePlan(input, 5.7));
  expect(Object.values(plan.bounds).every(Number.isInteger)).toBe(true);
  for (const span of input.painted.spans) for (const [x, y] of span.controls) {
    expect(x).toBeGreaterThanOrEqual(plan.bounds.x);
    expect(x).toBeLessThanOrEqual(plan.bounds.x + plan.bounds.width);
    expect(y).toBeGreaterThanOrEqual(plan.bounds.y);
    expect(y).toBeLessThanOrEqual(plan.bounds.y + plan.bounds.height);
  }
  expect(coverageLayerSvg(plan, plan.layers[0].runs, [], 0)).toContain(`width="${plan.bounds.width}" height="${plan.bounds.height}"`);
});
test('late start island closure-coordinate round trips preserve exact retained endpoints', () => {
  const family = value(roundedClosingBirthFamily({ points: [0, 0, 100, 0, 0, 100], cornerRadius: 20, strokeWidth: 5.7, startHead: 'circle', endHead: 'none' }, { geometry: 'fixed' }));
  for (const progress of [.95, .99, .995, 1]) {
    const input = value(evaluateRoundedClosingBirth(family, progress));
    for (const [runIndex, run] of input.paintConsumption.runs.entries()) for (const part of run) {
      const fragments = input.fragments.filter(f => f.runIndex === runIndex && f.spanIndex === part.spanIndex);
      expect(fragments[0].from).toBe(part.from);
      expect(fragments.at(-1)!.to).toBe(part.to);
    }
    expect(weightedStrokeCoveragePlan(input, 5.7).kind).toBe('supported');
  }
});
