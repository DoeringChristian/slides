/**
 * Path-geometry utilities for the unified `path` shapeType (line, arrow,
 * polyline, polygon, B-spline curve are all configurations of it).
 *
 *   pathD: SVG `d` attribute from a vertex list + curve mode + closed flag.
 *   arrowheadPoints: triangle for a stroke arrowhead at a path endpoint.
 *   pathBounds: bounding-box recomputation when vertices move.
 *   resamplePath: arc-length resample to a target vertex count — used by
 *     the controlPoints interpolator when source/target N differ.
 *
 * All coords are in slide-unit space and untransformed; callers wrap in a
 * `<g transform>` to position. The vertex list is RELATIVE to the
 * element's (x, y) so a translation never has to rewrite every vertex.
 */

import type { PathCurve, ArrowheadType, ShapeElement } from '../types/presentation';
import { nativeTerminalStrokePlan } from './nativeStrokePlan';
import { paintedNativePath, serializeNativePath, type NativePath, type NativePathSpan, type NativePoint, type NativeSpanRole } from './nativePathSpans';

/** Playback-only topology hint. Never part of the persisted ShapeElement schema. */
export interface PathClosureEffect {
  progress: number;
  fillOpacity: number;
}
export type ClosurePathShape = ShapeElement & { _pathClosure?: PathClosureEffect };
/** Playback of native B-spline sample spans; retain its static trim/clip policy. */
export interface PathExtensionEffect {
  startDirection: { dx: number; dy: number };
  endDirection: { dx: number; dy: number };
}
/** Playback-only ENTRY growth along a path's own route (the `extend` visibility
 *  easing). Interpolation attaches it as `_extendFx`; `pathArrowGeometry` — the
 *  one geometry source the editor canvas, presenter, viewer, Create and the PDF
 *  export all funnel through — resolves it, so every consumer draws the same
 *  prefix and a typed arrowhead rides the growing endpoint for free. Never part
 *  of the persisted ShapeElement schema. */
export interface ExtendEffect {
  /** Arc-length fraction of the authored route that is drawn. 0 draws nothing;
   *  1 (or above) is a no-op and leaves the authored geometry untouched. */
  progress: number;
}
type PathGeometryShape = Pick<ShapeElement, 'points' | 'curve' | 'closed' | 'cornerRadius' | 'tangents' | 'startHead' | 'endHead' | 'strokeWidth'> & { _pathClosure?: PathClosureEffect; _pathExtension?: PathExtensionEffect; _extendFx?: ExtendEffect };
export type ExtendPathShape = ShapeElement & { _extendFx?: ExtendEffect };

/** Only curves whose authored chain does not change basis on closure. */
export function supportsPathClosure(shape: Pick<ShapeElement, 'points' | 'curve' | 'cornerRadius' | 'tangents'>): boolean {
  const points = shape.points;
  if (!points || points.length < 4 || points.length % 2 || !points.every(Number.isFinite)) return false;
  if ((shape.curve ?? 'linear') === 'linear') return Number.isFinite(shape.cornerRadius) && shape.cornerRadius >= 0;
  return shape.curve === 'bezier' && shape.tangents?.length === points.length * 2
    && shape.tangents.every(Number.isFinite);
}

/** Exact de Casteljau prefix, with parametric (not constant arc-length) progress. */
export function cubicPrefix(controls: number[], progress: number): number[] {
  const t = Math.max(0, Math.min(1, progress));
  if (t === 1) return controls.slice();
  const mix = (a: number[], b: number[]) => a.map((v, i) => v + (b[i] - v) * t);
  const p = [0, 2, 4, 6].map(i => controls.slice(i, i + 2));
  const a = mix(p[0], p[1]), b = mix(p[1], p[2]), c = mix(p[2], p[3]);
  const d = mix(a, b), e = mix(b, c);
  return [...p[0], ...a, ...d, ...mix(d, e)];
}

/** Existing authored spans plus only a prefix of the last-to-first span. */
export function pathClosureD(points: number[], curve: PathCurve, tangents: number[] | undefined, progress: number, cornerRadius = 0): string {
  const t = Math.max(0, Math.min(1, progress));
  if (t === 0 || t === 1) return pathD(points, curve, t === 1, cornerRadius, tangents);
  if (curve === 'linear' && cornerRadius > 0 && points.length >= 6) return roundedClosureD(points, cornerRadius, t);
  if (curve === 'bezier') return bezierPathD(points, tangents!, true, t);
  const last = points.length - 2;
  return pathD(points, 'linear', false) + ` L ${fmt(points[last] + (points[0] - points[last]) * t)} ${fmt(points[last + 1] + (points[1] - points[last + 1]) * t)}`;
}

/** True when this path is conceptually a single line / arrow: linear curve,
 *  exactly two vertices. Used by hit-testing, endpoint handles, and
 *  connector binding which only apply to two-point linear paths. */
export function isLinePath(shape: {
  shapeType?: string;
  points?: number[];
  curve?: PathCurve;
}): boolean {
  return (
    shape.shapeType === 'path' &&
    (shape.curve ?? 'linear') === 'linear' &&
    (shape.points?.length ?? 0) === 4
  );
}

/** Stroke-dash pattern for `strokeStyle`. Returned as a space-separated
 *  string in user-space units that scales with `strokeWidth` — so a thicker
 *  line gets proportionally longer dashes / gaps. `undefined` for 'solid'
 *  (or unset), which the renderer maps to no strokeDasharray attribute. */
export function strokeDashFor(style: string | undefined, strokeWidth: number): string | undefined {
  const w = Math.max(0.5, strokeWidth);
  switch (style) {
    case 'dashed': return `${w * 3} ${w * 2}`;
    // Dots are rendered with round caps; the dash length is 0 so the cap
    // *is* the dot, and the gap controls spacing.
    case 'dotted': return `0 ${w * 2}`;
    default:       return undefined;
  }
}

export function pathD(
  points: number[],
  curve: PathCurve,
  closed: boolean,
  cornerRadius = 0,
  tangents?: number[],
): string {
  if (points.length < 4) return '';
  if (curve === 'linear') return linearPathD(points, closed, cornerRadius);
  // cornerRadius is meaningless for B-splines / béziers (already smooth).
  if (curve === 'smooth') return bezierPathD(points, catmullTangents(points, closed), closed);
  if (curve === 'bezier') return bezierPathD(points, effectiveTangents(points, tangents, closed), closed);
  const degree = curve === 'bspline2' ? 2 : 3;
  return bsplinePathD(points, degree, closed);
}

/** Tangent list actually used for a bezier path: the stored `tangents` when
 *  it matches the vertex count (4 entries per vertex), otherwise Catmull-Rom
 *  estimates — so a bare `curve: 'bezier'` switch renders smooth. */
function effectiveTangents(points: number[], tangents: number[] | undefined, closed: boolean): number[] {
  return tangents && tangents.length === points.length * 2
    ? tangents
    : catmullTangents(points, closed);
}

