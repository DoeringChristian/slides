/**
 * Pure, DOM-free geometry for cross-shape and cross-type morphs.
 *
 * Two layers live here:
 *
 *  1. The sample/align/lerp plumbing the path↔path morph in
 *     `interpolation.ts` has always used (moved here verbatim so both the
 *     interpolator and the new shape↔shape morph share one implementation):
 *     `polylineForMorph`, `rotateSamples`, `reverseSamples`,
 *     `bestAlignment`, `alignForMorph`, `lerpMorphedPaths`.
 *
 *  2. The universal-morph additions: `shapeToUnitOutline` (analytic outline
 *     sampling for EVERY shapeType in unit space), `morphShapeOutlines`
 *     (resample → align → pairwise lerp between two arbitrary shapes),
 *     `partitionOutline` (K contiguous equal-arc segments for the
 *     text↔shape glyph correspondence) and a small SVG transform-chain
 *     parser used to flatten text-layout glyph transforms.
 *
 * Everything is deterministic and cacheable; correspondence caches are keyed
 * on geometry keys (same pattern as `geomCache` in shapeToPath.ts).
 */
import type { ShapeElement, PathCurve } from '../types/presentation';
import { sampledPath, resamplePath } from './pathShapes';

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

// =============================================================================
// Moved from interpolation.ts — path-morph plumbing (unchanged behaviour)
// =============================================================================

/** Sample a path into a polyline suitable for the smooth curve / closed
 *  morph. When the source is closed, append the first sample at the end
 *  so the closing segment becomes an explicit polyline edge — the
 *  in-flight interpolated shape is rendered as an OPEN polyline, so the
 *  Z command can't add (or remove) a visible segment mid-transition. */
export function polylineForMorph(points: number[], curve: PathCurve, closed: boolean, tangents?: number[]): number[] {
  const samples = sampledPath(points, curve, closed, tangents);
  if (closed && samples.length >= 2) return [...samples, samples[0], samples[1]];
  return samples;
}

/** Cyclically rotate sample list by k (k * 2 in the flat array). */
export function rotateSamples(s: number[], k: number): number[] {
  const N = s.length / 2;
  if (N === 0 || k % N === 0) return s.slice();
  const out = new Array(s.length);
  for (let i = 0; i < N; i++) {
    const j = (i + k) % N;
    out[2 * i] = s[2 * j];
    out[2 * i + 1] = s[2 * j + 1];
  }
  return out;
}

/** Reverse a sample list end-to-end (used to test reversed traversal). */
export function reverseSamples(s: number[]): number[] {
  const N = s.length / 2;
  const out = new Array(s.length);
  for (let i = 0; i < N; i++) {
    out[2 * i] = s[2 * (N - 1 - i)];
    out[2 * i + 1] = s[2 * (N - 1 - i) + 1];
  }
  return out;
}

/** Pick the rotation (and forward/reverse orientation) of `closed` that
 *  minimizes Σ‖closed[(i+k) mod N] − reference[i]‖² to `reference`. The
 *  reference side stays put. Forward orientation is tried first so a tie
 *  resolves to the original winding (no spurious flip). */
export function bestAlignment(closed: number[], reference: number[]): number[] {
  const N = closed.length / 2;
  if (N < 2 || reference.length !== closed.length) return closed;
  let bestCost = Infinity;
  let bestK = 0;
  let bestReversed = false;
  const evaluate = (cand: number[], reversed: boolean) => {
    for (let k = 0; k < N; k++) {
      let cost = 0;
      for (let i = 0; i < N; i++) {
        const j = (i + k) % N;
        const dx = cand[2 * j] - reference[2 * i];
        const dy = cand[2 * j + 1] - reference[2 * i + 1];
        cost += dx * dx + dy * dy;
      }
      if (cost < bestCost) {
        bestCost = cost;
        bestK = k;
        bestReversed = reversed;
      }
    }
  };
  evaluate(closed, false);
  evaluate(reverseSamples(closed), true);
  return rotateSamples(bestReversed ? reverseSamples(closed) : closed, bestK);
}

/** Align two sampled polylines for a path morph. A closed side has
 *  cyclic + reflection freedom around its perimeter; it rotates / reverses
 *  to follow the other side. An open side's endpoints are fixed by user
 *  intent, so it never moves. When both are closed we only rotate one —
 *  rotating both by the same offset is a no-op on pairwise distance. */
