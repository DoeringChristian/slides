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

import type { PathCurve, ArrowheadType } from '../types/presentation';

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
function bezierPathD(points: number[], tangents: number[], closed: boolean): string {
  const n = points.length / 2;
  const cmds: string[] = [`M ${fmt(points[0])} ${fmt(points[1])}`];
  const segs = closed ? n : n - 1;
  for (let s = 0; s < segs; s++) {
    const i = s;
    const j = (s + 1) % n;
    const qx = points[2 * j], qy = points[2 * j + 1];
    const outX = tangents[4 * i + 2], outY = tangents[4 * i + 3];
    const inX = tangents[4 * j], inY = tangents[4 * j + 1];
    if (outX === 0 && outY === 0 && inX === 0 && inY === 0) {
      cmds.push(`L ${fmt(qx)} ${fmt(qy)}`);
    } else {
      const px = points[2 * i], py = points[2 * i + 1];
      cmds.push(
        `C ${fmt(px + outX)} ${fmt(py + outY)} ${fmt(qx + inX)} ${fmt(qy + inY)} ${fmt(qx)} ${fmt(qy)}`,
      );
    }
  }
  if (closed) cmds.push('Z');
  return cmds.join(' ');
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

function linearPathD(points: number[], closed: boolean, cornerRadius = 0): string {
  if (cornerRadius <= 0 || points.length < 6) {
    const cmds: string[] = [`M ${fmt(points[0])} ${fmt(points[1])}`];
    for (let i = 2; i < points.length; i += 2) {
      cmds.push(`L ${fmt(points[i])} ${fmt(points[i + 1])}`);
    }
    if (closed) cmds.push('Z');
    return cmds.join(' ');
  }
  // Rounded-corner polyline. Each interior vertex's L→L joint becomes
  // L(a) Q(corner) L(b), with `a` / `b` pulled `r` units toward the
  // neighbours along the incoming / outgoing edges. `r` clamps to half
  // the shorter adjacent edge so neighbouring corners can't overlap.
  const n = points.length / 2;
  const v = (i: number): Pt => {
    const idx = ((i % n) + n) % n;
    return [points[2 * idx], points[2 * idx + 1]];
  };
  const cornerOf = (i: number) => {
    const vi = v(i);
    const vp = v(i - 1);
    const vn = v(i + 1);
    const dxA = vp[0] - vi[0], dyA = vp[1] - vi[1];
    const dxB = vn[0] - vi[0], dyB = vn[1] - vi[1];
    const lenA = Math.hypot(dxA, dyA) || 1;
    const lenB = Math.hypot(dxB, dyB) || 1;
    const r = Math.min(cornerRadius, lenA / 2, lenB / 2);
    return {
      ax: vi[0] + (dxA / lenA) * r,
      ay: vi[1] + (dyA / lenA) * r,
      bx: vi[0] + (dxB / lenB) * r,
      by: vi[1] + (dyB / lenB) * r,
      vx: vi[0],
      vy: vi[1],
    };
  };
  const cmds: string[] = [];
  if (closed) {
    const c0 = cornerOf(0);
    cmds.push(`M ${fmt(c0.bx)} ${fmt(c0.by)}`);
    for (let i = 1; i < n; i++) {
      const c = cornerOf(i);
      cmds.push(`L ${fmt(c.ax)} ${fmt(c.ay)}`);
      cmds.push(`Q ${fmt(c.vx)} ${fmt(c.vy)} ${fmt(c.bx)} ${fmt(c.by)}`);
    }
    cmds.push(`L ${fmt(c0.ax)} ${fmt(c0.ay)}`);
    cmds.push(`Q ${fmt(c0.vx)} ${fmt(c0.vy)} ${fmt(c0.bx)} ${fmt(c0.by)}`);
    cmds.push('Z');
  } else {
    cmds.push(`M ${fmt(points[0])} ${fmt(points[1])}`);
    for (let i = 1; i < n - 1; i++) {
      const c = cornerOf(i);
      cmds.push(`L ${fmt(c.ax)} ${fmt(c.ay)}`);
      cmds.push(`Q ${fmt(c.vx)} ${fmt(c.vy)} ${fmt(c.bx)} ${fmt(c.by)}`);
    }
    cmds.push(`L ${fmt(points[points.length - 2])} ${fmt(points[points.length - 1])}`);
  }
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
    }
  }
  return samples;
}