/** Catmull-Rom tangent estimates for a vertex list, in the flat per-vertex
 *  [inDx,inDy,outDx,outDy] layout of `ShapeElement.tangents`. The out
 *  handle of vertex i is (p[i+1] − p[i−1]) / 6 (the standard Catmull-Rom →
 *  cubic-Bézier conversion, m/3 with m = the central difference / 2); the
 *  in handle is its mirror. Open endpoints use one-sided differences;
 *  closed paths wrap. Used as the default when a path is converted to
 *  `curve: 'bezier'` and as the render-time fallback for missing tangents. */
export function catmullTangents(points: number[], closed: boolean): number[] {
  const n = points.length / 2;
  const out: number[] = [];
  if (n < 2) {
    for (let i = 0; i < n; i++) out.push(0, 0, 0, 0);
    return out;
  }
  const px = (i: number) => points[2 * (((i % n) + n) % n)];
  const py = (i: number) => points[2 * (((i % n) + n) % n) + 1];
  for (let i = 0; i < n; i++) {
    let mx: number, my: number;
    if (!closed && i === 0) {
      mx = (px(1) - px(0)) / 2;
      my = (py(1) - py(0)) / 2;
    } else if (!closed && i === n - 1) {
      mx = (px(n - 1) - px(n - 2)) / 2;
      my = (py(n - 1) - py(n - 2)) / 2;
    } else {
      mx = (px(i + 1) - px(i - 1)) / 2;
      my = (py(i + 1) - py(i - 1)) / 2;
    }
    // `|| 0` normalizes -0 (from negating a zero difference) to +0 so the
    // straight-segment detection and serialized JSON stay clean.
    out.push(-mx / 3 || 0, -my / 3 || 0, mx / 3 || 0, my / 3 || 0);
  }
  return out;
}

/** Cubic-Bézier d-string: one C segment per vertex pair (vertex i's out
 *  handle → vertex i+1's in handle), wrapping back to vertex 0 when closed.
 *  A segment whose adjoining handles are all zero emits a plain L so it
 *  renders (and exports) as an exact straight line. */
function nativeBezierPath(points: number[], tangents: number[], closed: boolean, closingProgress = 1): NativePath {
  const n = points.length / 2;
  const path = nativePathBuilder([points[0], points[1]]);
  for (let i = 0; i < (closed ? n : n - 1); i++) {
    const j = (i + 1) % n;
    const px = points[2 * i], py = points[2 * i + 1];
    const qx = points[2 * j], qy = points[2 * j + 1];
    const outX = tangents[4 * i + 2], outY = tangents[4 * i + 3];
    const inX = tangents[4 * j], inY = tangents[4 * j + 1];
    const closing = i === n - 1;
    const progress = closing ? closingProgress : 1;
    const role = closing ? 'closing' : 'authored';
    let full: NativePoint[];
    if (outX === 0 && outY === 0 && inX === 0 && inY === 0) {
      full = [[px, py], [qx, qy]];
      path.add('L', [[px + (qx - px) * progress, py + (qy - py) * progress]], role, i);
    } else {
      const controls = [px, py, px + outX, py + outY, qx + inX, qy + inY, qx, qy];
      full = [0, 2, 4, 6].map(k => [controls[k], controls[k + 1]]);
      const prefix = cubicPrefix(controls, progress);
      path.add('C', [2, 4, 6].map(k => [prefix[k], prefix[k + 1]]), role, i);
    }
    if (closing) Object.assign(path.value.spans[path.value.spans.length - 1], { sourceControls: full, sourceTo: progress });
  }
  path.value.closed = closed && closingProgress === 1;
  return path.value;
}

function bezierPathD(points: number[], tangents: number[], closed: boolean, closingProgress = 1): string {
  return serializeNativePath(nativeBezierPath(points, tangents, closed, closingProgress));
}

function nativePathBuilder(start: NativePoint) {
  const value: NativePath = { start, spans: [], closed: false };
  let cursor = start;
  return { value, add(kind: NativePathSpan['kind'], controls: NativePoint[], role: NativeSpanRole, index: number, implicitClose = false) {
    value.spans.push({ kind, controls: [cursor, ...controls], role, index, ...(implicitClose ? { implicitClose } : {}) });
    cursor = controls[controls.length - 1];
  } };
}

/** Sample a bezier chain into a flat polyline: 32 de-Casteljau samples per
 *  segment (mirrors the B-spline SAMPLES_PER_SEG constant), with every
 *  vertex emitted EXACTLY (segment boundaries push the endpoint verbatim,
 *  no floating-point drift). Open: (n−1)·32 + 1 points; closed adds the
 *  wrap segment and ends back on vertex 0. */
function bezierSamples(points: number[], tangents: number[], closed: boolean): number[] {
  const n = points.length / 2;
  if (n < 2) return points.slice();
  const S = 32; // keep in sync with SAMPLES_PER_SEG
  const segs = closed ? n : n - 1;
  const out: number[] = [points[0], points[1]];
  for (let s = 0; s < segs; s++) {
    const i = s;
    const j = (s + 1) % n;
    const p0x = points[2 * i], p0y = points[2 * i + 1];
    const p3x = points[2 * j], p3y = points[2 * j + 1];
    const p1x = p0x + tangents[4 * i + 2], p1y = p0y + tangents[4 * i + 3];
    const p2x = p3x + tangents[4 * j], p2y = p3y + tangents[4 * j + 1];
    for (let k = 1; k < S; k++) {
      const t = k / S;
      const u = 1 - t;
      const b0 = u * u * u, b1 = 3 * u * u * t, b2 = 3 * u * t * t, b3 = t * t * t;
      out.push(
        b0 * p0x + b1 * p1x + b2 * p2x + b3 * p3x,
        b0 * p0y + b1 * p1y + b2 * p2y + b3 * p3y,
      );
    }
    out.push(p3x, p3y); // exact endpoint
  }
  return out;
}

/** Shared native clamping, including the existing zero-leg fallback. Only
 * closure seam corners use a factor; interior radii remain independently eased. */
function roundedCorners(points: number[], cornerRadius: number) {
  const n = points.length / 2;
  const v = (i: number): Pt => {
    const idx = ((i % n) + n) % n;
    return [points[2 * idx], points[2 * idx + 1]];
  };
  return (i: number, factor = 1) => {
    const vi = v(i);
    const vp = v(i - 1);
    const vn = v(i + 1);
    const dxA = vp[0] - vi[0], dyA = vp[1] - vi[1];
    const dxB = vn[0] - vi[0], dyB = vn[1] - vi[1];
    const lenA = Math.hypot(dxA, dyA) || 1;
    const lenB = Math.hypot(dxB, dyB) || 1;
    const r = Math.min(cornerRadius, lenA / 2, lenB / 2) * factor;
    return {
      ax: vi[0] + (dxA / lenA) * r,
      ay: vi[1] + (dyA / lenA) * r,
      bx: vi[0] + (dxB / lenB) * r,
      by: vi[1] + (dyB / lenB) * r,
      vx: vi[0],
      vy: vi[1],
    };
  };
}

/** Parametric connector growth: straight length + quadratic control-polygon
 * budget, NOT constant arc-length speed. Only endpoint neighborhoods change. */
