import type { ShapeElement } from '../types/presentation';

export interface CornerRadiusControl {
  /** Element-local corner and unit outgoing direction. */
  x: number;
  y: number;
  dx: number;
  dy: number;
  maxRadius: number;
  segmentLength?: number;
}

/** Rectangles adjust along the top edge. Linear paths adjust along an actual
 * first ordered segment, using the same half-adjacent-length
 * limit as pathD. A two-point line has no corner to round. The largest
 * roundable corner determines range independently of first-leg placement. */
export function cornerRadiusControl(element: ShapeElement): CornerRadiusControl | null {
  if (element.shapeType === 'rect') {
    return { x: 0, y: 0, dx: 1, dy: 0, maxRadius: Math.max(0, Math.min(element.width, element.height) / 2) };
  }
  const points = element.points ?? [];
  if (element.shapeType !== 'path' || (element.curve ?? 'linear') !== 'linear' || points.length < 6) return null;
  const n = points.length / 2;
  let best: CornerRadiusControl | null = null;
  for (let i = element.closed ? 0 : 1; i < (element.closed ? n : n - 1); i++) {
    const prev = (i + n - 1) % n, next = (i + 1) % n;
    const x = points[2 * i], y = points[2 * i + 1];
    const ax = points[2 * prev] - x, ay = points[2 * prev + 1] - y;
    const bx = points[2 * next] - x, by = points[2 * next + 1] - y;
    const a = Math.hypot(ax, ay), b = Math.hypot(bx, by);
    if (a < 1e-6 || b < 1e-6 || Math.abs(ax * by - ay * bx) < 1e-6 * a * b) continue;
    const maxRadius = Math.min(a, b) / 2;
    if (!best || maxRadius > best.maxRadius) best = { x, y, dx: bx / b, dy: by / b, maxRadius };
  }
  if (!best) return null;
  // Placement follows CURRENT vertex order, independent of the corner that
  // determines the global radius range. Skip only zero-length initial legs.
  for (let i = 0; i < n - 1; i++) {
    const x = points[2 * i], y = points[2 * i + 1];
    const dx = points[2 * i + 2] - x, dy = points[2 * i + 3] - y;
    const segmentLength = Math.hypot(dx, dy);
    if (segmentLength > 1e-6) return { x, y, dx: dx / segmentLength, dy: dy / segmentLength, maxRadius: best.maxRadius, segmentLength };
  }
  return null;
}

export type ControlHitEnvelope =
  | { kind: 'circle'; x: number; y: number; radius: number }
  | { kind: 'box'; x: number; y: number; width: number; height: number };

export interface CornerRadiusPlacement { start: number; end: number }

/** Widest unobstructed interval on the finite first leg; ties prefer vertex 2.
 * The entire hit envelope stays on that leg. Radius only maps visual travel:
 * pointer deltas retain their precise 1:1 radius mapping, even outside the leg. */