/** Public sampler: returns the polyline approximation of a path for any
 *  curve mode. Linear paths pass through; bsplines and béziers are
 *  sampled (béziers honour `tangents`, falling back to Catmull-Rom
 *  estimates exactly like `pathD`). */
export function sampledPath(points: number[], curve: PathCurve, closed: boolean, tangents?: number[]): number[] {
  if (curve === 'linear') return points.slice();
  if (curve === 'bezier') {
    if (points.length < 4) return points.slice();
    return bezierSamples(points, effectiveTangents(points, tangents, closed), closed);
  }
  const degree = curve === 'bspline2' ? 2 : 3;
  return bsplineSamples(points, degree, closed);
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
  const out = points.slice();
  if (startInset > 0) {
    const p0x = out[0], p0y = out[1];
    const p1x = out[2], p1y = out[3];
    const dx = p1x - p0x, dy = p1y - p0y;
    const len = Math.hypot(dx, dy);
    if (len > startInset) {
      out[0] = p0x + (startInset / len) * dx;
      out[1] = p0y + (startInset / len) * dy;
    }
  }
  if (endInset > 0) {
    const n = out.length;
    const pNx = out[n - 2], pNy = out[n - 1];
    const pPx = out[n - 4], pPy = out[n - 3];
    const dx = pPx - pNx, dy = pPy - pNy;
    const len = Math.hypot(dx, dy);
    if (len > endInset) {
      out[n - 2] = pNx + (endInset / len) * dx;
      out[n - 1] = pNy + (endInset / len) * dy;
    }
  }
  return out;
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
 *  shaftInset — how far the shaft must stop short of the tip so it doesn't
 *            poke through the glyph (0 for open glyphs). Feed into
 *            `insetEndpoints`. */
export interface ArrowheadGeometry {
  shaftInset: number;
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
      return { shaftInset: s, fills: [{ points: tri }], strokes: [] };
    }
    case 'triangle-outline':
      return {
        shaftInset: s,
        fills: [],
        strokes: [{ d: polyD([[tipX, tipY], at(s, s / 2), at(s, -s / 2)], true) }],
      };
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
      return type === 'circle-outline'
        ? { shaftInset: 2 * r, fills: [], strokes: [{ d }] }
        : { shaftInset: 2 * r, fills: [{ d }], strokes: [] };
    }
    case 'diamond': {
      const pts = [tipX, tipY, ...at(s / 2, s / 2), ...at(s, 0), ...at(s / 2, -s / 2)];
      return { shaftInset: s, fills: [{ points: pts }], strokes: [] };
    }
    case 'diamond-outline':
      return {
        shaftInset: s,
        fills: [],
        strokes: [{ d: polyD([[tipX, tipY], at(s / 2, s / 2), at(s, 0), at(s / 2, -s / 2)], true) }],
      };
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

/** Curve-aware bounding box for a vertex list. Non-bezier curves keep the
 *  historical control-point bounds (B-splines stay inside their control
 *  hull, so those were already conservative-correct). Bézier curves can
 *  bulge OUTSIDE their vertex bbox — tangent handles pull the curve out —
 *  so their box is computed from the sampled polyline. The returned
 *  `points` are the CONTROL vertices translated so the box's (x, y) is the
 *  new element position (tangents are vertex-relative and need no shift). */
export function pathBoundsFor(
  points: number[],
  curve: PathCurve,
  closed: boolean,
  tangents?: number[],
): { x: number; y: number; width: number; height: number; points: number[] } {
  if (curve !== 'bezier' || points.length < 4) return pathBounds(points);
  const samples = sampledPath(points, 'bezier', closed, tangents);
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
