import type { ShapeElement } from '../types/presentation';
import { nativePathGeometry, pathArrowGeometry } from './pathShapes';
import {
  consumeNativeTerminals, nativeSpanPart, paintedNativePath,
  type NativePath, type NativeSpanRole, type RetainedNativeSpan, type SpanBoundary, type SpanInterval,
} from './nativePathSpans';
import { nativeSpanLength } from './nativeStrokePlan';
import { closingBirthEndpointExit, homotheticQuadraticBirthFamily, type BirthSupport } from './closingBirthCohorts';

export type RoundedBirthShape = Pick<ShapeElement, 'points' | 'curve' | 'cornerRadius' | 'strokeWidth' | 'startHead' | 'endHead'>;
export interface RoundedBirthMember {
  role: NativeSpanRole;
  index: number;
  /** Complete Q parameter domain, not a parameter of its drawn prefix. */
  domain: SpanInterval;
  cohort: string;
}
export interface RoundedBirthCohort {
  id: string;
  referenceLength: number;
  budget: number;
}
export interface RoundedClosingBirthFamily {
  /** Fixed snapshot: callers cannot replace points/radius/heads per evaluation. */
  shape: RoundedBirthShape;
  start?: SpanBoundary;
  end?: SpanBoundary;
  members: RoundedBirthMember[];
  cohorts: RoundedBirthCohort[];
  certificate: 'exposed-seam-rays' | 'coincident-seam';
}
export interface RoundedBirthFragment extends RetainedNativeSpan {
  runIndex: number;
  cohort: string | null;
  offset: number;
  length: number;
}
export interface RoundedClosingBirthPlan {
  progress: number;
  raw: NativePath;
  painted: NativePath;
  rawConsumption: ReturnType<typeof consumeNativeTerminals>;
  paintConsumption: ReturnType<typeof consumeNativeTerminals>;
  cohorts: (RoundedBirthCohort & { rawLength: number; weight: number; active: boolean })[];
  fragments: RoundedBirthFragment[];
  /** Original current-frame native clock INCLUDING consumed intervals. */
  length: number;
}
const no = (reason: string): BirthSupport<never> => ({ kind: 'unsupported', reason });
const yes = <T>(value: T): BirthSupport<T> => ({ kind: 'supported', value });
const intersect = ([a, b]: SpanInterval, [c, d]: SpanInterval): SpanInterval | undefined => {
  const from = Math.max(a, c), to = Math.min(b, d);
  return to > from ? [from, to] : undefined;
};
const geometry = (shape: RoundedBirthShape, progress: number) => nativePathGeometry({ ...shape,
  closed: progress === 1, _pathClosure: { progress, fillOpacity: 0 },
});
const key = (m: Pick<RoundedBirthMember, 'role' | 'index' | 'domain'>) => `${m.role}:${m.index}:${m.domain.join(':')}`;

/** Certified fixed-geometry subset, not a fallback for all rounded paths.
 * Each own-head seam-facing ray must exit at scale0. Convexity then proves it
 * stays outside for EVERY p>0, so neither side can seed ownership on closing L.
 * The opposite Q is protected by consumeNativeTerminals' side-specific barrier.
 * Internal Q basins remain separate even after retained islands merge.
 */
