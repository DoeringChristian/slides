import {
  consumeNativeTerminals, nativeBernsteinRoots, nativeSpanInsideIntervals, nativeSpanPart,
  nativeSpanPoint, type NativePath, type NativePathSpan, type NativePoint,
  type RetainedNativeSpan, type SpanBoundary, type SpanInterval,
} from './nativePathSpans';
import { nativeSpanLength } from './nativeStrokePlan';

/** Transient source-parameter provenance, NOT a presentation field or a paint
 * ownership rule. These primitives intentionally do not select a renderer. */
export type BirthSupport<T> = { kind: 'supported'; value: T } | { kind: 'unsupported'; reason: string };
export interface BirthBasin {
  /** Full source parameter domain. Identity is this domain + source role/index,
   * never the ordinal of a moving root, rendered run, or nearest coordinate. */
  domain: SpanInterval;
  birth: number;
  referenceLength: number;
  budget: number;
}
export interface ClosingBirthFamily {
  mode: 'manual-prefix' | 'homothetic-Q';
  source: NativePathSpan;
  basins: BirthBasin[];
  tip?: NativePoint;
  boundary?: SpanBoundary;
}
export interface ClosingBirthCohort {
  domain: SpanInterval;
  birth: number;
  rawDomains: SpanInterval[];
  rawLength: number;
  referenceLength: number;
  budget: number;
  weight: number;
  /** Positive raw extent must carry blended coverage even if the serialized
   * path is a point. This does not authorize an opaque zero-length ghost. */
  active: boolean;
}
export interface ClosingBirthEvaluation {
  source: Pick<NativePathSpan, 'role' | 'index'>;
  progress: number;
  cohorts: ClosingBirthCohort[];
}
const unsupported = (reason: string): BirthSupport<never> => ({ kind: 'unsupported', reason });
const supported = <T>(value: T): BirthSupport<T> => ({ kind: 'supported', value });
const copySpan = (s: NativePathSpan): NativePathSpan => ({ ...s,
  controls: s.controls.map(p => [...p]), sourceControls: s.sourceControls?.map(p => [...p]),
});
const copyBoundary = (b: SpanBoundary | undefined): SpanBoundary | undefined => b && ('points' in b ? { points: [...b.points] } : { ...b });
const validSource = (s: NativePathSpan) => s.controls.length === ({ L: 2, Q: 3, C: 4 }[s.kind])
  && s.controls.flat().every(Number.isFinite);
const validWidth = (w: number) => Number.isFinite(w) && w > 0;
const lengthBetween = (s: NativePathSpan, a: number, b: number) => nativeSpanLength(nativeSpanPart(s, a, b));
const intersection = ([a, b]: SpanInterval, [c, d]: SpanInterval): SpanInterval[] => Math.min(b, d) > Math.max(a, c)
  ? [[Math.max(a, c), Math.min(b, d)]] : [];
const complement = (inside: SpanInterval[]): SpanInterval[] => {
  const result: SpanInterval[] = [];
  let a = 0;
  for (const [b, c] of [...inside, [1, 1]]) { if (b > a) result.push([a, b]); a = c; }
  return result;
};
const outside = (s: NativePathSpan, b?: SpanBoundary): SpanInterval[] => b ? complement(nativeSpanInsideIntervals(s, b)) : [[0, 1]];
const basin = (domain: SpanInterval, birth: number, referenceLength: number, width: number): BirthBasin => ({
  domain, birth, referenceLength, budget: Math.min(width, .1 * referenceLength),
});

/** Complete-source retained intervals are an INPUT from the ownership layer.
 * They must not be computed on the moving prefix. Each separated interval has
 * its own clock, including a later interval on the same looping C. */
