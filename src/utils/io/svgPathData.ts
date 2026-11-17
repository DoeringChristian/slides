/**
 * SVG geometry for the SVG importer: path data and basic shapes as contours
 * of lines and cubic Béziers in absolute coordinates.
 *
 * Everything is reduced to lines and cubics — quadratic, smooth and arc
 * commands included — because an affine transform maps a cubic exactly onto
 * another cubic, while an arc under rotation or skew is no longer an
 * axis-aligned arc. The importer can therefore apply any SVG transform
 * without approximation beyond the standard arc-to-cubic split.
 */

export type Pt = [number, number];
export type Segment = { kind: 'line'; to: Pt } | { kind: 'cubic'; c1: Pt; c2: Pt; to: Pt };
export interface Contour { start: Pt; segments: Segment[]; closed: boolean }
/** SVG 2D affine matrix (a b c d e f), as DOMMatrix exposes it. */
export interface Matrix { a: number; b: number; c: number; d: number; e: number; f: number }

const KAPPA = 0.5522847498307936;

// ── Path data ──────────────────────────────────────────────────────────────

const COMMAND = /[MmLlHhVvCcSsQqTtAaZz]/;
const NUMBER = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/;

/** Tokens of path data. Arc flags are single digits that may be written
 *  without separators ("a1 1 0 011 1"), so they are read one character at a
 *  time when an arc expects them. */
function* tokens(d: string): Generator<string | number> {
  let i = 0;
  const arcArgs: number[] = [];
  let inArc = false;
  while (i < d.length) {
    const ch = d[i];
    if (/[\s,]/.test(ch)) { i++; continue; }
    if (COMMAND.test(ch)) {
      inArc = ch === 'A' || ch === 'a';
      arcArgs.length = 0;
      yield ch; i++; continue;
    }
    // Arc flags: the 4th and 5th numbers of each 7-number arc group.
    const argIndex = arcArgs.length % 7;
    if (inArc && (argIndex === 3 || argIndex === 4) && (ch === '0' || ch === '1')) {
      arcArgs.push(+ch); yield +ch; i++; continue;
    }
    const m = NUMBER.exec(d.slice(i));
    if (!m) throw new Error(`Bad path data near "${d.slice(i, i + 12)}"`);
    if (inArc) arcArgs.push(+m[0]);
    yield +m[0];
    i += m[0].length;
  }
}

/** Parse SVG path data into absolute contours of lines and cubics. */
export function parsePathData(d: string): Contour[] {
  const contours: Contour[] = [];
  let current: Contour | null = null;
  let p: Pt = [0, 0];
  let start: Pt = [0, 0];
  let lastCubicC2: Pt | null = null;
  let lastQuadC: Pt | null = null;
  let cmd = '';
  const stream = [...tokens(d)];
  let i = 0;
  const num = () => {
    const v = stream[i++];
    if (typeof v !== 'number') throw new Error('Bad path data: expected a number');
    return v;
  };
  const ensure = () => {
    if (!current) { current = { start: [...p] as Pt, segments: [], closed: false }; contours.push(current); }
    return current;
  };
  const line = (to: Pt) => { ensure().segments.push({ kind: 'line', to }); p = to; };
  const cubic = (c1: Pt, c2: Pt, to: Pt) => { ensure().segments.push({ kind: 'cubic', c1, c2, to }); p = to; };

  while (i < stream.length) {
    if (typeof stream[i] === 'string') cmd = stream[i++] as string;
    else if (!cmd) throw new Error('Bad path data: missing command');
    const rel = cmd === cmd.toLowerCase();
    const at = (x: number, y: number): Pt => (rel ? [p[0] + x, p[1] + y] : [x, y]);
    const C = cmd.toUpperCase();
    let cubicC2: Pt | null = null, quadC: Pt | null = null;
    switch (C) {
      case 'M': {
        p = at(num(), num());
        start = p;
        current = { start: [...p] as Pt, segments: [], closed: false };
        contours.push(current);
        // Further pairs after a moveto are implicit linetos.
        cmd = rel ? 'l' : 'L';
        break;
      }
      case 'L': line(at(num(), num())); break;
      case 'H': { const x = num(); line([rel ? p[0] + x : x, p[1]]); break; }
      case 'V': { const y = num(); line([p[0], rel ? p[1] + y : y]); break; }
      case 'C': {
        const c1 = at(num(), num()), c2 = at(num(), num()), to = at(num(), num());
        cubic(c1, c2, to); cubicC2 = c2; break;
      }
      case 'S': {
        const c1: Pt = lastCubicC2 ? [2 * p[0] - lastCubicC2[0], 2 * p[1] - lastCubicC2[1]] : [...p] as Pt;
        const c2 = at(num(), num()), to = at(num(), num());
        cubic(c1, c2, to); cubicC2 = c2; break;
      }
      case 'Q': {
        const q = at(num(), num()), to = at(num(), num());
        const from = p;
        cubic([from[0] + 2 / 3 * (q[0] - from[0]), from[1] + 2 / 3 * (q[1] - from[1])], [to[0] + 2 / 3 * (q[0] - to[0]), to[1] + 2 / 3 * (q[1] - to[1])], to);
        quadC = q; break;
      }
      case 'T': {
        const q: Pt = lastQuadC ? [2 * p[0] - lastQuadC[0], 2 * p[1] - lastQuadC[1]] : [...p] as Pt;
        const to = at(num(), num()), from = p;
        cubic([from[0] + 2 / 3 * (q[0] - from[0]), from[1] + 2 / 3 * (q[1] - from[1])], [to[0] + 2 / 3 * (q[0] - to[0]), to[1] + 2 / 3 * (q[1] - to[1])], to);
        quadC = q; break;
      }
      case 'A': {
        const rx = num(), ry = num(), phi = num(), large = num(), sweep = num();
        const to = at(num(), num());
        for (const s of arcToCubics(p, rx, ry, phi, !!large, !!sweep, to)) {
          if (s.kind === 'line') line(s.to); else cubic(s.c1, s.c2, s.to);
        }
        break;
      }
      case 'Z': {
        if (current) {
          const c: Contour = current;
          c.closed = true;
        }
        p = start;
        current = null;
        break;
      }
      default: throw new Error(`Unsupported path command ${cmd}`);
    }
    lastCubicC2 = cubicC2;
    lastQuadC = quadC;
  }
  return contours.filter(c => c.segments.length > 0);
}