export function roundedClosingBirthFamily(shape: RoundedBirthShape,
  options: { geometry: 'fixed' | 'animated' }): BirthSupport<RoundedClosingBirthFamily> {
  if (options.geometry !== 'fixed') return no('Independently animated points/radius/heads need a temporal reference family; rebuilding current budgets is not continuous');
  if ((shape.curve ?? 'linear') !== 'linear' || !shape.points || shape.points.length < 6
    || shape.points.length % 2 || !shape.points.every(Number.isFinite) || !(shape.cornerRadius > 0)
    || !Number.isFinite(shape.cornerRadius) || !(shape.strokeWidth > 0) || !Number.isFinite(shape.strokeWidth)) return no('Requires finite rounded linear geometry and positive effective width');
  try {
    const snapshot: RoundedBirthShape = { ...shape, points: [...shape.points] };
    Object.freeze(snapshot.points); Object.freeze(snapshot);
    const full = geometry(snapshot, 1);
    if (!full) return no('Native geometry is unsupported (including protected path extension playback)');
    const heads = pathArrowGeometry({ ...snapshot, closed: false });
    const start = heads.startGeo?.boundary, end = heads.endGeo?.boundary;
    const closing = full.spans.find(s => s.role === 'closing')!;
    const first: [number, number] = [snapshot.points![0], snapshot.points![1]];
    const last: [number, number] = [snapshot.points!.at(-2)!, snapshot.points!.at(-1)!];
    const coincident = first[0] === last[0] && first[1] === last[1];
    const members: RoundedBirthMember[] = [];
    const cornerFamilies = (['end-corner', 'start-corner'] as const).map(role => {
      const source = full.spans.find(s => s.role === role)!;
      return { role, source, result: homotheticQuadraticBirthFamily({ source,
        tip: role === 'start-corner' ? first : last,
        boundary: role === 'start-corner' ? start : end, strokeWidth: snapshot.strokeWidth,
      }) };
    });
    for (const corner of cornerFamilies) if (corner.result.kind === 'unsupported') return corner.result;
    // Opposite heads are deliberately NOT sent into radial clipping. Their
    // graph barrier is evaluated by the existing raw/paint ownership routine.
    for (const corner of cornerFamilies) {
      if (corner.result.kind !== 'supported') continue;
      const family = corner.result.value;
      const endpoint = corner.role === 'end-corner' ? 1 : 0;
      if (!coincident) {
        const exit = closingBirthEndpointExit(family, endpoint);
        if (exit.kind === 'unsupported') return exit;
        if (exit.value !== 0) return no(`Inward or boundary-following ${corner.role} seam ray: side-specific closing-L/start-Q ownership events are not certified`);
      }
      for (const b of family.basins) {
        const member = { role: corner.role, index: corner.source.index, domain: [...b.domain] as SpanInterval };
        // Only the exposed connector-facing basin shares the connector seed.
        // Another radial minimum NEVER inherits that clock after a merger.
        const attached = !coincident && (endpoint === 0 ? b.domain[0] === 0 : b.domain[1] === 1);
        members.push({ ...member, cohort: attached ? 'connector' : key(member) });
      }
    }
    if (!coincident) members.push({ role: 'closing', index: closing.index, domain: [0, 1], cohort: 'connector' });
    // A coincident seam has no connector extent and does not join two birth
    // seeds merely because their coordinates agree. Owned zero spans stay in
    // native consumption; a retained zero span is not a new raw-positive cohort.
    const provisional: RoundedClosingBirthFamily = { shape: snapshot, start, end, members, cohorts: [],
      certificate: coincident ? 'coincident-seam' : 'exposed-seam-rays' };
    const lengths = rawExtents(provisional, full, consumeNativeTerminals(full, start, end));
    if (lengths.kind === 'unsupported') return lengths;
    const cohorts = [...new Set(members.map(m => m.cohort))].map(id => {
      const referenceLength = lengths.value.get(id) ?? 0;
      return { id, referenceLength, budget: Math.min(snapshot.strokeWidth, .1 * referenceLength) };
    });
    if (cohorts.some(c => !Number.isFinite(c.referenceLength) || (c.referenceLength > 0 && c.budget === 0))) return no('Unrepresentable rounded reference extent');
    provisional.cohorts = cohorts.filter(c => c.referenceLength > 0);
    return yes(provisional);
  } catch (error) {
    if (error instanceof RangeError) return no('Unrepresentable rounded family arithmetic');
    throw error;
  }
}

/** Prefix intersection cannot merge radial basins. For D>0, start-Q's drawn
 * parameter has derivative (D/p² + kS-cE-cS)/kS > 0: kS>=cS and cE<=D/2.
 * Thus each later basin is first revealed with zero extent, not the connector's
 * mature clock; no sampled search for its front/radial intersection is needed. */
