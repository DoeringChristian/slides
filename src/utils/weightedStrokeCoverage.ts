import type { BirthSupport } from './closingBirthCohorts';
import { nativeSpanPart, type NativePath, type NativePoint, type RetainedNativeSpan } from './nativePathSpans';
import { nativeSpanLength, nativeStrokeBounds, type NativeStrokePlan, type NativeStrokeRun } from './nativeStrokePlan';

export interface CoverageFragment extends RetainedNativeSpan {
  runIndex: number;
  cohort: string | null;
  offset: number;
  length: number;
}
export interface WeightedCoverageRun extends NativeStrokeRun {
  /** Intentional raw-positive birth ink, NOT a native authored zero path. */
  collapsedPoint?: NativePoint;
}
export interface WeightedStrokeCoveragePlan {
  kind: 'weighted-stroke-coverage';
  layers: { cohort: string | null; weight: number; runs: WeightedCoverageRun[] }[];
  length: number;
  bounds: NativeStrokePlan['bounds'];
  strokeWidth: number;
}
export interface CoveragePartition {
  painted: NativePath;
  paintConsumption: { runs: RetainedNativeSpan[][] };
  fragments: CoverageFragment[];
  cohorts: { id: string; weight: number; active: boolean }[];
  length: number;
}

/** Explicit adapter for an ALREADY certified complete partition. Does not infer
 * a fixed-source family from a current element, recompute terminal ownership,
 * or select birth policy. Atomic validation prevents partially weighted paint.
 * RoundedClosingBirthPlan satisfies this contract without geometry conversion. */
export function weightedStrokeCoveragePlan(input: CoveragePartition, width: number): BirthSupport<WeightedStrokeCoveragePlan> {
  const no = (reason: string): BirthSupport<never> => ({ kind: 'unsupported', reason });
  if (!Number.isFinite(width) || width <= 0) return no('Coverage requires finite positive width');
  const { painted, fragments, cohorts } = input;
  if (!painted.start.every(Number.isFinite) || painted.spans.some(s => s.controls.length !== ({ L: 2, Q: 3, C: 4 }[s.kind]) || !s.controls.flat().every(Number.isFinite))) return no('Invalid native paint controls');
  const weights = new Map<string | null, number>([[null, 1]]);
  for (const c of cohorts) {
    if (!c.id || weights.has(c.id) || !Number.isFinite(c.weight) || c.weight < 0 || c.weight > 1 || (!c.active && c.weight !== 0)) return no('Invalid or duplicate coverage cohort');
    weights.set(c.id, c.weight);
  }
  const offsets = [0];
  for (const span of painted.spans) offsets.push(offsets.at(-1)! + nativeSpanLength(span));
  if (!Number.isFinite(input.length) || input.length !== offsets.at(-1)) return no('Coverage must retain the full original paint clock');
  let cursor = 0;
  // Compare the partition against the independently retained domains. No gap,
  // overlap, or omitted run (including a zero-length retained span) is allowed.
  for (const [runIndex, run] of input.paintConsumption.runs.entries()) for (const part of run) {
    if (!Number.isInteger(part.spanIndex) || !painted.spans[part.spanIndex]
      || !(part.from >= 0 && part.to <= 1 && part.to > part.from)) return no('Invalid retained coverage domain');
    let from = part.from;
    do {
      const f = fragments[cursor++], source = painted.spans[part.spanIndex];
      if (!f || f.runIndex !== runIndex || f.spanIndex !== part.spanIndex || f.from !== from || !(f.to > f.from) || !(f.to <= part.to)
        || !weights.has(f.cohort) || (source.role === 'authored') !== (f.cohort === null)
        || (f.cohort !== null && !cohorts.find(c => c.id === f.cohort)?.active)) return no('Coverage fragments do not exactly partition retained ownership');
      const expected = nativeSpanPart(source, f.from, f.to);
      if (f.span.kind !== expected.kind || JSON.stringify(f.span.controls) !== JSON.stringify(expected.controls)
        || f.offset !== offsets[f.spanIndex] + nativeSpanLength(source, f.from) || f.length !== nativeSpanLength(expected)) return no('Coverage fragment controls or original offsets differ');
      from = f.to;
    } while (from < part.to);
  }
  if (cursor !== fragments.length) return no('Coverage contains extra fragments');
  const layers: WeightedStrokeCoveragePlan['layers'] = [];
  let previous: CoverageFragment | undefined, current: WeightedCoverageRun | undefined;
  const point = (p: NativePoint) => p.join(' ');
  for (const f of fragments) {
    let layer = layers.find(l => l.cohort === f.cohort);
    if (!layer) { layer = { cohort: f.cohort, weight: weights.get(f.cohort)!, runs: [] }; layers.push(layer); }
    const origin = f.span.controls[0];
    const collapsed = f.cohort !== null && f.span.controls.every(p => p[0] === origin[0] && p[1] === origin[1]);
    if (!previous || previous.runIndex !== f.runIndex || previous.cohort !== f.cohort) {
      current = { d: `M ${point(origin)}`, offset: f.offset, length: 0, ...(collapsed ? { collapsedPoint: [...origin] as NativePoint } : {}) };
      layer.runs.push(current);
    } else if (!collapsed || current!.collapsedPoint?.some((v, i) => v !== origin[i])) delete current!.collapsedPoint;
    current!.d += ` ${f.span.kind} ${f.span.controls.slice(1).map(point).join(' ')}`;
    current!.length += f.length;
    previous = f;
  }
  // Embedded SVG filter images must have integral intrinsic viewports. A
  // fractional intrinsic size is rounded by the image rasterizer, rescaling
  // coverage relative to the outer filter (especially visible on thin strokes).
  const b = nativeStrokeBounds(painted, width);
  const x = Math.floor(b.x), y = Math.floor(b.y);
  const bounds = { x, y, width: Math.ceil(b.x + b.width) - x, height: Math.ceil(b.y + b.height) - y };
  return { kind: 'supported', value: { kind: 'weighted-stroke-coverage', layers, length: input.length,
    bounds, strokeWidth: width } };
}