export function alignForMorph(
  a: number[], b: number[],
  aClosed: boolean, bClosed: boolean,
): { a: number[]; b: number[] } {
  if (aClosed && !bClosed) return { a: bestAlignment(a, b), b };
  if (bClosed && !aClosed) return { a, b: bestAlignment(b, a) };
  if (aClosed && bClosed)  return { a: bestAlignment(a, b), b };
  return { a, b };
}

/** Sample-and-lerp morph between two paths of arbitrary curve / closed
 *  state. Steps: dense-sample each side → resample to a common N →
 *  cyclic-align the closed side(s) so each sample's travel is minimized
 *  (this is what stops the "inside-out" sweep when closed ↔ open) →
 *  pairwise lerp. The result is meant to be rendered as a plain open
 *  linear polyline. */
export function lerpMorphedPaths(
  aPoints: number[], aCurve: PathCurve, aClosed: boolean, aTangents: number[] | undefined,
  bPoints: number[], bCurve: PathCurve, bClosed: boolean, bTangents: number[] | undefined,
  t: number,
): number[] {
  const aS = polylineForMorph(aPoints, aCurve, aClosed, aTangents);
  const bS = polylineForMorph(bPoints, bCurve, bClosed, bTangents);
  const N = Math.max(aS.length, bS.length) / 2;
  const aR = aS.length === 2 * N ? aS : resamplePath(aS, N, false);
  const bR = bS.length === 2 * N ? bS : resamplePath(bS, N, false);
  const { a: aAlign, b: bAlign } = alignForMorph(aR, bR, aClosed, bClosed);
  return aAlign.map((v, i) => lerp(v, bAlign[i], t));
}

// =============================================================================
// Universal morph: analytic unit outlines per shapeType
// =============================================================================

export interface UnitOutline {
  /** Flat [x0,y0,…] in unit space [0,1]² relative to the shape's bounding
   *  box. Always exactly `n` points; a closed outline traverses the whole
   *  loop with its first point duplicated at the end (closing-edge bake,
   *  polylineForMorph-style), so equal-arc resampling accounts for the
   *  closing segment. */
  points: number[];
  closed: boolean;
}

/** Default sample density for shape outlines. Divisible by 4 so rect
 *  corners land exactly on samples (n−1 spans the loop). */
export const DEFAULT_MORPH_SAMPLES = 97;

/** Segments per quarter-arc when flattening rounded-rect corners. */
const ARC_SEGS = 8;

/** Bake the closing edge (duplicate first point at the end) of a loop. */
function bakeLoop(pts: number[]): number[] {
  if (pts.length >= 2) return [...pts, pts[0], pts[1]];
  return pts.slice();
}

/** Equal-arc resample of a baked loop / open polyline to exactly n points
 *  (open resampling: endpoints preserved). */
function resampleOpen(pts: number[], n: number): number[] {
  if (pts.length === 2 * n) return pts;
  return resamplePath(pts, n, false);
}

function rectOutlineVertices(shape: ShapeElement): number[] {
  const w = Math.max(1e-6, shape.width);
  const h = Math.max(1e-6, shape.height);
  // Same clamp as shapeToPathD's rect branch.
  const r = Math.min(shape.cornerRadius ?? 0, w / 2, h / 2);
  if (r <= 0) {
    // Corners in unit space, clockwise (screen coords, y down).
    return [0, 0, 1, 0, 1, 1, 0, 1];
  }
  // Rounded rect traced clockwise from (r, 0), corners as quarter-circle
  // arcs of radius r in local px space, then normalized to unit space
  // (where they become quarter-ellipse arcs, exactly like the `a r r`
  // commands in shapeToPathD do under non-uniform display scale).
  const out: number[] = [];
  const arc = (cx: number, cy: number, from: number, to: number) => {
    for (let i = 1; i <= ARC_SEGS; i++) {
      const a = from + ((to - from) * i) / ARC_SEGS;
      out.push((cx + r * Math.cos(a)) / w, (cy + r * Math.sin(a)) / h);
    }
  };
  out.push(r / w, 0);
  out.push((w - r) / w, 0);
  arc(w - r, r, -Math.PI / 2, 0);           // top-right
  out.push(1, (h - r) / h);
  arc(w - r, h - r, 0, Math.PI / 2);        // bottom-right
  out.push(r / w, 1);
  arc(r, h - r, Math.PI / 2, Math.PI);      // bottom-left
  out.push(0, r / h);
  arc(r, r, Math.PI, 1.5 * Math.PI);        // top-left
  return out;
}

