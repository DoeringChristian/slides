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

import type { PathCurve } from '../types/presentation';

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

/** Convenience: true for any path-shape element. */
export function isPathShape(shape: { shapeType?: string }): boolean {
  return shape.shapeType === 'path';
}

export function pathD(points: number[], curve: PathCurve, closed: boolean): string {
  if (points.length < 4) return '';
  if (curve === 'linear') return linearPathD(points, closed);
  const degree = curve === 'bspline2' ? 2 : 3;
  return bsplinePathD(points, degree, closed);
}

function linearPathD(points: number[], closed: boolean): string {
  const cmds: string[] = [`M ${fmt(points[0])} ${fmt(points[1])}`];
  for (let i = 2; i < points.length; i += 2) {
    cmds.push(`L ${fmt(points[i])} ${fmt(points[i + 1])}`);
  }
  if (closed) cmds.push('Z');
  return cmds.join(' ');
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
  const samples: number[] = [];
  const SAMPLES_PER_SEG = 16;
  const numSegs = padded.length - degree;
  for (let seg = 0; seg < numSegs; seg++) {
    const controls = padded.slice(seg, seg + degree + 1);
    const lastSeg = seg === numSegs - 1;
    for (let s = 0; s <= SAMPLES_PER_SEG; s++) {
      if (s === 0 && seg > 0) continue;
      if (s === SAMPLES_PER_SEG && !lastSeg) continue;
      const [x, y] = sampleBspline(controls, degree, s / SAMPLES_PER_SEG);
      samples.push(x, y);
    }
  }
  return samples;
}

/** Public sampler: returns the polyline approximation of a path for any
 *  curve mode. Linear paths pass through; bsplines are sampled. */
export function sampledPath(points: number[], curve: PathCurve, closed: boolean): number[] {
  if (curve === 'linear') return points.slice();
  const degree = curve === 'bspline2' ? 2 : 3;
  return bsplineSamples(points, degree, closed);
}

/** Return a points list with the first / last vertex pulled back along the
 *  outgoing tangent by `headLen`, so a rendered path that ends in an
 *  arrowhead doesn't poke through the triangle to the tip. The tip itself
 *  (used by `arrowheadPoints`) stays at the ORIGINAL endpoint — only the
 *  shaft is shortened. Returns the same array reference unchanged when no
 *  arrows are requested. */
export function insetEndpoints(
  points: number[],
  startArrow: boolean,
  endArrow: boolean,
  headLen = 10,
): number[] {
  if (!startArrow && !endArrow) return points;
  if (points.length < 4) return points;
  const out = points.slice();
  if (startArrow) {
    const p0x = out[0], p0y = out[1];
    const p1x = out[2], p1y = out[3];
    const dx = p1x - p0x, dy = p1y - p0y;
    const len = Math.hypot(dx, dy);
    if (len > headLen) {
      out[0] = p0x + (headLen / len) * dx;
      out[1] = p0y + (headLen / len) * dy;
    }
  }
  if (endArrow) {
    const n = out.length;
    const pNx = out[n - 2], pNy = out[n - 1];
    const pPx = out[n - 4], pPy = out[n - 3];
    const dx = pPx - pNx, dy = pPy - pNy;
    const len = Math.hypot(dx, dy);
    if (len > headLen) {
      out[n - 2] = pNx + (headLen / len) * dx;
      out[n - 1] = pNy + (headLen / len) * dy;
    }
  }
  return out;
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