/** Endpoint-parameterised SVG arc → cubics (≤ 90° each). */
export function arcToCubics(from: Pt, rx: number, ry: number, phiDeg: number, large: boolean, sweep: boolean, to: Pt): Segment[] {
  if (from[0] === to[0] && from[1] === to[1]) return [];
  rx = Math.abs(rx); ry = Math.abs(ry);
  if (!rx || !ry) return [{ kind: 'line', to }];
  const phi = phiDeg * Math.PI / 180, cos = Math.cos(phi), sin = Math.sin(phi);
  const dx = (from[0] - to[0]) / 2, dy = (from[1] - to[1]) / 2;
  const x1 = cos * dx + sin * dy, y1 = -sin * dx + cos * dy;
  const lambda = (x1 * x1) / (rx * rx) + (y1 * y1) / (ry * ry);
  if (lambda > 1) { rx *= Math.sqrt(lambda); ry *= Math.sqrt(lambda); }
  const sign = large === sweep ? -1 : 1;
  const num = rx * rx * ry * ry - rx * rx * y1 * y1 - ry * ry * x1 * x1;
  const coef = sign * Math.sqrt(Math.max(0, num / (rx * rx * y1 * y1 + ry * ry * x1 * x1)));
  const cx1 = coef * (rx * y1 / ry), cy1 = coef * -(ry * x1 / rx);
  const cx = cos * cx1 - sin * cy1 + (from[0] + to[0]) / 2;
  const cy = sin * cx1 + cos * cy1 + (from[1] + to[1]) / 2;
  const angle = (ux: number, uy: number, vx: number, vy: number) => {
    const a = Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
    return a;
  };
  const theta1 = angle(1, 0, (x1 - cx1) / rx, (y1 - cy1) / ry);
  let delta = angle((x1 - cx1) / rx, (y1 - cy1) / ry, (-x1 - cx1) / rx, (-y1 - cy1) / ry);
  if (!sweep && delta > 0) delta -= 2 * Math.PI;
  if (sweep && delta < 0) delta += 2 * Math.PI;
  const parts = Math.max(1, Math.ceil(Math.abs(delta) / (Math.PI / 2) - 1e-9));
  const step = delta / parts;
  const k = 4 / 3 * Math.tan(step / 4);
  const point = (t: number): Pt => [cx + rx * Math.cos(t) * cos - ry * Math.sin(t) * sin, cy + rx * Math.cos(t) * sin + ry * Math.sin(t) * cos];
  const deriv = (t: number): Pt => [-rx * Math.sin(t) * cos - ry * Math.cos(t) * sin, -rx * Math.sin(t) * sin + ry * Math.cos(t) * cos];
  const out: Segment[] = [];
  for (let i = 0; i < parts; i++) {
    const t0 = theta1 + i * step, t1 = t0 + step;
    const p0 = point(t0), p1 = i === parts - 1 ? to : point(t1);
    const d0 = deriv(t0), d1 = deriv(t1);
    out.push({ kind: 'cubic', c1: [p0[0] + k * d0[0], p0[1] + k * d0[1]], c2: [p1[0] - k * d1[0], p1[1] - k * d1[1]], to: p1 });
  }
  return out;
}

// ── Basic shapes ───────────────────────────────────────────────────────────