function triangleOutlineVertices(shape: ShapeElement): number[] {
  // Copied from shapeToPathD's triangle branch, in box-local coords.
  const w = Math.max(1e-6, shape.width);
  const h = Math.max(1e-6, shape.height);
  const tcx = w / 2;
  const tcy = h / 2;
  const r = Math.min(w, h) / 2;
  const p0 = [tcx, tcy - r];
  const p1 = [tcx - r * Math.cos(Math.PI / 6), tcy + r * Math.sin(Math.PI / 6)];
  const p2 = [tcx + r * Math.cos(Math.PI / 6), tcy + r * Math.sin(Math.PI / 6)];
  return [p0[0] / w, p0[1] / h, p1[0] / w, p1[1] / h, p2[0] / w, p2[1] / h];
}

function starOutlineVertices(shape: ShapeElement): number[] {
  // Copied from shapeToPathD's star branch, in box-local coords.
  const w = Math.max(1e-6, shape.width);
  const h = Math.max(1e-6, shape.height);
  const scx = w / 2;
  const scy = h / 2;
  const outerR = Math.min(w, h) / 2;
  const innerR = outerR / 2;
  const out: number[] = [];
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? outerR : innerR;
    const angle = (i * Math.PI) / 5 - Math.PI / 2;
    out.push((scx + r * Math.cos(angle)) / w, (scy + r * Math.sin(angle)) / h);
  }
  return out;
}

function ellipseOutline(n: number): number[] {
  // cos/sin around the unit-space circle (which the box scales into the
  // ellipse), clockwise in screen coords starting at the right point. The
  // last point duplicates the first — bake included by construction.
  const out: number[] = [];
  for (let k = 0; k < n; k++) {
    const th = (2 * Math.PI * k) / (n - 1);
    out.push(0.5 + 0.5 * Math.cos(th), 0.5 + 0.5 * Math.sin(th));
  }
  return out;
}

function unitOutlineKey(shape: ShapeElement, n: number): string {
  return [
    shape.shapeType,
    shape.width, shape.height,
    shape.cornerRadius ?? 0,
    shape.points ? shape.points.join(',') : '',
    shape.tangents ? shape.tangents.join(',') : '',
    shape.closed ? 1 : 0,
    shape.curve ?? 'linear',
    n,
  ].join('|');
}

const unitOutlineCache = new Map<string, UnitOutline>();

/**
 * Closed outline of any shape, sampled to exactly `n` points in unit space
 * [0,1]² relative to the shape's bounding box. Analytic per shapeType (the
 * per-shape math mirrors `shapeToPathD`); path shapes go through
 * `sampledPath` (bezier honours `tangents`) with the closing edge baked in
 * for closed paths. Open paths (lines / arrows / open polylines) return
 * `closed: false` and keep their endpoints as the first/last sample.
 */
export function shapeToUnitOutline(shape: ShapeElement, n: number = DEFAULT_MORPH_SAMPLES): UnitOutline {
  const key = unitOutlineKey(shape, n);
  const hit = unitOutlineCache.get(key);
  if (hit) return hit;

  let pts: number[];
  let closed = true;
  switch (shape.shapeType) {
    case 'rect':
      pts = resampleOpen(bakeLoop(rectOutlineVertices(shape)), n);
      break;
    case 'triangle':
      pts = resampleOpen(bakeLoop(triangleOutlineVertices(shape)), n);
      break;
    case 'star':
      pts = resampleOpen(bakeLoop(starOutlineVertices(shape)), n);
      break;
    case 'ellipse':
      pts = ellipseOutline(n);
      break;
    case 'path':
    default: {
      const raw = shape.points ?? [];
      const w = Math.max(1e-6, shape.width);
      const h = Math.max(1e-6, shape.height);
      if (raw.length < 4) {
        // Degenerate — collapse to the box centre.
        pts = new Array(2 * n);
        for (let i = 0; i < n; i++) { pts[2 * i] = 0.5; pts[2 * i + 1] = 0.5; }
        closed = false;
        break;
      }
      closed = shape.closed ?? false;
      // polylineForMorph = sampledPath + closing-edge bake for closed paths.
      const samples = polylineForMorph(raw, shape.curve ?? 'linear', closed, shape.tangents);
      const unit = new Array(samples.length);
      for (let i = 0; i < samples.length; i += 2) {
        unit[i] = samples[i] / w;
        unit[i + 1] = samples[i + 1] / h;
      }
      pts = resampleOpen(unit, n);
      break;
    }
  }
  const out: UnitOutline = { points: pts, closed };
  unitOutlineCache.set(key, out);
  return out;
}