export function manualClosingBirthFamily(source: NativePathSpan, retained: SpanInterval[], strokeWidth: number): BirthSupport<ClosingBirthFamily> {
  if (source.role !== 'closing' || !['L', 'C'].includes(source.kind) || !validSource(source)) return unsupported('Manual birth requires a complete closing L or C');
  if (!validWidth(strokeWidth)) return unsupported('Birth budget requires finite positive stroke width');
  if (source.sourceTo !== undefined && source.sourceTo !== 1) return unsupported('Manual source must be complete, not the currently drawn prefix');
  if (source.sourceControls && JSON.stringify(source.controls) !== JSON.stringify(source.sourceControls)) return unsupported('Manual controls do not equal the complete source');
  let previous = -1;
  for (const [a, b] of retained) {
    if (!(0 <= a && a < b && b <= 1 && a > previous)) return unsupported('Retained complete-source domains must be ordered, disjoint and non-touching');
    previous = b;
  }
  try {
    const references = retained.map(([a, b]) => basin([a, b], a, lengthBetween(source, a, b), strokeWidth));
    if (references.some(b => !Number.isFinite(b.referenceLength) || (b.referenceLength > 0 && b.budget === 0))) return unsupported('Unrepresentable raw reference length or birth budget');
    return supported({ mode: 'manual-prefix', source: copySpan(source), basins: references.filter(b => b.referenceLength > 0) });
  } catch (error) {
    if (error instanceof RangeError) return unsupported('Unrepresentable manual extent arithmetic');
    throw error;
  }
}

/** Ownership adapter for the supported manual topology. Rounded cross-span
 * attachment and opposite-head propagation have NOT been certified. */
export function completeManualClosingBirthFamily(path: NativePath, strokeWidth: number, start?: SpanBoundary, end?: SpanBoundary): BirthSupport<ClosingBirthFamily> {
  if (path.paintSource) return unsupported('Ownership source must be unquantized');
  const last = path.spans.at(-1);
  if (!path.closed) return unsupported('Manual ownership adapter requires the complete closed source path');
  if (!last || path.spans.slice(0, -1).some(s => s.role !== 'authored') || last.role !== 'closing') {
    return unsupported('Rounded closing-L/start-Q attachment and opposite-head lifecycle are unresolved; no partial closure plan');
  }
  try {
    const retained = consumeNativeTerminals(path, start, end).runs.flat()
      .filter(p => p.spanIndex === path.spans.length - 1).map(p => [p.from, p.to] as SpanInterval);
    return manualClosingBirthFamily(last, retained, strokeWidth);
  } catch (error) {
    if (error instanceof RangeError) return unsupported('Unrepresentable complete-source ownership arithmetic');
    throw error;
  }
}

// Bernstein algebra keeps the radial event polynomials in the same basis as
// the existing derivative-isolating root solver (no sampled event searches).
const choose = (n: number, k: number): number => {
  let v = 1;
  for (let i = 1; i <= k; i++) v = v * (n - i + 1) / i;
  return v;
};
const product = (a: number[], b: number[]): number[] => Array.from({ length: a.length + b.length - 1 }, (_, k) => {
  const n = a.length - 1, m = b.length - 1;
  let v = 0;
  for (let i = Math.max(0, k - m); i <= Math.min(n, k); i++) v += a[i] * b[k - i] * choose(n, i) * choose(m, k - i) / choose(n + m, k);
  return v;
});
const derivative = (a: number[]) => a.slice(1).map((v, i) => (a.length - 1) * (v - a[i]));
const add = (a: number[], b: number[], factor = 1) => a.map((v, i) => v + factor * b[i]);
const scale = (a: number[], v: number) => a.map(x => x * v);
const knots = (ts: number[]) => [0, ...ts.filter(t => t > 0 && t < 1), 1].sort((a, b) => a - b)
  .filter((t, i, a) => !i || t - a[i - 1] > 2 ** -44);
interface RadialExit { exit: (t: number) => number; critical: number[] }