export function ellipseContour(cx: number, cy: number, rx: number, ry: number): Contour {
  const kx = rx * KAPPA, ky = ry * KAPPA;
  return {
    start: [cx + rx, cy],
    closed: true,
    segments: [
      { kind: 'cubic', c1: [cx + rx, cy + ky], c2: [cx + kx, cy + ry], to: [cx, cy + ry] },
      { kind: 'cubic', c1: [cx - kx, cy + ry], c2: [cx - rx, cy + ky], to: [cx - rx, cy] },
      { kind: 'cubic', c1: [cx - rx, cy - ky], c2: [cx - kx, cy - ry], to: [cx, cy - ry] },
      { kind: 'cubic', c1: [cx + kx, cy - ry], c2: [cx + rx, cy - ky], to: [cx + rx, cy] },
    ],
  };
}

export function rectContour(x: number, y: number, w: number, h: number, rx = 0, ry = 0): Contour {
  if (!rx && ry) rx = ry;
  if (!ry && rx) ry = rx;
  rx = Math.min(Math.max(0, rx), w / 2); ry = Math.min(Math.max(0, ry), h / 2);
  if (!rx || !ry) {
    return { start: [x, y], closed: true, segments: [
      { kind: 'line', to: [x + w, y] }, { kind: 'line', to: [x + w, y + h] }, { kind: 'line', to: [x, y + h] }, { kind: 'line', to: [x, y] },
    ] };
  }
  const kx = rx * KAPPA, ky = ry * KAPPA;
  return { start: [x + rx, y], closed: true, segments: [
    { kind: 'line', to: [x + w - rx, y] },
    { kind: 'cubic', c1: [x + w - rx + kx, y], c2: [x + w, y + ry - ky], to: [x + w, y + ry] },
    { kind: 'line', to: [x + w, y + h - ry] },
    { kind: 'cubic', c1: [x + w, y + h - ry + ky], c2: [x + w - rx + kx, y + h], to: [x + w - rx, y + h] },
    { kind: 'line', to: [x + rx, y + h] },
    { kind: 'cubic', c1: [x + rx - kx, y + h], c2: [x, y + h - ry + ky], to: [x, y + h - ry] },
    { kind: 'line', to: [x, y + ry] },
    { kind: 'cubic', c1: [x, y + ry - ky], c2: [x + rx - kx, y], to: [x + rx, y] },
  ] };
}

/** `points` attribute of polyline/polygon. */
export function pointsContour(points: string, closed: boolean): Contour | null {
  const v = (points.match(/[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/g) ?? []).map(Number);
  if (v.length < 4) return null;
  const segments: Segment[] = [];
  for (let i = 2; i + 1 < v.length; i += 2) segments.push({ kind: 'line', to: [v[i], v[i + 1]] });
  return { start: [v[0], v[1]], segments, closed };
}

// ── Transform and bounds ───────────────────────────────────────────────────

export function applyMatrix(contours: Contour[], m: Matrix): Contour[] {
  const t = ([x, y]: Pt): Pt => [m.a * x + m.c * y + m.e, m.b * x + m.d * y + m.f];
  return contours.map(c => ({
    start: t(c.start),
    closed: c.closed,
    segments: c.segments.map(s => (s.kind === 'line' ? { kind: 'line', to: t(s.to) } : { kind: 'cubic', c1: t(s.c1), c2: t(s.c2), to: t(s.to) })),
  }));
}

/** The factor a matrix scales lengths by (geometric mean of its axes). */
export const matrixScale = (m: Matrix) => Math.sqrt(Math.abs(m.a * m.d - m.b * m.c));

/** Exact bounds: a cubic's extrema are where its derivative is zero, not at
 *  its control points. */
export function contoursBounds(contours: Contour[]): { x: number; y: number; width: number; height: number } | null {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const add = ([x, y]: Pt) => { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); };
  const roots = (a: number, b: number, c: number): number[] => {
    if (Math.abs(a) < 1e-12) return Math.abs(b) < 1e-12 ? [] : [-c / b];
    const disc = b * b - 4 * a * c;
    if (disc < 0) return [];
    const s = Math.sqrt(disc);
    return [(-b + s) / (2 * a), (-b - s) / (2 * a)];
  };
  for (const c of contours) {
    let p = c.start;
    add(p);
    for (const s of c.segments) {
      if (s.kind === 'cubic') {
        for (const axis of [0, 1] as const) {
          const [p0, p1, p2, p3] = [p[axis], s.c1[axis], s.c2[axis], s.to[axis]];
          for (const t of roots(3 * (-p0 + 3 * p1 - 3 * p2 + p3), 6 * (p0 - 2 * p1 + p2), 3 * (p1 - p0))) {
            if (t <= 0 || t >= 1) continue;
            const mt = 1 - t;
            const at = (q0: number, q1: number, q2: number, q3: number) => mt * mt * mt * q0 + 3 * mt * mt * t * q1 + 3 * mt * t * t * q2 + t * t * t * q3;
            add([at(p[0], s.c1[0], s.c2[0], s.to[0]), at(p[1], s.c1[1], s.c2[1], s.to[1])]);
          }
        }
      }
      add(s.to);
      p = s.to;
    }
  }
  return Number.isFinite(x0) ? { x: x0, y: y0, width: x1 - x0, height: y1 - y0 } : null;
}