/** Whether a shape's outline is a closed loop (every primitive shape is;
 *  path shapes follow their `closed` flag). Used by the interpolator to
 *  decide whether the in-flight morph polyline may render with a Z (and
 *  therefore keep its fill) or must stay open. */
export function outlineIsClosed(shape: ShapeElement): boolean {
  return shape.shapeType !== 'path' || (shape.closed ?? false);
}

// Aligned unit-outline pair cache — the rotation/reflection search is the
// expensive part (O(N²)); geometry keys bound the cache to distinct shape
// geometries in the deck (geomCache pattern).
const alignedPairCache = new Map<string, { a: number[]; b: number[] }>();

function alignedUnitOutlines(a: ShapeElement, b: ShapeElement, n: number): { a: number[]; b: number[] } {
  const key = `${unitOutlineKey(a, n)}||${unitOutlineKey(b, n)}`;
  const hit = alignedPairCache.get(key);
  if (hit) return hit;
  const ua = shapeToUnitOutline(a, n);
  const ub = shapeToUnitOutline(b, n);
  // Alignment cost is evaluated at the MIDPOINT aspect so unit-space
  // distances approximate on-screen travel (a 4:1 box stretches unit dx
  // four times more than unit dy).
  const avgW = Math.max(1e-6, (a.width + b.width) / 2);
  const avgH = Math.max(1e-6, (a.height + b.height) / 2);
  const scale = (pts: number[]): number[] => {
    const out = new Array(pts.length);
    for (let i = 0; i < pts.length; i += 2) {
      out[i] = pts[i] * avgW;
      out[i + 1] = pts[i + 1] * avgH;
    }
    return out;
  };
  const aligned = alignForMorph(scale(ua.points), scale(ub.points), ua.closed, ub.closed);
  const unscale = (pts: number[]): number[] => {
    const out = new Array(pts.length);
    for (let i = 0; i < pts.length; i += 2) {
      out[i] = pts[i] / avgW;
      out[i + 1] = pts[i + 1] / avgH;
    }
    return out;
  };
  const result = { a: unscale(aligned.a), b: unscale(aligned.b) };
  alignedPairCache.set(key, result);
  return result;
}

/**
 * In-flight morph outline between two arbitrary shapes: both outlines are
 * sampled to a common N in unit space, cyclically aligned (rotation ×
 * reflection, cost scaled by the midpoint box aspect) and pairwise lerped
 * at `t`, then scaled to the interpolated box (`boxW`/`boxH` default to the
 * plainly-lerped dimensions; the interpolator passes its size-eased box so
 * the `size` group easing keeps governing scale). Returned points are
 * RELATIVE to the box origin — ready for a synthetic path ShapeElement.
 */
export function morphShapeOutlines(
  a: ShapeElement,
  b: ShapeElement,
  t: number,
  n: number = DEFAULT_MORPH_SAMPLES,
  boxW: number = lerp(a.width, b.width, t),
  boxH: number = lerp(a.height, b.height, t),
): number[] {
  const { a: ua, b: ub } = alignedUnitOutlines(a, b, n);
  const out = new Array(ua.length);
  for (let i = 0; i < ua.length; i += 2) {
    out[i] = lerp(ua[i], ub[i], t) * boxW;
    out[i + 1] = lerp(ua[i + 1], ub[i + 1], t) * boxH;
  }
  return out;
}

