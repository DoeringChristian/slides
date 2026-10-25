/** Native polynomial spans. Parameters always refer to the original span, not
 * arc length; subdivision preserves its L/Q/C degree and authored provenance. */
export type NativePoint = [number, number];
export type NativeSpanRole = 'authored' | 'start-corner' | 'end-corner' | 'closing';
export interface NativePathSpan {
  kind: 'L' | 'Q' | 'C';
  controls: NativePoint[];
  role: NativeSpanRole;
  /** Original vertex/leg index, never inferred from coincident coordinates. */
  index: number;
  /** A native Z supplies this line without an explicit L command. */
  implicitClose?: boolean;
  /** Manual/straight seam's complete authored span, before prefix truncation. */
  sourceControls?: NativePoint[];
  sourceTo?: number;
  /** Transient rounded closure provenance. Unlike manual sourceControls, this
   * does NOT seed ownership: complete current-frame span before prefix draw. */
  closureSource?: { controls: NativePoint[]; to: number };
}
export interface NativePath {
  start: NativePoint;
  spans: NativePathSpan[];
  closed: boolean;
  /** Internal serializer provenance, never presentation data. Ownership uses
   * this unrounded path; retained geometry always uses the painted controls. */
  paintSource?: NativePath;
}
export type SpanBoundary = { points: number[] } | { cx: number; cy: number; radius: number };
export type SpanInterval = [number, number];

export function splitNativeControls(controls: NativePoint[], t: number): [NativePoint[], NativePoint[]] {
  let row = controls;
  const left = [row[0]], right = [row[row.length - 1]];
  while (row.length > 1) {
    row = row.slice(1).map((p, i) => [
      row[i][0] + (p[0] - row[i][0]) * t,
      row[i][1] + (p[1] - row[i][1]) * t,
    ]);
    left.push(row[0]);
    right.unshift(row[row.length - 1]);
  }
  return [left, right];
}

export function nativeSpanPart(span: NativePathSpan, from: number, to: number): NativePathSpan {
  if (!(0 <= from && from <= to && to <= 1)) throw new RangeError('Invalid native span domain');
  let controls = span.controls;
  if (to < 1) controls = splitNativeControls(controls, to)[0];
  if (from > 0) controls = splitNativeControls(controls, to === 0 ? 0 : from / to)[1];
  return { ...span, controls, implicitClose: from === 0 && to === 1 && span.implicitClose };
}

export function nativeSpanPoint(span: NativePathSpan, t: number): NativePoint {
  const left = splitNativeControls(span.controls, t)[0];
  return left[left.length - 1];
}

export function serializeNativePath(path: NativePath): string {
  const point = (p: NativePoint) => p.map(v => v.toFixed(2)).join(' ');
  const commands = [`M ${point(path.start)}`];
  for (const span of path.spans) {
    if (!span.implicitClose) commands.push(`${span.kind} ${span.controls.slice(1).map(point).join(' ')}`);
  }
  if (path.closed) commands.push('Z');
  return commands.join(' ');
}

/** Match the coordinates actually painted by the historical two-decimal SVG
 * serializer, without parsing d. Split these controls to retain that SAME curve. */
export function paintedNativePath(path: NativePath): NativePath {
  const point = (p: NativePoint): NativePoint => [Number(p[0].toFixed(2)), Number(p[1].toFixed(2))];
  return { ...path, paintSource: path.paintSource ?? path, start: point(path.start),
    spans: path.spans.map(s => ({ ...s, controls: s.controls.map(point) })) };
}