function domains(family: RoundedClosingBirthFamily, path: NativePath, part: RetainedNativeSpan) {
  const source = path.spans[part.spanIndex];
  const to = source.closureSource?.to ?? 1;
  const pieces = family.members.filter(m => m.role === source.role && m.index === source.index).flatMap(m => {
    const interval = intersect([part.from * to, part.to * to], m.domain);
    return interval && to > 0 ? [{ from: interval[0] / to, to: interval[1] / to, cohort: m.cohort }] : [];
  });
  return pieces;
}
function rawExtents(family: RoundedClosingBirthFamily, raw: NativePath,
  consumption: ReturnType<typeof consumeNativeTerminals>): BirthSupport<Map<string, number>> {
  const lengths = new Map<string, number>();
  for (const part of consumption.runs.flat()) {
    if (part.span.role === 'authored') continue;
    const pieces = domains(family, raw, part);
    let cursor = part.from;
    for (const piece of pieces) {
      if (Math.abs(piece.from - cursor) > 2 ** -42) return no('Raw source domain is outside the certified lifecycle');
      const length = nativeSpanLength(nativeSpanPart(raw.spans[part.spanIndex], piece.from, piece.to));
      if (!Number.isFinite(length)) return no('Unrepresentable current raw extent');
      lengths.set(piece.cohort, (lengths.get(piece.cohort) ?? 0) + length);
      cursor = piece.to;
    }
    if (Math.abs(cursor - part.to) > 2 ** -42 && nativeSpanLength(part.span) > 0) return no('Positive raw source has no certified birth seed');
  }
  return yes(lengths);
}

/** Real native geometry + independent raw/painted ownership at arbitrary p.
 * No history or geometry overrides. A caller must retain this fixed family;
 * compiling a new family each animated-radius frame is explicitly not covered.
 */
export function evaluateRoundedClosingBirth(family: RoundedClosingBirthFamily, progress: number): BirthSupport<RoundedClosingBirthPlan> {
  if (!Number.isFinite(progress) || progress < 0 || progress > 1) return no('Invalid rounded closure progress');
  try {
    const raw = geometry(family.shape, progress);
    if (!raw) return no('Native geometry is unsupported (including protected path extension playback)');
    const painted = paintedNativePath(raw);
    const rawConsumption = consumeNativeTerminals(raw, family.start, family.end);
    const paintConsumption = consumeNativeTerminals(painted, family.start, family.end);
    const lengths = rawExtents(family, raw, rawConsumption);
    if (lengths.kind === 'unsupported') return lengths;
    const cohorts = family.cohorts.map(c => {
      const rawLength = lengths.value.get(c.id) ?? 0;
      const u = Math.min(1, rawLength / c.budget);
      return { ...c, rawLength, weight: u * u * (3 - 2 * u), active: rawLength > 0 };
    });
    const offsets = [0];
    for (const span of painted.spans) offsets.push(offsets.at(-1)! + nativeSpanLength(span));
    if (!Number.isFinite(offsets.at(-1)!)) return no('Unrepresentable original paint clock');
    const fragments: RoundedBirthFragment[] = [];
    for (const [runIndex, run] of paintConsumption.runs.entries()) for (const part of run) {
      const original = painted.spans[part.spanIndex];
      const emit = (from: number, to: number, cohort: string | null) => fragments.push({ spanIndex: part.spanIndex, from, to,
        span: nativeSpanPart(original, from, to), runIndex, cohort,
        offset: offsets[part.spanIndex] + nativeSpanLength(original, from), length: nativeSpanLength(nativeSpanPart(original, from, to)),
      });
      if (part.span.role === 'authored') { emit(part.from, part.to, null); continue; }
      const pieces = domains(family, raw, part);
      let cursor = part.from;
      for (const piece of pieces) {
        const cohort = cohorts.find(c => c.id === piece.cohort);
        if (Math.abs(piece.from - cursor) > 2 ** -42 || !cohort?.active) return no('Painted domain lacks an active certified raw cohort; no opacity fallback');
        // domains maps through closure-source coordinates; its round trip can
        // differ by an ulp. Keep the certified retained partition endpoints
        // exact rather than exporting a microscopic gap/overlap to consumers.
        const to = Math.abs(piece.to - part.to) <= 2 ** -42 ? part.to : piece.to;
        emit(cursor, to, piece.cohort); cursor = to;
      }
      if (Math.abs(cursor - part.to) > 2 ** -42) {
        // Absence of a raw target is not an authored/static zero-path policy.
        // Do not manufacture active coverage or silently erase native paint.
        return no('Retained painted zero/unmapped source requires static-zero integration policy');
      }
    }
    return yes({ progress, raw, painted, rawConsumption, paintConsumption, cohorts, fragments, length: offsets.at(-1)! });
  } catch (error) {
    if (error instanceof RangeError) return no('Unrepresentable rounded evaluation arithmetic');
    throw error;
  }
}