// =============================================================================
// Arc partition — text↔shape correspondence
// =============================================================================

/**
 * Split a polyline (typically a baked shape-outline loop) into `k`
 * contiguous equal-arc segments of `samplesPerSegment` points each. The
 * segments tile the outline exactly: segment i ends precisely where
 * segment i+1 begins, segment 0 starts at the outline's first point and
 * segment k−1 ends at its last. Deterministic — the same inputs always
 * produce the same partition, which is what makes the glyph↔segment
 * pairing direction-symmetric.
 */
export function partitionOutline(outline: number[], k: number, samplesPerSegment: number): number[][] {
  const nPts = outline.length / 2;
  if (k <= 0 || samplesPerSegment < 2 || nPts < 2) return [];
  // Cumulative arc length per vertex.
  const cum: number[] = [0];
  for (let i = 1; i < nPts; i++) {
    cum.push(cum[i - 1] + Math.hypot(
      outline[2 * i] - outline[2 * (i - 1)],
      outline[2 * i + 1] - outline[2 * (i - 1) + 1],
    ));
  }
  const total = cum[nPts - 1];
  const pointAt = (target: number): [number, number] => {
    if (total === 0) return [outline[0], outline[1]];
    let s = 0;
    while (s < nPts - 2 && cum[s + 1] < target) s++;
    const segLen = cum[s + 1] - cum[s] || 1;
    const u = Math.max(0, Math.min(1, (target - cum[s]) / segLen));
    return [
      outline[2 * s] + (outline[2 * (s + 1)] - outline[2 * s]) * u,
      outline[2 * s + 1] + (outline[2 * (s + 1) + 1] - outline[2 * s + 1]) * u,
    ];
  };
  const segments: number[][] = [];
  for (let i = 0; i < k; i++) {
    const seg: number[] = [];
    for (let j = 0; j < samplesPerSegment; j++) {
      // j = samplesPerSegment−1 yields exactly (i+1)/k — the identical float
      // the next segment computes for j = 0, so boundaries match exactly.
      const [x, y] = pointAt((total * (i + j / (samplesPerSegment - 1))) / k);
      seg.push(x, y);
    }
    segments.push(seg);
  }
  return segments;
}

// =============================================================================
// SVG transform-chain parser (translate / scale / matrix)
// =============================================================================

/** 2×3 affine matrix in SVG order: x' = a·x + c·y + e, y' = b·x + d·y + f. */
export type Mat2x3 = [number, number, number, number, number, number];

export const IDENTITY_MAT: Mat2x3 = [1, 0, 0, 1, 0, 0];

function matMul(A: Mat2x3, B: Mat2x3): Mat2x3 {
  return [
    A[0] * B[0] + A[2] * B[1],
    A[1] * B[0] + A[3] * B[1],
    A[0] * B[2] + A[2] * B[3],
    A[1] * B[2] + A[3] * B[3],
    A[0] * B[4] + A[2] * B[5] + A[4],
    A[1] * B[4] + A[3] * B[5] + A[5],
  ];
}

/**
 * Parse an SVG transform list of `translate(…)`, `scale(…)` and
 * `matrix(…)` commands (the only ones text-layout glyph transforms use)
 * into one flattened matrix. Commands compose left-to-right, exactly like
 * the SVG `transform` attribute. Unknown commands are ignored.
 */
export function parseTransformChain(transform: string | undefined): Mat2x3 {
  let m: Mat2x3 = IDENTITY_MAT;
  if (!transform) return m;
  const re = /(translate|scale|matrix)\s*\(([^)]*)\)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(transform)) !== null) {
    const args = match[2].split(/[\s,]+/).filter(Boolean).map(Number);
    switch (match[1]) {
      case 'translate':
        m = matMul(m, [1, 0, 0, 1, args[0] ?? 0, args[1] ?? 0]);
        break;
      case 'scale':
        m = matMul(m, [args[0] ?? 1, 0, 0, args[1] ?? args[0] ?? 1, 0, 0]);
        break;
      case 'matrix':
        if (args.length === 6) m = matMul(m, args as unknown as Mat2x3);
        break;
    }
  }
  return m;
}

/** Apply a flattened transform matrix to a point. */
export function applyMat(m: Mat2x3, x: number, y: number): [number, number] {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}