function radialExit(source: NativePathSpan, tip: NativePoint, boundary?: SpanBoundary): BirthSupport<RadialExit> {
  if (!boundary) return supported({ exit: () => 0, critical: [] });
  const controls = source.controls.map(p => [p[0] - tip[0], p[1] - tip[1]]);
  if ('radius' in boundary) {
    const { cx, cy, radius } = boundary;
    if (![cx, cy, radius].every(Number.isFinite) || radius <= 0) return unsupported('Radial circle must have finite positive radius');
    const ux = tip[0] - cx, uy = tip[1] - cy;
    const D = radius * radius - ux * ux - uy * uy;
    // No epsilon relocation: a homothety centre outside the head can enter AND
    // exit it. The single radial-exit sublevel-set argument would be false.
    if (D < 0) return unsupported('Homothety tip must lie on or inside the head');
    const x = controls.map(p => p[0]), y = controls.map(p => p[1]);
    const A = add(product(x, x), product(y, y));
    const B = add(scale(x, ux), scale(y, uy));
    const Ap = derivative(A), Bp = derivative(B);
    // F=A*p²+2B*p-D=0; dF/dt=Ap*p²+2Bp*p=0.
    // Eliminating p gives D*Ap²+4B*Bp*Ap-4A*Bp²=0 (degree <=6).
    // D=0 is factored separately; otherwise its repeated p=0 factor would
    // obscure the nonzero exit branch for actual tip-tangent circle heads.
    const criticalPolynomial = D === 0
      ? add(product(B, Ap), product(Bp, A), -1)
      : add(add(scale(product(Ap, Ap), D), scale(product(product(B, Bp), Ap), 4)), scale(product(A, product(Bp, Bp)), -4));
    const critical = [...nativeBernsteinRoots(criticalPolynomial), ...nativeBernsteinRoots(A), ...nativeBernsteinRoots(B)];
    return supported({ critical, exit: t => {
      const p = nativeSpanPoint(source, t), vx = p[0] - tip[0], vy = p[1] - tip[1];
      const a = vx * vx + vy * vy, b = ux * vx + uy * vy;
      if (a === 0) return Infinity;
      if (D === 0) return Math.max(0, -2 * b / a);
      const root = Math.sqrt(b * b + a * D);
      return b >= 0 ? D / (root + b) : (root - b) / a;
    } });
  }
  const points = boundary.points;
  if (points.length < 6 || points.length % 2 || points.some(v => !Number.isFinite(v))) return unsupported('Invalid convex polygon head');
  const vertices = Array.from({ length: points.length / 2 }, (_, i) => [points[2 * i], points[2 * i + 1]]);
  const area = vertices.reduce((sum, a, i) => { const b = vertices[(i + 1) % vertices.length]; return sum + a[0] * b[1] - a[1] * b[0]; }, 0);
  if (area === 0) return unsupported('Degenerate polygon head');
  const sign = Math.sign(area);
  const faces: { h: number; d: number[] }[] = [];
  for (let i = 0; i < vertices.length; i++) {
    const a = vertices[i], b = vertices[(i + 1) % vertices.length];
    const nx = sign * (b[1] - a[1]), ny = -sign * (b[0] - a[0]);
    if (nx === 0 && ny === 0) return unsupported('Degenerate polygon edge');
    // Test ALL vertices, not just successive turns: rejects nonconvex and
    // self-crossing input instead of assuming arbitrary polygons are heads.
    if (vertices.some(v => nx * (v[0] - a[0]) + ny * (v[1] - a[1]) > 0)) return unsupported('Head polygon must be convex and consistently ordered');
    const h = nx * (a[0] - tip[0]) + ny * (a[1] - tip[1]);
    if (h < 0) return unsupported('Homothety tip must lie on or inside the head');
    faces.push({ h, d: controls.map(p => nx * p[0] + ny * p[1]) });
  }
  const critical = faces.flatMap(f => [...nativeBernsteinRoots(f.d), ...nativeBernsteinRoots(derivative(f.d))]);
  for (let i = 0; i < faces.length; i++) for (let j = i + 1; j < faces.length; j++) {
    critical.push(...nativeBernsteinRoots(add(scale(faces[i].d, faces[j].h), scale(faces[j].d, faces[i].h), -1)));
  }
  return supported({ critical, exit: t => {
    const p = nativeSpanPoint(source, t), vx = p[0] - tip[0], vy = p[1] - tip[1];
    let e = Infinity;
    for (let i = 0; i < vertices.length; i++) {
      const a = vertices[i], b = vertices[(i + 1) % vertices.length];
      const d = sign * ((b[1] - a[1]) * vx - (b[0] - a[0]) * vy);
      if (d > 0) e = Math.min(e, faces[i].h / d);
    }
    return e;
  } });
}

/** Fixed full Q, scaled about its authored tip: X(p,t)=tip+p*(Q(t)-tip).
 * Each basin lies between radial-exit local maxima; distinct minima retain
 * separate clocks even AFTER their outside components merge. Does not cover a
 * drawn start-Q prefix or connectivity through closing L/opposite-head edges. */