// Root brackets terminate at 2^-46 in parameter space. This is a floating-point
// solver, not an exact-arithmetic predicate: values within 64 ulps of the
// normalized coefficient scale are treated as boundary. Unlike sample scans,
// derivative isolation finds tangent roots and narrow multiple components.
export const NATIVE_ROOT_PARAMETER_TOLERANCE = 2 ** -46;
const VALUE_ULPS = 64 * Number.EPSILON;
const evaluate = (coefficients: number[], t: number): number => {
  let row = coefficients;
  while (row.length > 1) row = row.slice(1).map((v, i) => row[i] * (1 - t) + v * t);
  return row[0];
};
const unique = (values: number[]) => values
  .map(v => v <= NATIVE_ROOT_PARAMETER_TOLERANCE * 2 ? 0 : v >= 1 - NATIVE_ROOT_PARAMETER_TOLERANCE * 2 ? 1 : v)
  .sort((a, b) => a - b).filter((v, i, a) => i === 0 || v - a[i - 1] > NATIVE_ROOT_PARAMETER_TOLERANCE * 2);

/** All roots on [0,1] of a degree <= 6 Bernstein polynomial. Derivative roots
 * partition it into monotone intervals; every crossing is then bracketed.
 * Identically-zero polynomials need no partition and return no isolated roots. */
export function nativeBernsteinRoots(coefficients: number[]): number[] {
  if (!coefficients.length || coefficients.some(v => !Number.isFinite(v))) throw new RangeError('Non-finite boundary polynomial');
  const scale = Math.max(...coefficients.map(Math.abs));
  if (scale === 0 || coefficients.length === 1) return [];
  const c = coefficients.map(v => v / scale);
  const degree = c.length - 1;
  const critical = degree === 1 ? [] : nativeBernsteinRoots(c.slice(1).map((v, i) => degree * (v - c[i])));
  const knots = unique([0, ...critical, 1]);
  const roots: number[] = [];
  for (const t of knots) if (Math.abs(evaluate(c, t)) <= VALUE_ULPS) roots.push(t);
  for (let i = 1; i < knots.length; i++) {
    let lo = knots[i - 1], hi = knots[i];
    let a = evaluate(c, lo);
    const b = evaluate(c, hi);
    if (a === 0 || b === 0 || Math.sign(a) === Math.sign(b)) continue;
    while (hi - lo > NATIVE_ROOT_PARAMETER_TOLERANCE) {
      const mid = (lo + hi) / 2, value = evaluate(c, mid);
      if (value === 0) { lo = hi = mid; break; }
      if (Math.sign(value) === Math.sign(a)) { lo = mid; a = value; } else hi = mid;
    }
    roots.push((lo + hi) / 2);
  }
  return unique(roots);
}

const choose = (n: number, k: number) => {
  let result = 1;
  for (let i = 1; i <= k; i++) result = result * (n - i + 1) / i;
  return result;
};
function squareBernstein(c: number[]): number[] {
  const n = c.length - 1;
  return Array.from({ length: 2 * n + 1 }, (_, k) => {
    let result = 0;
    for (let i = Math.max(0, k - n); i <= Math.min(n, k); i++) {
      result += c[i] * c[k - i] * choose(n, i) * choose(n, k - i) / choose(2 * n, k);
    }
    return result;
  });
}

/** Convex polygon/circle inequalities in Bernstein form, normalized in local
 * coordinates before products (circle/C is degree six). */
function boundaryPolynomials(span: NativePathSpan, boundary: SpanBoundary): number[][] {
  if (span.controls.length !== ({ L: 2, Q: 3, C: 4 }[span.kind]) || span.controls.flat().some(v => !Number.isFinite(v))) {
    throw new RangeError('Invalid native controls');
  }
  if ('radius' in boundary) {
    if (![boundary.cx, boundary.cy, boundary.radius].every(Number.isFinite) || boundary.radius < 0) throw new RangeError('Invalid circle boundary');
    const xs = span.controls.map(p => p[0] - boundary.cx), ys = span.controls.map(p => p[1] - boundary.cy);
    const scale = Math.max(boundary.radius, ...xs.map(Math.abs), ...ys.map(Math.abs)) || 1;
    const xx = squareBernstein(xs.map(v => v / scale)), yy = squareBernstein(ys.map(v => v / scale));
    return [xx.map((v, i) => v + yy[i] - (boundary.radius / scale) ** 2)];
  }
  const p = boundary.points;
  if (p.length < 6 || p.length % 2 || p.some(v => !Number.isFinite(v))) throw new RangeError('Invalid polygon boundary');
  let area = 0;
  for (let i = 2; i + 3 < p.length; i += 2) area += (p[i] - p[0]) * (p[i + 3] - p[1]) - (p[i + 1] - p[1]) * (p[i + 2] - p[0]);
  const orientation = Math.sign(area) || 1;
  const result: number[][] = [];
  for (let i = 0; i < p.length; i += 2) {
    const j = (i + 2) % p.length;
    const dx = p[j] - p[i], dy = p[j + 1] - p[i + 1];
    const scale = Math.max(Math.abs(dx), Math.abs(dy), ...span.controls.flatMap(c => [Math.abs(c[0] - p[i]), Math.abs(c[1] - p[i + 1])])) || 1;
    result.push(span.controls.map(c => -orientation * ((dx / scale) * ((c[1] - p[i + 1]) / scale) - (dy / scale) * ((c[0] - p[i]) / scale))));
  }
  return result;
}