function nativeRoundedClosure(points: number[], radius: number, progress: number): NativePath {
  const n = points.length / 2;
  const cornerOf = roundedCorners(points, radius);
  const first = cornerOf(0, progress), last = cornerOf(n - 1, progress);
  const path = nativePathBuilder([first.bx, first.by]);
  for (let i = 1; i < n; i++) {
    const c = i === n - 1 ? last : cornerOf(i);
    path.add('L', [[c.ax, c.ay]], 'authored', i - 1);
    path.add('Q', [[c.vx, c.vy], [c.bx, c.by]], i === n - 1 ? 'end-corner' : 'authored', i);
    if (i === n - 1) {
      const span = path.value.spans[path.value.spans.length - 1];
      span.closureSource = { controls: span.controls, to: 1 };
    }
  }
  const line = Math.hypot(first.ax - last.bx, first.ay - last.by);
  const quadratic = Math.hypot(first.vx - first.ax, first.vy - first.ay)
    + Math.hypot(first.bx - first.vx, first.by - first.vy);
  const distance = progress * (line + quadratic);
  if (progress < 1 && distance <= line && line > 0) {
    const f = distance / line;
    path.add('L', [[last.bx + (first.ax - last.bx) * f, last.by + (first.ay - last.by) * f]], 'closing', n - 1);
  } else {
    path.add('L', [[first.ax, first.ay]], 'closing', n - 1);
    const t = progress === 1 ? 1 : quadratic > 0 ? Math.min(1, (distance - line) / quadratic) : 1;
    const cx = first.ax + (first.vx - first.ax) * t;
    const cy = first.ay + (first.vy - first.ay) * t;
    const bx = first.vx + (first.bx - first.vx) * t;
    const by = first.vy + (first.by - first.vy) * t;
    path.add('Q', [[cx, cy], [cx + (bx - cx) * t, cy + (by - cy) * t]], 'start-corner', 0);
  }
  const closing = path.value.spans.find(s => s.role === 'closing')!;
  closing.closureSource = { controls: [[last.bx, last.by], [first.ax, first.ay]], to: line > 0 ? Math.min(1, distance / line) : 1 };
  const startCorner = path.value.spans.find(s => s.role === 'start-corner');
  if (startCorner) startCorner.closureSource = {
    controls: [[first.ax, first.ay], [first.vx, first.vy], [first.bx, first.by]],
    to: progress === 1 ? 1 : quadratic > 0 ? Math.min(1, (distance - line) / quadratic) : 1,
  };
  path.value.closed = progress === 1;
  return path.value;
}

function roundedClosureD(points: number[], radius: number, progress: number): string {
  return serializeNativePath(nativeRoundedClosure(points, radius, progress));
}

function nativeLinearPath(points: number[], closed: boolean, cornerRadius = 0): NativePath {
  if (cornerRadius > 0 && points.length >= 6 && closed) return nativeRoundedClosure(points, cornerRadius, 1);
  const path = nativePathBuilder([points[0], points[1]]);
  const n = points.length / 2;
  const cornerOf = roundedCorners(points, cornerRadius);
  for (let i = 1; i < n; i++) {
    if (cornerRadius > 0 && n >= 3 && i < n - 1) {
      const c = cornerOf(i);
      path.add('L', [[c.ax, c.ay]], 'authored', i - 1);
      path.add('Q', [[c.vx, c.vy], [c.bx, c.by]], 'authored', i);
    } else path.add('L', [[points[i * 2], points[i * 2 + 1]]], 'authored', i - 1);
  }
  if (closed) {
    path.add('L', [path.value.start], 'closing', n - 1, true);
    const last = path.value.spans[path.value.spans.length - 1];
    last.sourceControls = last.controls;
    last.sourceTo = 1;
  }
  path.value.closed = closed;
  return path.value;
}

function linearPathD(points: number[], closed: boolean, cornerRadius = 0): string {
  return serializeNativePath(nativeLinearPath(points, closed, cornerRadius));
}

/** Shared native spans for supported authored topology only; B-spline playback
 * and automatic closed-tangent changes retain their existing geometry policy. */
export function nativePathGeometry(shape: PathGeometryShape): NativePath | null {
  if (shape._pathExtension || !supportsPathClosure(shape)) return null;
  const points = shape.points!;
  const curve = shape.curve ?? 'linear';
  const progress = Math.max(0, Math.min(1, shape._pathClosure?.progress ?? (shape.closed ? 1 : 0)));
  if (curve === 'bezier') return nativeBezierPath(points, shape.tangents!, progress > 0, progress);
  if (progress === 0 || progress === 1) return nativeLinearPath(points, progress === 1, shape.cornerRadius);
  if (shape.cornerRadius > 0 && points.length >= 6) return nativeRoundedClosure(points, shape.cornerRadius, progress);
  const path = nativeLinearPath(points, false);
  const from: NativePoint = [points[points.length - 2], points[points.length - 1]];
  const to = path.start;
  path.spans.push({ kind: 'L', controls: [from, [from[0] + (to[0] - from[0]) * progress, from[1] + (to[1] - from[1]) * progress]],
    role: 'closing', index: points.length / 2 - 1, sourceControls: [from, to], sourceTo: progress });
  return path;
}

function bsplinePathD(points: number[], degree: 2 | 3, closed: boolean): string {
  return linearPathD(bsplineSamples(points, degree, closed), closed);
}

/** Sample the B-spline curve into a flat polyline. Exposed so the
 *  interpolation pipeline can morph between curve modes by lerping
 *  pre-sampled polylines instead of snapping.
 *
 *  Not enough control points for this degree?  Step down one degree
 *  (cubic → quadratic → linear) instead of snapping straight to linear.
 *  A closed cubic with 3 vertices was rendering as a triangle; the
 *  cyclic wrap can support it as a quadratic just fine. */
function bsplineSamples(points: number[], degree: 2 | 3, closed: boolean): number[] {
  const n = points.length / 2;
  // Open clamped needs n > degree so the boundary segments aren't all
  // degenerate; closed wraps cyclically so it only needs n ≥ 2.
  const enough = closed ? n >= 2 : n > degree;
  if (!enough) {
    if (degree === 3) return bsplineSamples(points, 2, closed);
    return points.slice(); // quadratic with too few points → polyline
  }
  return sampledBsplineSpans(points, degree, closed).points;
}

/** Native polyline nodes with uniform-span parameters (NOT arc-length).
 * Interior knot boundaries are deliberately omitted by the static renderer.
 * Correspondence may subdivide their straight joins, never replace them with
 * mathematical spline points: that would change endpoint geometry. */
