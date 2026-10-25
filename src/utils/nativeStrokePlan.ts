import {
  consumeNativeTerminals, nativeBernsteinRoots, nativeSpanPart, nativeSpanPoint,
  type NativePath, type NativePathSpan, type SpanBoundary,
} from './nativePathSpans';

export interface NativeStrokeRun {
  d: string;
  /** Distance along the ORIGINAL centerline, including consumed intervals.
   * SVG/Canvas dash offset adds this distance, never restarts at a new M. */
  offset: number;
  length: number;
}
export interface NativeStrokePlan {
  runs: NativeStrokeRun[];
  /** Original paint clock, never the sum of retained run lengths. */
  length: number;
  bounds: { x: number; y: number; width: number; height: number };
}

// Five-point Gauss-Legendre, adaptively subdivided in native parameter space.
// This integrates speed; it never replaces or resamples the painted geometry.
const nodes = [0, -0.5384693101056831, 0.5384693101056831, -0.906179845938664, 0.906179845938664];
const weights = [0.5688888888888889, 0.4786286704993665, 0.4786286704993665, 0.2369268850561891, 0.2369268850561891];
export function nativeSpanLength(span: NativePathSpan, to = 1): number {
  if (!(to >= 0 && to <= 1)) throw new RangeError('Invalid native length domain');
  if (span.kind === 'L') return Math.hypot(span.controls[1][0] - span.controls[0][0], span.controls[1][1] - span.controls[0][1]) * to;
  const degree = span.controls.length - 1;
  const derivative = span.controls.slice(1).map((p, i) => [degree * (p[0] - span.controls[i][0]), degree * (p[1] - span.controls[i][1])]);
  const speed = (t: number) => {
    let row = derivative;
    while (row.length > 1) row = row.slice(1).map((p, i) => [row[i][0] + (p[0] - row[i][0]) * t, row[i][1] + (p[1] - row[i][1]) * t]);
    return Math.hypot(row[0][0], row[0][1]);
  };
  const quadrature = (a: number, b: number) => {
    const half = (b - a) / 2, mid = (a + b) / 2;
    return half * nodes.reduce((sum, node, i) => sum + weights[i] * speed(mid + half * node), 0);
  };
  const integrate = (a: number, b: number, whole: number, tolerance: number, depth: number): number => {
    const mid = (a + b) / 2, left = quadrature(a, mid), right = quadrature(mid, b);
    if (depth === 20 || Math.abs(left + right - whole) <= tolerance) return left + right;
    return integrate(a, mid, left, tolerance / 2, depth + 1) + integrate(mid, b, right, tolerance / 2, depth + 1);
  };
  // Split at coordinate derivative roots as well: a collinear retracing C can
  // have cusps invisible to a fixed quadrature node set.
  const cuts = [0, ...[0, 1].flatMap(axis => nativeBernsteinRoots(derivative.map(p => p[axis]))).filter(t => t > 0 && t < to), to].sort((a, b) => a - b);
  return cuts.slice(1).reduce((sum, b, i) => {
    const a = cuts[i], whole = quadrature(a, b);
    return sum + integrate(a, b, whole, 1e-8 * Math.max(1, whole) * (b - a), 0);
  }, 0);
}

/** Exact polynomial extrema plus cap/round-join radius and one local pixel of
 * AA allowance. Consumers must intersect device bounds with their viewport;
 * this geometric box does not authorize an unbounded offscreen allocation. */
export function nativeStrokeBounds(path: NativePath, strokeWidth: number): NativeStrokePlan['bounds'] {
  let minX = path.start[0], maxX = minX, minY = path.start[1], maxY = minY;
  for (const span of path.spans) {
    const degree = span.controls.length - 1;
    const ts = [0, 1, ...[0, 1].flatMap(axis => nativeBernsteinRoots(span.controls.slice(1).map((p, i) => degree * (p[axis] - span.controls[i][axis]))))];
    for (const t of ts) {
      const [x, y] = nativeSpanPoint(span, t);
      minX = Math.min(minX, x); maxX = Math.max(maxX, x);
      minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    }
  }
  const pad = Math.max(0, strokeWidth) / 2 + 1;
  return { x: minX - pad, y: minY - pad, width: maxX - minX + 2 * pad, height: maxY - minY + 2 * pad };
}

/** Prepare native retained runs for ONE colour/alpha coverage operation.
 * A null plan means no consumption: preserve the original native fast path.
 * Fill, head glyphs, silhouette cuts, and the paint clock remain independent.
 * Callers use paintedNativePath when consuming historical two-decimal SVG. */
export function nativeTerminalStrokePlan(path: NativePath, strokeWidth: number, start?: SpanBoundary, end?: SpanBoundary): NativeStrokePlan | null {
  const result = consumeNativeTerminals(path, start, end);
  if (!result.consumed.some(intervals => intervals.length)) return null;
  const offsets = [0];
  for (const span of path.spans) offsets.push(offsets[offsets.length - 1] + nativeSpanLength(span));
  const point = (p: number[]) => p.join(' ');
  const runs = result.runs.filter(run => {
    const first = run[0], last = run[run.length - 1];
    const origin = first.span.controls[0];
    // A serialized closing prefix can collapse to a point after its terminal
    // corner was consumed. Stroking that newly isolated M/L manufactures a
    // round-cap disk. Normalize only this painted seam residue, not authored
    // zero paths, nonzero geometry, or ownership across a raw-outside gap.
    if (!path.paintSource || run.some(part => part.span.role !== 'closing'
      || part.span.controls.some(p => p[0] !== origin[0] || p[1] !== origin[1]))) return true;
    const before = first.spanIndex - 1, after = last.spanIndex + 1;
    const samePoint = (p: number[] | undefined) => p?.[0] === origin[0] && p?.[1] === origin[1];
    const isolated = (first.from === 0 && path.spans[before]?.role === 'end-corner'
      && samePoint(path.spans[before].controls.at(-1))
      && result.consumed[before].some(([, b]) => b === 1))
      || (last.to === 1 && path.spans[after]?.role === 'start-corner'
        && samePoint(path.spans[after].controls[0])
        && result.consumed[after].some(([a]) => a === 0));
    return !isolated;
  }).map(run => {
    const first = run[0];
    const commands = [`M ${point(first.span.controls[0])}`];
    let length = 0;
    for (const part of run) {
      commands.push(`${part.span.kind} ${part.span.controls.slice(1).map(point).join(' ')}`);
      length += nativeSpanLength(nativeSpanPart(path.spans[part.spanIndex], part.from, part.to));
    }
    return { d: commands.join(' '), offset: offsets[first.spanIndex] + nativeSpanLength(path.spans[first.spanIndex], first.from), length };
  });
  return { runs, length: offsets[offsets.length - 1], bounds: nativeStrokeBounds(path, strokeWidth) };
}