export function cornerRadiusClearance(
  control: CornerRadiusControl, zoom: number, hitRadius: number, obstacles: ControlHitEnvelope[],
): CornerRadiusPlacement | null {
  const length = control.segmentLength ?? 0;
  if (![length, zoom, hitRadius].every(Number.isFinite) || zoom <= 0 || hitRadius < 0) return null;
  const start = hitRadius, end = length - hitRadius;
  const tolerance = 0.01 / zoom;
  if (end - start <= tolerance) return null;
  const margin = hitRadius + 2 / zoom;
  const project = (x: number, y: number) => ({
    along: (x - control.x) * control.dx + (y - control.y) * control.dy,
    across: -(x - control.x) * control.dy + (y - control.y) * control.dx,
  });
  const forbidden: [number, number][] = [];
  for (const obstacle of obstacles) {
    let lo: number, hi: number;
    if (obstacle.kind === 'circle') {
      const p = project(obstacle.x, obstacle.y), r = obstacle.radius + margin;
      if (Math.abs(p.across) > r) continue;
      const half = Math.sqrt(Math.max(0, r * r - p.across * p.across));
      lo = p.along - half; hi = p.along + half;
    } else {
      const corners = [project(obstacle.x, obstacle.y), project(obstacle.x + obstacle.width, obstacle.y),
        project(obstacle.x, obstacle.y + obstacle.height), project(obstacle.x + obstacle.width, obstacle.y + obstacle.height)];
      if (Math.min(...corners.map(p => p.across)) > margin || Math.max(...corners.map(p => p.across)) < -margin) continue;
      lo = Math.min(...corners.map(p => p.along)) - margin;
      hi = Math.max(...corners.map(p => p.along)) + margin;
    }
    // Cull by envelope overlap, never by a remote control's center alone.
    if (hi < start || lo > end) continue;
    forbidden.push([lo, hi]);
  }
  forbidden.sort((a, b) => a[0] - b[0]);
  let cursor = start;
  let best: CornerRadiusPlacement | null = null;
  const consider = (lo: number, hi: number) => {
    const width = hi - lo;
    if (width <= tolerance) return;
    const bestWidth = best ? best.end - best.start : 0;
    if (!best || width > bestWidth + tolerance || (Math.abs(width - bestWidth) <= tolerance && lo > best.start)) {
      best = { start: lo, end: hi };
    }
  };
  for (const [lo, hi] of forbidden) {
    consider(cursor, Math.min(end, lo));
    cursor = Math.max(cursor, hi);
    if (cursor >= end) break;
  }
  consider(cursor, end);
  return best;
}

/** Read only explicit sibling control hits, in the radius group's unrotated
 * SVG coordinates. Native path circles supply their fine/coarse radii. Resize
 * Broad transparent side bands remain fallback hits, as for path vertices.
 * Explicit corners/rotation reserve the full 14-screen-pixel touch acquisition square,
 * which is larger than their visible DOM glyphs. No body/outline/guide bounds. */
export function readRadiusControlObstacles(frame: SVGGElement, zoom: number): ControlHitEnvelope[] | null {
  const svg = frame.ownerSVGElement, matrix = frame.getScreenCTM();
  if (!svg || !matrix || Math.abs(matrix.a * matrix.d - matrix.b * matrix.c) < 1e-12) return null;
  const inverse = matrix.inverse();
  const obstacles: ControlHitEnvelope[] = [];
  const nodes = svg.querySelectorAll<SVGGraphicsElement>(
    '.path-handles circle, .selection-transformer [data-resize-visual], .selection-transformer [data-rotation-visual]',
  );
  for (const node of nodes) {
    if (getComputedStyle(node).pointerEvents === 'none') continue;
    const screen = node.getScreenCTM();
    if (!screen || Math.abs(screen.a * screen.d - screen.b * screen.c) < 1e-12) return null;
    const transform = inverse.multiply(screen);
    const number = (name: string) => Number(node.getAttribute(name) ?? 0);
    const point = (x: number, y: number) => new DOMPoint(x, y).matrixTransform(transform);
    const expanded = node.hasAttribute('data-resize-visual') || node.hasAttribute('data-rotation-visual');
    if (node.tagName === 'circle' && !expanded) {
      const p = point(number('cx'), number('cy'));
      obstacles.push({ kind: 'circle', x: p.x, y: p.y,
        radius: number('r') * Math.max(Math.hypot(transform.a, transform.b), Math.hypot(transform.c, transform.d)) });
    } else {
      const cx = node.tagName === 'circle' ? number('cx') : number('x') + number('width') / 2;
      const cy = node.tagName === 'circle' ? number('cy') : number('y') + number('height') / 2;
      const halfW = expanded ? 14 / zoom : number('width') / 2;
      const halfH = expanded ? 14 / zoom : number('height') / 2;
      const corners = [point(cx - halfW, cy - halfH), point(cx + halfW, cy - halfH), point(cx - halfW, cy + halfH), point(cx + halfW, cy + halfH)];
      const x = Math.min(...corners.map(p => p.x)), y = Math.min(...corners.map(p => p.y));
      obstacles.push({ kind: 'box', x, y, width: Math.max(...corners.map(p => p.x)) - x, height: Math.max(...corners.map(p => p.y)) - y });
    }
  }
  return obstacles;
}