export function sampledBsplineSpans(points: number[], degree: 2 | 3, closed = false): { points: number[]; parameters: number[] } {
  const n = points.length / 2;
  const pts: Pt[] = [];
  for (let i = 0; i < n; i++) pts.push([points[2 * i], points[2 * i + 1]]);
  // Closed: wrap with exactly `degree` extra control points at the END so
  // the last segments cyclically reach back to the start — total N segs,
  // matching the N control points. Padding BOTH sides used to duplicate
  // `degree` real segments, producing a visible second stroke that
  // overlapped the loop start.
  // Open clamped: pad both sides with `degree` copies of the endpoint;
  // the boundary segments degenerate so the curve passes through P0 / Pn-1.
  const padded: Pt[] = closed
    ? [...pts, ...pts.slice(0, degree)]
    : [...repeat(pts[0], degree), ...pts, ...repeat(pts[n - 1], degree)];
  const samples: number[] = [], parameters: number[] = [];
  // 32 subdivisions per B-spline segment is comfortably smooth at typical
  // slide zoom levels — at 16 the polyline was visibly faceted on gently
  // curved paths. Cost is linear in the `d` string length and negligible
  // for the vertex counts users hand-draw.
  const SAMPLES_PER_SEG = 32;
  const numSegs = padded.length - degree;
  for (let seg = 0; seg < numSegs; seg++) {
    const controls = padded.slice(seg, seg + degree + 1);
    const lastSeg = seg === numSegs - 1;
    for (let s = 0; s <= SAMPLES_PER_SEG; s++) {
      if (s === 0 && seg > 0) continue;
      if (s === SAMPLES_PER_SEG && !lastSeg) continue;
      const [x, y] = sampleBspline(controls, degree, s / SAMPLES_PER_SEG);
      samples.push(x, y);
      parameters.push(seg + s / SAMPLES_PER_SEG);
    }
  }
  return { points: samples, parameters };
}

/** Public sampler: returns the polyline approximation of a path for any
 *  curve mode. Linear paths pass through; bsplines and béziers are
 *  sampled (béziers honour `tangents`, falling back to Catmull-Rom
 *  estimates exactly like `pathD`). */
export function sampledPath(points: number[], curve: PathCurve, closed: boolean, tangents?: number[]): number[] {
  if (curve === 'linear') return points.slice();
  if (curve === 'bezier' || curve === 'smooth') {
    if (points.length < 4) return points.slice();
    return bezierSamples(points, effectiveTangents(points, curve === 'smooth' ? undefined : tangents, closed), closed);
  }
  const degree = curve === 'bspline2' ? 2 : 3;
  return bsplineSamples(points, degree, closed);
}

// =============================================================================
// `extend` entry animation — arc-length PREFIX of a path's own route
// =============================================================================

/** Vertex index + in-leg fraction of the point sitting at `progress` of a flat
 *  polyline's arc length. Clamped to the last leg, so progress ≥ 1 reports the
 *  final vertex. */
function polylineAt(flat: number[], progress: number): { index: number; fraction: number } {
  const n = flat.length / 2;
  const lengths: number[] = [0];
  for (let i = 1; i < n; i++) {
    lengths.push(lengths[i - 1] + Math.hypot(flat[2 * i] - flat[2 * i - 2], flat[2 * i + 1] - flat[2 * i - 1]));
  }
  const total = lengths[n - 1];
  if (!(total > 0)) return { index: 0, fraction: 0 };
  const target = total * progress;
  let s = 0;
  while (s < n - 2 && lengths[s + 1] < target) s++;
  const leg = lengths[s + 1] - lengths[s];
  return { index: s, fraction: leg > 0 ? Math.max(0, Math.min(1, (target - lengths[s]) / leg)) : 0 };
}

/** Arc-length prefix of a flat polyline: whole legs already passed, plus the
 *  partial leg in flight. A prefix shorter than one leg is a SINGLE vertex, so
 *  `pathD` (and every renderer) draws nothing at all at progress 0. */
function polylinePrefix(flat: number[], progress: number): number[] {
  if (flat.length < 4) return flat.slice();
  const { index, fraction } = polylineAt(flat, progress);
  const out = flat.slice(0, 2 * (index + 1));
  if (fraction > 0) {
    const ax = flat[2 * index], ay = flat[2 * index + 1];
    out.push(ax + (flat[2 * index + 2] - ax) * fraction, ay + (flat[2 * index + 3] - ay) * fraction);
  }
  return out;
}

/** Geometry for the first `progress` of a path's route — the mechanism behind
 *  the `extend` entry animation. Growth follows the authored route from the
 *  FIRST vertex through every successive segment/bend to the last, at constant
 *  arc-length speed, so it is neither a global scale nor an all-points morph.
 *
 *  Per curve family:
 *   - `linear`           the vertex prefix plus a partial last leg; closed paths
 *                        walk their closing leg last. `cornerRadius` rides along,
 *                        so interior corners round as the tip passes them.
 *   - `smooth` / `bezier` an EXACT de Casteljau sub-curve: whole segments are
 *                        kept verbatim and the segment in flight is split, so
 *                        the revealed part never wobbles as it grows. Always
 *                        emitted as `bezier` with explicit tangents, because a
 *                        `smooth` prefix would re-derive Catmull-Rom tangents
 *                        from the SHORTER vertex list and bend differently.
 *   - `bspline2/3`       a prefix of the same sampled polyline the static
 *                        renderer draws (a B-spline has no exact sub-curve in
 *                        control-point form), so a full prefix reproduces the
 *                        static d-string span for span.
 *
 *  progress ≥ 1 (or NaN) returns the authored geometry untouched — the final
 *  frame is byte-identical to the static render, never a resampled lookalike.
 */
export function pathExtendPrefix(
  shape: Pick<ShapeElement, 'points' | 'curve' | 'closed' | 'tangents' | 'cornerRadius'>,
  progress: number,
): Pick<ShapeElement, 'points' | 'curve' | 'closed' | 'tangents' | 'cornerRadius'> {
  const points = shape.points ?? [];
  const curve = shape.curve ?? 'linear';
  const closed = !!shape.closed;
  const cornerRadius = shape.cornerRadius ?? 0;
  const authored = { points, curve, closed, tangents: shape.tangents, cornerRadius };
  if (!(progress < 1) || points.length < 4) return authored;
  const p = Math.max(0, progress);

  if (curve === 'linear') {
    // The closing leg is not in `points`; append the wrap target so a closed
    // polygon grows through it instead of stopping at its last vertex.
    const walk = closed ? [...points, points[0], points[1]] : points;
    return { points: polylinePrefix(walk, p), curve: 'linear', closed: false, tangents: undefined, cornerRadius };
  }

  if (curve === 'bezier' || curve === 'smooth') {
    const handles = effectiveTangents(points, curve === 'smooth' ? undefined : shape.tangents, closed);
    // bezierSamples emits SAMPLES_PER_SEG samples per segment with exact
    // vertices at the boundaries, so a sample index maps straight back to
    // (segment, local parameter).
    const { index, fraction } = polylineAt(bezierSamples(points, handles, closed), p);
    const SEG = 32; // keep in sync with bezierSamples
    const m = Math.floor(index / SEG);
    const local = (index - m * SEG + fraction) / SEG;
    const outPoints = points.slice(0, 2 * (m + 1));
    const outTangents = handles.slice(0, 4 * (m + 1));
    if (local > 0) {
      const n = points.length / 2;
      const j = (m + 1) % n;
      const prefix = cubicPrefix([
        points[2 * m], points[2 * m + 1],
        points[2 * m] + handles[4 * m + 2], points[2 * m + 1] + handles[4 * m + 3],
        points[2 * j] + handles[4 * j], points[2 * j + 1] + handles[4 * j + 1],
        points[2 * j], points[2 * j + 1],
      ], local);
      // The split segment's own control polygon becomes the last leg's handles;
      // the tip's IN handle is what `pathEndpointDirection` reads, so a riding
      // arrowhead points along the true tangent at the growing endpoint.
      outTangents[4 * m + 2] = prefix[2] - prefix[0];
      outTangents[4 * m + 3] = prefix[3] - prefix[1];
      const inX = prefix[4] - prefix[6], inY = prefix[5] - prefix[7];
      outPoints.push(prefix[6], prefix[7]);
      outTangents.push(inX, inY, -inX || 0, -inY || 0);
    }
    return { points: outPoints, curve: 'bezier', closed: false, tangents: outTangents, cornerRadius: 0 };
  }

  const samples = sampledPath(points, curve, closed);
  const walk = closed ? [...samples, samples[0], samples[1]] : samples;
  return { points: polylinePrefix(walk, p), curve: 'linear', closed: false, tangents: undefined, cornerRadius: 0 };
}