export function homotheticQuadraticBirthFamily(options: {
  source: NativePathSpan; tip: NativePoint; boundary?: SpanBoundary; strokeWidth: number;
  oppositeBoundary?: SpanBoundary; drawnTo?: number;
}): BirthSupport<ClosingBirthFamily> {
  const { source, tip, boundary, strokeWidth } = options;
  if (source.kind !== 'Q' || !['start-corner', 'end-corner'].includes(source.role) || !validSource(source)
    || tip.some(v => !Number.isFinite(v))) return unsupported('Radial birth requires a finite complete terminal Q and authored tip');
  if (!validWidth(strokeWidth)) return unsupported('Birth budget requires finite positive stroke width');
  if (options.oppositeBoundary || (options.drawnTo !== undefined && options.drawnTo !== 1)) return unsupported('Partial start-Q / opposite-head propagation requires a cross-span lifecycle, not a radial-only plan');
  // Numerical overflow is unsupported, never an apparent absence of events.
  let radial: BirthSupport<RadialExit>;
  try { radial = radialExit(source, tip, boundary); }
  catch (error) {
    if (error instanceof RangeError) return unsupported('Unrepresentable radial boundary polynomial');
    throw error;
  }
  if (radial.kind === 'unsupported') return radial;
  const { exit, critical } = radial.value;
  const events = knots(critical);
  const maxima = events.filter((t, i) => {
    if (i === 0 || i === events.length - 1) return false;
    const value = exit(t), left = exit((events[i - 1] + t) / 2), right = exit((t + events[i + 1]) / 2);
    // Midpoints classify intervals already proven monotone by the full finite
    // critical set; they are NOT a sampled search for missing events.
    return value >= left && value >= right && (value > left || value > right);
  });
  const cuts = [0, ...maxima, 1];
  try {
    const target = outside(source, boundary);
    const references = cuts.slice(1).map((b, i) => {
      const a = cuts[i];
      const domains = target.flatMap(d => intersection(d, [a, b]));
      const referenceLength = domains.reduce((sum, [x, y]) => sum + lengthBetween(source, x, y), 0);
      const birth = Math.min(...[a, b, ...events.filter(t => t > a && t < b)].map(exit));
      return basin([a, b], birth, referenceLength, strokeWidth);
    });
    if (references.some(b => !Number.isFinite(b.referenceLength) || Number.isNaN(b.birth) || (b.referenceLength > 0 && b.budget === 0))) return unsupported('Unrepresentable raw reference length or birth budget');
    const basins = references.filter(b => b.referenceLength > 0 && b.birth < 1);
    return supported({ mode: 'homothetic-Q', source: copySpan(source), tip: [...tip], boundary: copyBoundary(boundary), basins });
  } catch (error) {
    if (error instanceof RangeError) return unsupported('Unrepresentable quadratic extent arithmetic');
    throw error;
  }
}

/** Exact radial endpoint certification for a previously constructed family.
 * Zero exit means every positive scale is outside its OWN boundary. */
export function closingBirthEndpointExit(family: ClosingBirthFamily, endpoint: 0 | 1): BirthSupport<number> {
  if (family.mode !== 'homothetic-Q' || !family.tip) return unsupported('Endpoint exit requires a homothetic Q');
  const radial = radialExit(family.source, family.tip, family.boundary);
  return radial.kind === 'unsupported' ? radial : supported(radial.value.exit(endpoint));
}

/** Stateless, direction-independent evaluation. Budget always refers to the
 * fixed complete source at p=1, NEVER the shrinking current retained extent.
 * Endpoints have no override to weight=1: positive targets reach it by budget,
 * absent raw targets stay absent. Const/static selection belongs to caller. */
export function evaluateClosingBirth(family: ClosingBirthFamily, progress: number): ClosingBirthEvaluation {
  if (!Number.isFinite(progress) || progress < 0 || progress > 1) throw new RangeError('Invalid closing birth progress');
  const current: NativePathSpan = family.mode === 'manual-prefix' ? family.source : { ...family.source,
    controls: family.source.controls.map(p => [family.tip![0] + progress * (p[0] - family.tip![0]), family.tip![1] + progress * (p[1] - family.tip![1])]),
  };
  const retained: SpanInterval[] = progress === 0 ? [] : family.mode === 'manual-prefix' ? [[0, progress]] : outside(current, family.boundary);
  return { source: { role: family.source.role, index: family.source.index }, progress,
    cohorts: family.basins.map(b => {
      const rawDomains = progress <= b.birth ? [] : retained.flatMap(d => intersection(d, b.domain));
      const rawLength = rawDomains.reduce((sum, [a, c]) => sum + lengthBetween(current, a, c), 0);
      const u = b.budget > 0 ? Math.min(1, rawLength / b.budget) : 0;
      return { ...b, domain: [...b.domain], rawDomains, rawLength, weight: u * u * (3 - 2 * u), active: rawLength > 0 };
    }),
  };
}