/** A collapsed raw-positive span still has a cap, but never inside a dash or
 * Create gap. Offsets remain distances along the original unconsumed clock. */
export function collapsedCoverageCapVisible(offset: number, dash: readonly number[]): boolean {
  if (!dash.length || dash.every(n => n === 0)) return true;
  const pattern = dash.length % 2 ? [...dash, ...dash] : dash;
  const period = pattern.reduce((a, b) => a + b, 0);
  let phase = ((offset % period) + period) % period;
  for (let i = 0; i < pattern.length; i++) {
    if (phase < pattern[i]) return i % 2 === 0;
    phase -= pattern[i];
  }
  return true;
}

/** SVG filter inputs have identical explicit viewports, not fragment bounding
 * boxes (which would stretch disjoint cohorts into different coordinates). */
export function coverageLayerSvg(plan: WeightedStrokeCoveragePlan, runs: WeightedCoverageRun[], dash: readonly number[], offset: number): string {
  const b = plan.bounds;
  const paths = runs.map(run => run.collapsedPoint
    ? collapsedCoverageCapVisible(offset + run.offset, dash) ? `<circle cx="${run.collapsedPoint[0]}" cy="${run.collapsedPoint[1]}" r="${plan.strokeWidth / 2}" fill="white"/>` : ''
    : `<path d="${run.d}" fill="none" stroke="white" stroke-width="${plan.strokeWidth}" stroke-linecap="round" stroke-linejoin="round" stroke-dasharray="${dash.length ? dash.join(' ') : 'none'}" stroke-dashoffset="${offset + run.offset}"/>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${b.width}" height="${b.height}" viewBox="${b.x} ${b.y} ${b.width} ${b.height}">${paths}</svg>`;
}