/** Return a points list with the first / last vertex pulled back along the
 *  outgoing tangent by the given per-end inset, so a rendered path that
 *  ends in a solid arrowhead doesn't poke through the glyph to the tip.
 *  The tip itself (used by `arrowheadGeometry`) stays at the ORIGINAL
 *  endpoint — only the shaft is shortened. Insets come from
 *  `ArrowheadGeometry.shaftInset` (or the `arrowheadInset` convenience);
 *  open glyphs (arrow / bar / crowfoot) report 0 and leave the shaft
 *  untouched. Returns the same array reference unchanged when both insets
 *  are 0. */
export function insetEndpoints(
  points: number[],
  startInset: number,
  endInset: number,
): number[] {
  if (startInset <= 0 && endInset <= 0) return points;
  if (points.length < 4) return points;
  const lengths: number[] = [0];
  for (let i = 2; i < points.length; i += 2) {
    lengths.push(lengths[lengths.length - 1] + Math.hypot(points[i] - points[i - 2], points[i + 1] - points[i - 1]));
  }
  const total = lengths[lengths.length - 1];
  const start = Math.max(0, startInset), end = total - Math.max(0, endInset);
  // No room for a shaft: omit it instead of drawing through overlapping heads.
  if (start >= end) return [];
  const at = (distance: number): number[] => {
    let i = 1;
    while (i < lengths.length - 1 && lengths[i] < distance) i++;
    const f = (distance - lengths[i - 1]) / (lengths[i] - lengths[i - 1] || 1);
    return [points[2 * i - 2] + f * (points[2 * i] - points[2 * i - 2]),
      points[2 * i - 1] + f * (points[2 * i + 1] - points[2 * i - 1])];
  };
  const out = at(start);
  for (let i = 1; i < lengths.length - 1; i++) if (lengths[i] > start && lengths[i] < end) out.push(points[2 * i], points[2 * i + 1]);
  out.push(...at(end));
  return out;
}

/** Outward endpoint direction, honoring manual/automatic Bézier tangents.
 * Degenerate endpoint segments fall back to the first distinct sample. */
export function pathEndpointDirection(points: number[], curve: PathCurve, closed: boolean, tangents: number[] | undefined, end: 'start' | 'end'): { dx: number; dy: number } {
  const n = points.length / 2;
  if (n < 2) return { dx: 1, dy: 0 };
  if (curve === 'bezier' || curve === 'smooth') {
    const tan = effectiveTangents(points, curve === 'smooth' ? undefined : tangents, closed);
    const i = end === 'start' ? 2 : (n - 1) * 4;
    if (Math.hypot(tan[i], tan[i + 1]) > 1e-9) return { dx: -tan[i], dy: -tan[i + 1] };
  }
  const samples = sampledPath(points, curve, closed, tangents);
  const tip = end === 'start' ? 0 : samples.length - 2;
  const step = end === 'start' ? 2 : -2;
  for (let i = tip + step; i >= 0 && i < samples.length; i += step) {
    const dx = samples[tip] - samples[i], dy = samples[tip + 1] - samples[i + 1];
    if (Math.hypot(dx, dy) > 1e-9) return { dx, dy };
  }
  return { dx: 1, dy: 0 };
}

/** Distance from an endpoint to the first exit from its convex head silhouette.
 * Walk from the tip, not from the other end: an earlier self-intersection must
 * not swallow unrelated shaft segments. Subdivision never changes this cut. */
function headEntryInset(samples: number[], geo: ArrowheadGeometry | null, end: 'start' | 'end'): number {
  const boundary = geo?.boundary;
  if (!boundary || samples.length < 4) return 0;
  const inside = (x: number, y: number) => {
    if ('radius' in boundary) return Math.hypot(x - boundary.cx, y - boundary.cy) <= boundary.radius + 1e-9;
    const p = boundary.points;
    let positive = false, negative = false;
    for (let i = 0; i < p.length; i += 2) {
      const j = (i + 2) % p.length;
      const cross = (p[j] - p[i]) * (y - p[i + 1]) - (p[j + 1] - p[i + 1]) * (x - p[i]);
      positive ||= cross > 1e-9; negative ||= cross < -1e-9;
    }
    return !(positive && negative);
  };
  const step = end === 'start' ? 2 : -2;
  let distance = 0;
  for (let i = end === 'start' ? 0 : samples.length - 2; i + step >= 0 && i + step < samples.length; i += step) {
    const x = samples[i], y = samples[i + 1];
    const dx = samples[i + step] - x, dy = samples[i + step + 1] - y;
    const length = Math.hypot(dx, dy);
    if (!inside(x + dx, y + dy)) {
      let lo = 0, hi = 1;
      for (let k = 0; k < 40; k++) {
        const mid = (lo + hi) / 2;
        if (inside(x + dx * mid, y + dy * mid)) lo = mid; else hi = mid;
      }
      return distance + length * (lo + hi) / 2;
    }
    distance += length;
  }
  return distance || geo!.shaftInset;
}

/** ONE shaft/head source for editor, exports, path handles and Create.
 * Only trim original segments: a short terminal leg may enter the side of
 * its head, but must never acquire an invented tangent-base rejoin. */