/** Positive-length inside components; isolated tangencies do not remove paint.
 * Boundary-following spans count as inside. Adjacent inside intervals merge so
 * touching a boundary from inside does not break endpoint ownership. */
export function nativeSpanInsideIntervals(span: NativePathSpan, boundary: SpanBoundary): SpanInterval[] {
  const polynomials = boundaryPolynomials(span, boundary);
  const cuts = unique([0, 1, ...polynomials.flatMap(nativeBernsteinRoots)]);
  const result: SpanInterval[] = [];
  for (let i = 1; i < cuts.length; i++) {
    const a = cuts[i - 1], b = cuts[i];
    if (!polynomials.every(c => evaluate(c, (a + b) / 2) <= 0)) continue;
    const last = result[result.length - 1];
    if (last && last[1] === a) last[1] = b; else result.push([a, b]);
  }
  return result;
}

export interface RetainedNativeSpan {
  spanIndex: number;
  from: number;
  to: number;
  span: NativePathSpan;
}
export interface NativeTerminalConsumption {
  consumed: SpanInterval[][];
  runs: RetainedNativeSpan[][];
}

/** Authored graph, not geometric adjacency. Z/coincidence never adds an edge.
 * Original boundary seeds exist at every progress. A terminal rounded corner
 * owns ALL its inside components; a looping manual C only owns its endpoint-
 * connected component, never a later re-entry on that same C. */