export interface BirthPaintFragment extends RetainedNativeSpan {
  /** null means original authored coverage, never weighted. */
  cohort: number | null;
  offset: number;
  length: number;
}
/** Partition independently retained PAINT geometry, preserving original clock
 * and controls. A raw/paint ambiguity not covered by a basin is unsupported,
 * never silently dropped, nearest-matched, or assigned full opacity. */
export function partitionClosingBirthPaint(path: NativePath, retained: RetainedNativeSpan[][],
  family: ClosingBirthFamily, progress: number): BirthSupport<{ fragments: BirthPaintFragment[]; length: number }> {
  const evaluation = evaluateClosingBirth(family, progress);
  const raw = path.paintSource ?? path;
  if (raw.paintSource || raw.spans.some(s => s.role !== 'authored' && (s.role !== family.source.role || s.index !== family.source.index))) {
    return unsupported('Whole closure contains an unplanned source, even if currently consumed');
  }
  const matching = raw.spans.filter(s => s.role === family.source.role && s.index === family.source.index);
  if (matching.length !== 1) return unsupported('Paint path must contain exactly one planned source role/index');
  const expected = family.mode === 'manual-prefix' ? nativeSpanPart(family.source, 0, progress) : { ...family.source,
    controls: family.source.controls.map(p => [family.tip![0] + progress * (p[0] - family.tip![0]), family.tip![1] + progress * (p[1] - family.tip![1])]),
  };
  // Exact family membership validation, NOT spatial matching. The renderer
  // cannot apply weights from another independently changing radius/geometry.
  if (matching[0].kind !== expected.kind || JSON.stringify(matching[0].controls) !== JSON.stringify(expected.controls)) {
    return unsupported('Paint source is not this fixed geometry family at the requested progress');
  }
  if (path.paintSource && (path.spans.length !== raw.spans.length || path.spans.some((s, i) => s.kind !== raw.spans[i].kind
    || s.role !== raw.spans[i].role || s.index !== raw.spans[i].index || s.controls.length !== raw.spans[i].controls.length
    || s.controls.some((p, j) => p.some((v, axis) => v !== Number(raw.spans[i].controls[j][axis].toFixed(2))))))) {
    return unsupported('Paint controls lack exact native two-decimal provenance');
  }
  const offsets = [0];
  for (const s of path.spans) offsets.push(offsets.at(-1)! + nativeSpanLength(s));
  const fragments: BirthPaintFragment[] = [];
  for (const part of retained.flat()) {
    const original = path.spans[part.spanIndex];
    const emit = (a: number, b: number, cohort: number | null) => fragments.push({ spanIndex: part.spanIndex, from: a, to: b,
      span: nativeSpanPart(original, a, b), cohort, offset: offsets[part.spanIndex] + nativeSpanLength(original, a), length: lengthBetween(original, a, b),
    });
    if (original.role === 'authored') { emit(part.from, part.to, null); continue; }
    if (original.role !== family.source.role || original.index !== family.source.index) return unsupported('Whole closure contains an unplanned non-authored source');
    const sourceTo = family.mode === 'manual-prefix' ? progress : 1;
    if (sourceTo === 0) return unsupported('Zero-progress closure must select its original static path');
    const domains = evaluation.cohorts.flatMap((c, i) => intersection([part.from * sourceTo, part.to * sourceTo], c.domain).map(d => ({ d, i })));
    let cursor = part.from;
    for (const { d: [a, b], i } of domains) {
      const from = a / sourceTo, to = b / sourceTo;
      if (Math.abs(from - cursor) > 2 ** -42 || !evaluation.cohorts[i].active) return unsupported('Painted retained domain has no certified raw-positive cohort');
      emit(from, to, i); cursor = to;
    }
    if (Math.abs(cursor - part.to) > 2 ** -42) return unsupported('Painted retained domain is outside the complete-source cohort partition');
  }
  return supported({ fragments, length: offsets.at(-1)! });
}