export function pathArrowGeometry(shape: PathGeometryShape) {
  // `extend` growth is resolved HERE, the single geometry funnel, by swapping in
  // the route prefix and re-entering. Heads then derive from the prefix's own
  // endpoints, so the end glyph rides the growing tip at its normal size and
  // stroke with no separate tracing head. A finished (progress ≥ 1) hint falls
  // through untouched, keeping the last frame byte-identical to static playback.
  const extend = shape._extendFx;
  if (extend && extend.progress < 1) {
    return pathArrowGeometry({ ...shape, ...pathExtendPrefix(shape, extend.progress),
      _extendFx: undefined, _pathClosure: undefined, _pathExtension: undefined });
  }
  const points = shape.points ?? [], curve = shape.curve ?? 'linear', closed = !!shape.closed;
  const extension = shape._pathExtension;
  const supported = !extension && supportsPathClosure(shape);
  const closure = supported ? shape._pathClosure : undefined;
  const sw = shape.strokeWidth || (closure ? 3 * (1 - closure.progress) : closed ? 0 : 3);
  const head = (end: 'start' | 'end') => {
    const type = end === 'start' ? shape.startHead : shape.endHead;
    if (!type || type === 'none' || points.length < 4) return null;
    const idx = end === 'start' ? 0 : points.length - 2;
    const dir = extension ? (end === 'start' ? extension.startDirection : extension.endDirection)
      : pathEndpointDirection(points, curve, supported ? false : closed, shape.tangents, end);
    return arrowheadGeometry(type, points[idx], points[idx + 1], dir.dx, dir.dy, 10, sw);
  };
  const startGeo = head('start'), endGeo = head('end');
  const sampled = !supported && curve !== 'linear' && !!(startGeo?.boundary || endGeo?.boundary);
  const samples = sampled ? sampledPath(points, curve, closed, shape.tangents) : points;
  // Native supported curves are clipped, never rewritten around head silhouettes.
  const shaftPoints = supported ? points : insetEndpoints(samples, headEntryInset(samples, startGeo, 'start'), headEntryInset(samples, endGeo, 'end'));
  const shaftCurve: PathCurve = sampled ? 'linear' : curve;
  const shaftTangents = sampled ? undefined : shape.tangents;
  const cornerRadius = !extension && curve === 'linear' ? shape.cornerRadius : 0;
  // Stroke clipping, not a background-coloured patch: outlined heads retain
  // transparent holes, and a wide round cap cannot poke beyond a near-tip join.
  // Each even-odd cut is applied separately (overlapping heads must not XOR).
  const padding = Math.max(100, sw * 10);
  const xs = samples.filter((_, i) => i % 2 === 0), ys = samples.filter((_, i) => i % 2 === 1);
  if (supported && curve === 'bezier') {
    // Native cubics can bulge far beyond their vertices. Include exact
    // extrema of the full loop so shaft clips also contain any closure prefix.
    const bounds = pathBoundsFor(points, curve, true, shape.tangents);
    xs.push(bounds.x, bounds.x + bounds.width);
    ys.push(bounds.y, bounds.y + bounds.height);
  }
  const left = Math.min(0, ...xs) - padding, top = Math.min(0, ...ys) - padding;
  const right = Math.max(0, ...xs) + padding, bottom = Math.max(0, ...ys) + padding;
  const outer = `M ${left} ${top} H ${right} V ${bottom} H ${left} Z`;
  const shaftClipPaths = [startGeo, endGeo].flatMap(geo => geo?.shaftCuts?.map(cut => `${outer} ${cut}`) ?? []);
  const originalD = closure ? pathClosureD(points, curve, shape.tangents, closure.progress, cornerRadius)
    : pathD(shaftPoints, shaftCurve, closed, cornerRadius, shaftTangents);
  const fillD = supported ? pathD(points, curve, true, cornerRadius, shape.tangents) : originalD;
  const native = (startGeo?.boundary || endGeo?.boundary) ? nativePathGeometry(shape) : null;
  const strokePlan = native ? nativeTerminalStrokePlan(paintedNativePath(native), sw, startGeo?.boundary, endGeo?.boundary) : null;
  const d = strokePlan ? strokePlan.runs.map(run => run.d).join(' ') : originalD;
  return { startGeo, endGeo, shaftPoints, shaftCurve, shaftTangents, shaftClipPaths, d, originalD, fillD, strokePlan };
}

/** Total arc-length of a path under the given curve mode. Used by the
 *  tip-riding arrow animation to map a 0..1 progress to a distance along
 *  the path. */
export function pathArcLength(points: number[], curve: PathCurve, closed: boolean, tangents?: number[]): number {
  const samples = sampledPath(points, curve, closed, tangents);
  let total = 0;
  for (let i = 0; i + 3 < samples.length; i += 2) {
    total += Math.hypot(samples[i + 2] - samples[i], samples[i + 3] - samples[i + 1]);
  }
  if (closed && samples.length >= 4) {
    total += Math.hypot(samples[0] - samples[samples.length - 2], samples[1] - samples[samples.length - 1]);
  }
  return total;
}

/** Walk the path to the requested arc-length and return the point at
 *  that distance plus the tangent direction at that point. `targetLen`
 *  is clamped to [0, total]. Used to position the arrowhead at the
 *  growing tip during a draw animation. */
export function pointAtArcLength(
  points: number[],
  curve: PathCurve,
  closed: boolean,
  targetLen: number,
  tangents?: number[],
): { x: number; y: number; dx: number; dy: number } | null {
  const samples = sampledPath(points, curve, closed, tangents);
  if (samples.length < 4) return null;
  // For closed paths, append the first sample to the end so the closing
  // segment is included in the walk.
  const walk = closed ? [...samples, samples[0], samples[1]] : samples;
  let cum = 0;
  for (let i = 0; i + 3 < walk.length; i += 2) {
    const x1 = walk[i], y1 = walk[i + 1];
    const x2 = walk[i + 2], y2 = walk[i + 3];
    const dx = x2 - x1, dy = y2 - y1;
    const segLen = Math.hypot(dx, dy);
    if (cum + segLen >= targetLen) {
      const f = segLen > 0 ? (targetLen - cum) / segLen : 0;
      return { x: x1 + dx * f, y: y1 + dy * f, dx, dy };
    }
    cum += segLen;
  }
  // Past the end → return the last segment's endpoint + its tangent.
  const n = walk.length;
  const dx = walk[n - 2] - walk[n - 4];
  const dy = walk[n - 1] - walk[n - 3];
  return { x: walk[n - 2], y: walk[n - 1], dx, dy };
}

/** Triangle points for an arrowhead at (tipX, tipY) pointing along (dx, dy).
 *  Returns a flat `[x0,y0,x1,y1,x2,y2]` array (tip, left, right). */
export function arrowheadPoints(
  tipX: number,
  tipY: number,
  dirX: number,
  dirY: number,
  size = 10,
): number[] {
  const len = Math.hypot(dirX, dirY) || 1;
  const ux = dirX / len;
  const uy = dirY / len;
  // Perpendicular (rotate 90° CCW): (-uy, ux)
  const baseX = tipX - ux * size;
  const baseY = tipY - uy * size;
  const half = size / 2;
  return [
    tipX, tipY,
    baseX - uy * half, baseY + ux * half,
    baseX + uy * half, baseY - ux * half,
  ];
}

// =============================================================================
// Typed arrowheads — THE single geometry source for every renderer
// (ElementRenderer, exportPdf, shapeToPath pen-trace, presenter tip-draw,
// and the property-panel previews). Never re-derive head math elsewhere.
// =============================================================================

/** Output of `arrowheadGeometry`, in the same (element-relative or absolute
 *  — whatever space the tip is given in) coordinate space as the tip.
 *
 *  fills   — solid primitives painted in the stroke colour: either a flat
 *            polygon vertex list `[x0,y0,x1,y1,…]` or a full `d` string
 *            (circles). No stroke.
 *  strokes — open/closed `d` strings stroked at the shaft's strokeWidth
 *            with round caps/joins, never filled.
 *  shaftInset — nominal inset on a straight shaft (0 for open glyphs).
 *            For bent shafts use pathArrowGeometry's silhouette entry instead
 *            of treating this as an arc-length trim. */
export interface ArrowheadGeometry {
  shaftInset: number;
  /** Closed-head silhouette, shared by centerline trimming and stroke clipping. */
  boundary?: { points: number[] } | { cx: number; cy: number; radius: number };
  shaftCuts?: string[];
  fills: Array<{ points: number[] } | { d: string }>;
  strokes: Array<{ d: string }>;
}