export function consumeNativeTerminals(path: NativePath, start?: SpanBoundary, end?: SpanBoundary): NativeTerminalConsumption {
  const spans = path.spans;
  const consumed: SpanInterval[][] = spans.map(() => []);
  const authored = spans.map((s, i) => s.role === 'authored' ? i : -1).filter(i => i >= 0);
  const source = path.paintSource;
  // Verify the exact serializer mapping, not a general geometry epsilon. Each
  // control differs by at most half a decimal unit (.005 per axis, modulo
  // decimal-to-binary conversion). Bezier convex combinations give the SAME
  // bound at every parameter, including between roots and at tangencies.
  if (source && (source.paintSource || source.spans.length !== spans.length || spans.some((s, i) => {
    const raw = source.spans[i];
    return s.kind !== raw.kind || s.role !== raw.role || s.index !== raw.index || s.sourceTo !== raw.sourceTo
      || s.controls.length !== raw.controls.length
      || s.controls.some((p, j) => p.some((v, axis) => v !== Number(raw.controls[j][axis].toFixed(2))));
  }))) throw new RangeError('Invalid native paint quantization provenance');
  for (const [side, boundary] of [['start', start], ['end', end]] as const) {
    if (!boundary || !authored.length) continue;
    const inside = spans.map(s => nativeSpanInsideIntervals(s, boundary));
    if (source) {
      // Determine ownership on the authored graph BEFORE quantization. This
      // preserves its endpoint/rounded-corner/seam barriers and cannot select
      // a nearby but unrelated loop or a moving manual-closure prefix tip.
      const owned = consumeNativeTerminals(source, side === 'start' ? boundary : undefined,
        side === 'end' ? boundary : undefined).consumed;
      owned.forEach((intervals, i) => {
        const rawInside = nativeSpanInsideIntervals(source.spans[i], boundary);
        for (const [a, b] of intervals) {
          const painted = inside[i].filter(([x, y]) => x < b && y > a
            // Quantization can MERGE raw components across a raw-outside gap.
            // Mere overlap must not grant the other component ownership. With
            // no painted separating root, retain this ambiguous component.
            && !rawInside.some(([u, v]) => (u < a || v > b) && x < v && y > u));
          // A tangent or an interval erased entirely by quantization supplies
          // no painted inside seed. Keep native paint, rather than guessing a
          // cut or consuming an unrelated closest component.
          if (!painted.length) continue;
          // Exact painted entry/exit roots are authoritative. Only excursions
          // BETWEEN these overlapping islands (or to an owned domain end) are
          // bridged: their entire parameter domain is inside this one raw-owned
          // component, so the verified serializer bound applies throughout.
          consumed[i].push([a === 0 ? 0 : painted[0][0], b === 1 ? 1 : painted[painted.length - 1][1]]);
        }
      });
      continue;
    }
    const nodes = inside.flatMap((intervals, i) => intervals.map(([a, b]) => ({ i, a, b, owned: false })));
    const first = authored[0], last = authored[authored.length - 1];
    const cornerRole = side === 'start' ? 'start-corner' : 'end-corner';
    for (const node of nodes) {
      node.owned = spans[node.i].role === cornerRole || (side === 'start' ? node.i === first && node.a === 0 : node.i === last && node.b === 1);
      // A manual seam is seeded in its COMPLETE authored domain, then
      // intersected with its drawn prefix. Never seed the moving prefix tip:
      // doing so would switch ownership on at raw1 or erase a looping re-entry.
      const span = spans[node.i];
      if (span.role === 'closing' && span.sourceControls && span.sourceTo! > 0) {
        const full = nativeSpanInsideIntervals({ ...span, controls: span.sourceControls }, boundary);
        node.owned ||= full.some(([a, b]) => (side === 'start' ? b === 1 : a === 0)
          && node.a * span.sourceTo! < b
          && node.b * span.sourceTo! > a);
      }
    }
    const adjacent = (a: typeof nodes[number], b: typeof nodes[number]) => {
      if (a.b !== 1 || b.a !== 0 || b.i !== a.i + 1) return false;
      const ar = spans[a.i].role, br = spans[b.i].role;
      if (side === 'start' && (ar === 'end-corner' || br === 'end-corner')) return false;
      if (side === 'end' && (ar === 'start-corner' || br === 'start-corner')) return false;
      // Manual closing span cannot grant access across the original-end join
      // to the start head; the end head already has its own authored seed.
      if (side === 'start' && ar === 'authored' && br === 'closing') return false;
      return true;
    };
    let changed = true;
    while (changed) {
      changed = false;
      for (const a of nodes) if (a.owned) for (const b of nodes) {
        if (!b.owned && (adjacent(a, b) || adjacent(b, a))) { b.owned = true; changed = true; }
      }
    }
    for (const node of nodes) if (node.owned) consumed[node.i].push([node.a, node.b]);
  }
  const runs: RetainedNativeSpan[][] = [];
  let current: RetainedNativeSpan[] | undefined;
  spans.forEach((span, i) => {
    const intervals = consumed[i].sort((a, b) => a[0] - b[0]);
    const merged: SpanInterval[] = [];
    for (const [a, b] of intervals) {
      const last = merged[merged.length - 1];
      if (last && a <= last[1]) last[1] = Math.max(last[1], b); else merged.push([a, b]);
    }
    consumed[i] = merged;
    let from = 0;
    for (const [a, b] of [...merged, [1, 1]]) {
      if (a > from) {
        if (!current) { current = []; runs.push(current); }
        current.push({ spanIndex: i, from, to: a, span: nativeSpanPart(span, from, a) });
      }
      if (b > a) current = undefined;
      from = Math.max(from, b);
    }
  });
  return { consumed, runs };
}