/** Nominal head length: `size`, scaled up with strokeWidth beyond the
 *  default path width of 3 (so heavier lines grow proportionally bigger
 *  heads) with `size` itself as the sensible minimum — a hairline never
 *  shrinks its head below the classic 10-unit triangle. */
function headSize(size: number, strokeWidth: number): number {
  return Math.max(size, (size * strokeWidth) / 3);
}

/** Shaft inset for a head type without needing the tip position — the
 *  inset depends only on the glyph, size and strokeWidth. Convenience over
 *  `arrowheadGeometry(...).shaftInset` for callers that inset the shaft
 *  before knowing (or without caring about) the tip direction. */
export function arrowheadInset(
  type: ArrowheadType | undefined,
  size = 10,
  strokeWidth = 3,
): number {
  if (!type || type === 'none') return 0;
  return arrowheadGeometry(type, 0, 0, 1, 0, size, strokeWidth).shaftInset;
}

/** Geometry for a typed arrowhead whose tip sits at (tipX, tipY) pointing
 *  along (dirX, dirY) (need not be normalized). `size` is the nominal head
 *  length at the default strokeWidth of 3; see `headSize` for the scaling
 *  rule. Glyph catalogue (Excalidraw's option set):
 *
 *    arrow             open V of two stroked segments,       inset 0
 *    triangle          filled triangle (today's classic),    inset s
 *    triangle-outline  stroked closed triangle,              inset s
 *    bar               perpendicular stroke through the tip, inset 0
 *    dot               small filled circle touching the tip, inset 2r
 *    circle            larger filled circle,                 inset 2r
 *    circle-outline    larger stroked circle,                inset 2r
 *    diamond           filled rhombus,                       inset s
 *    diamond-outline   stroked closed rhombus,               inset s
 *    crowfoot-one      perpendicular bar behind the tip,     inset 0
 *    crowfoot-many     inverted V spreading to the tip line, inset 0
 *    crowfoot-one-many both of the above,                    inset 0
 */
export function arrowheadGeometry(
  type: ArrowheadType | undefined,
  tipX: number,
  tipY: number,
  dirX: number,
  dirY: number,
  size = 10,
  strokeWidth = 3,
): ArrowheadGeometry {
  const none: ArrowheadGeometry = { shaftInset: 0, fills: [], strokes: [] };
  if (!type || type === 'none') return none;

  const s = headSize(size, strokeWidth);
  const len = Math.hypot(dirX, dirY) || 1;
  const ux = dirX / len;
  const uy = dirY / len;
  // Perpendicular (rotate 90° CCW): (-uy, ux).
  const px = -uy;
  const py = ux;
  /** Point at `back` units behind the tip, offset `side` units sideways. */
  const at = (back: number, side: number): [number, number] =>
    [tipX - ux * back + px * side, tipY - uy * back + py * side];
  const seg = (a: [number, number], b: [number, number]) =>
    `M ${fmt(a[0])} ${fmt(a[1])} L ${fmt(b[0])} ${fmt(b[1])}`;
  const polyD = (pts: Array<[number, number]>, close: boolean) =>
    pts.map(([x, y], i) => `${i === 0 ? 'M' : 'L'} ${fmt(x)} ${fmt(y)}`).join(' ') + (close ? ' Z' : '');
  const circleD = (cx: number, cy: number, r: number) =>
    `M ${fmt(cx - r)} ${fmt(cy)} `
    + `a ${fmt(r)} ${fmt(r)} 0 1 0 ${fmt(2 * r)} 0 `
    + `a ${fmt(r)} ${fmt(r)} 0 1 0 ${fmt(-2 * r)} 0 Z`;

  const swGuard = strokeWidth / 2;
  const closedHead = (geo: ArrowheadGeometry, boundary: NonNullable<ArrowheadGeometry['boundary']>, d: string): ArrowheadGeometry => {
    // Local tip guard removes only cap spill immediately beyond this endpoint,
    // not unrelated portions of a path that happen to cross its tangent plane.
    const guard = polyD([at(0, swGuard), at(-swGuard, swGuard), at(-swGuard, -swGuard), at(0, -swGuard)], true);
    return { ...geo, boundary, shaftCuts: [d, guard] };
  };
  const polygonHead = (pts: number[], filled: boolean, inset: number): ArrowheadGeometry => {
    const pairs: Array<[number, number]> = [];
    for (let i = 0; i < pts.length; i += 2) pairs.push([pts[i], pts[i + 1]]);
    const d = polyD(pairs, true);
    return closedHead({ shaftInset: inset, fills: filled ? [{ points: pts }] : [], strokes: filled ? [] : [{ d }] }, { points: pts }, d);
  };

  switch (type) {
    case 'arrow':
      // Open V: wings at depth s, half-spread s/2 — same silhouette as the
      // classic triangle but stroked, with the shaft running to the tip.
      return {
        shaftInset: 0,
        fills: [],
        strokes: [{ d: `M ${fmt(at(s, s / 2)[0])} ${fmt(at(s, s / 2)[1])} L ${fmt(tipX)} ${fmt(tipY)} L ${fmt(at(s, -s / 2)[0])} ${fmt(at(s, -s / 2)[1])}` }],
      };
    case 'triangle': {
      const tri = arrowheadPoints(tipX, tipY, dirX, dirY, s);
      return polygonHead(tri, true, s);
    }
    case 'triangle-outline':
      return polygonHead([tipX, tipY, ...at(s, s / 2), ...at(s, -s / 2)], false, s);
    case 'bar':
      // Perpendicular stroke THROUGH the tip, spread s across.
      return { shaftInset: 0, fills: [], strokes: [{ d: seg(at(0, s / 2), at(0, -s / 2)) }] };
    case 'dot':
    case 'circle':
    case 'circle-outline': {
      // Circle tangent to the tip, centred back along the shaft. dot is the
      // small filled variant; circle the larger filled one; circle-outline
      // the larger stroked one. Shaft stops at the far side (2r) so the
      // outline variant shows no shaft crossing its interior.
      const r = type === 'dot' ? s * 0.3 : s * 0.5;
      const [cx, cy] = at(r, 0);
      const d = circleD(cx, cy, r);
      return closedHead(type === 'circle-outline'
        ? { shaftInset: 2 * r, fills: [], strokes: [{ d }] }
        : { shaftInset: 2 * r, fills: [{ d }], strokes: [] }, { cx, cy, radius: r }, d);
    }
    case 'diamond': {
      const pts = [tipX, tipY, ...at(s / 2, s / 2), ...at(s, 0), ...at(s / 2, -s / 2)];
      return polygonHead(pts, true, s);
    }
    case 'diamond-outline':
      return polygonHead([tipX, tipY, ...at(s / 2, s / 2), ...at(s, 0), ...at(s / 2, -s / 2)], false, s);
    case 'crowfoot-one':
      // Perpendicular bar sitting BEHIND the tip; shaft runs through it.
      return { shaftInset: 0, fills: [], strokes: [{ d: seg(at(s, s / 2), at(s, -s / 2)) }] };
    case 'crowfoot-many': {
      // Inverted V: from a point on the shaft at depth s, spreading out to
      // the tip line — the classic crow's foot.
      const back = at(s, 0);
      return {
        shaftInset: 0,
        fills: [],
        strokes: [{ d: `M ${fmt(at(0, s / 2)[0])} ${fmt(at(0, s / 2)[1])} L ${fmt(back[0])} ${fmt(back[1])} L ${fmt(at(0, -s / 2)[0])} ${fmt(at(0, -s / 2)[1])}` }],
      };
    }
    case 'crowfoot-one-many': {
      const back = at(s, 0);
      return {
        shaftInset: 0,
        fills: [],
        strokes: [
          { d: `M ${fmt(at(0, s / 2)[0])} ${fmt(at(0, s / 2)[1])} L ${fmt(back[0])} ${fmt(back[1])} L ${fmt(at(0, -s / 2)[0])} ${fmt(at(0, -s / 2)[1])}` },
          { d: seg(at(s * 1.5, s / 2), at(s * 1.5, -s / 2)) },
        ],
      };
    }
    default:
      return none;
  }
}

/** Bounding box for a vertex list. `translated` shifts the vertices to
 *  origin so the box's (x, y) is the new element position. */
export function pathBounds(points: number[]): {
  x: number;
  y: number;
  width: number;
  height: number;
  points: number[];
} {
  if (points.length < 2) return { x: 0, y: 0, width: 0, height: 0, points: [] };
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let i = 0; i < points.length; i += 2) {
    const px = points[i], py = points[i + 1];
    if (px < minX) minX = px;
    if (px > maxX) maxX = px;
    if (py < minY) minY = py;
    if (py > maxY) maxY = py;
  }
  const translated: number[] = [];
  for (let i = 0; i < points.length; i += 2) {
    translated.push(points[i] - minX, points[i + 1] - minY);
  }
  return {
    x: minX,
    y: minY,
    width: Math.max(1, maxX - minX),
    height: Math.max(1, maxY - minY),
    points: translated,
  };
}

/** Curve-aware bounding box for a vertex list. Linear / B-spline curves keep
 *  their control-point bounds. Through-point curves can bulge OUTSIDE the
 *  vertex bbox, so include every cubic derivative root (exact extrema). The returned
 *  `points` are the CONTROL vertices translated so the box's (x, y) is the
 *  new element position (tangents are vertex-relative and need no shift). */
export function pathBoundsFor(
  points: number[],
  curve: PathCurve,
  closed: boolean,
  tangents?: number[],
): { x: number; y: number; width: number; height: number; points: number[] } {
  if ((curve !== 'bezier' && curve !== 'smooth') || points.length < 4) return pathBounds(points);
  const handles = effectiveTangents(points, curve === 'smooth' ? undefined : tangents, closed);
  const samples = points.slice();
  const n = points.length / 2;
  for (let i = 0; i < (closed ? n : n - 1); i++) {
    const j = (i + 1) % n;
    for (let axis = 0; axis < 2; axis++) {
      const p0 = points[2 * i + axis], p3 = points[2 * j + axis];
      const p1 = p0 + handles[4 * i + 2 + axis], p2 = p3 + handles[4 * j + axis];
      const a = -p0 + 3 * p1 - 3 * p2 + p3, b = 2 * (p0 - 2 * p1 + p2), c = p1 - p0;
      const disc = b * b - 4 * a * c;
      const roots = Math.abs(a) < 1e-12 ? (Math.abs(b) < 1e-12 ? [] : [-c / b])
        : disc < 0 ? [] : [(-b + Math.sqrt(disc)) / (2 * a), (-b - Math.sqrt(disc)) / (2 * a)];
      for (const t of roots) {
        if (t <= 0 || t >= 1) continue;
        const u = 1 - t;
        const v = u ** 3 * p0 + 3 * u * u * t * p1 + 3 * u * t * t * p2 + t ** 3 * p3;
        // Only this axis matters; the other coordinate is an existing vertex.
        samples.push(axis === 0 ? v : points[2 * i], axis === 1 ? v : points[2 * i + 1]);
      }
    }
  }
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let i = 0; i < samples.length; i += 2) {
    if (samples[i] < minX) minX = samples[i];
    if (samples[i] > maxX) maxX = samples[i];
    if (samples[i + 1] < minY) minY = samples[i + 1];
    if (samples[i + 1] > maxY) maxY = samples[i + 1];
  }
  const translated: number[] = [];
  for (let i = 0; i < points.length; i += 2) {
    translated.push(points[i] - minX, points[i + 1] - minY);
  }
  return {
    x: minX,
    y: minY,
    width: Math.max(1, maxX - minX),
    height: Math.max(1, maxY - minY),
    points: translated,
  };
}

/** Resample a linear-segment path to exactly `targetN` vertices spaced at
 *  equal arc-length. Used by the controlPoints interpolator to make
 *  differing-N transitions smooth instead of snapping. */
export function resamplePath(points: number[], targetN: number, closed: boolean): number[] {
  const n = points.length / 2;
  if (n < 2 || targetN < 2) return points.slice();
  // Cumulative length per vertex.
  const seg = closed ? n : n - 1;
  const len: number[] = [0];
  for (let i = 0; i < seg; i++) {
    const a = i;
    const b = (i + 1) % n;
    len.push(len[i] + Math.hypot(points[2 * b] - points[2 * a], points[2 * b + 1] - points[2 * a + 1]));
  }
  const total = len[seg];
  if (total === 0) {
    const out: number[] = [];
    for (let i = 0; i < targetN; i++) out.push(points[0], points[1]);
    return out;
  }
  const out: number[] = [];
  for (let k = 0; k < targetN; k++) {
    const target = closed
      ? (total * k) / targetN
      : (total * k) / (targetN - 1);
    // Find segment that contains `target`.
    let s = 0;
    while (s < seg - 1 && len[s + 1] < target) s++;
    const segLen = len[s + 1] - len[s] || 1;
    const u = (target - len[s]) / segLen;
    const a = s, b = (s + 1) % n;
    out.push(
      points[2 * a] + (points[2 * b] - points[2 * a]) * u,
      points[2 * a + 1] + (points[2 * b + 1] - points[2 * a + 1]) * u,
    );
  }
  return out;
}

// -- internals ---------------------------------------------------------------

type Pt = [number, number];

function fmt(n: number): string { return n.toFixed(2); }

function repeat<T>(value: T, n: number): T[] {
  const out: T[] = [];
  for (let i = 0; i < n; i++) out.push(value);
  return out;
}

function cubicBasis(t: number): [number, number, number, number] {
  const t2 = t * t, t3 = t2 * t;
  return [
    (1 - 3 * t + 3 * t2 - t3) / 6,
    (4 - 6 * t2 + 3 * t3) / 6,
    (1 + 3 * t + 3 * t2 - 3 * t3) / 6,
    t3 / 6,
  ];
}

function quadBasis(t: number): [number, number, number] {
  const t2 = t * t;
  return [(1 - 2 * t + t2) / 2, (1 + 2 * t - 2 * t2) / 2, t2 / 2];
}

function sampleBspline(controls: Pt[], degree: 2 | 3, t: number): Pt {
  const basis = degree === 3 ? cubicBasis(t) : quadBasis(t);
  let x = 0, y = 0;
  for (let i = 0; i <= degree; i++) {
    x += basis[i] * controls[i][0];
    y += basis[i] * controls[i][1];
  }
  return [x, y];
}
