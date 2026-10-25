import type { ShapeElement } from '../types/presentation';
import { catmullTangents, pathBoundsFor } from './pathShapes';

/** Element-local vertex ↔ slide point, using the shared renderer's bbox centre. */
export function pathPointToSlide(el: ShapeElement, x: number, y: number): { x: number; y: number } {
  const a = el.rotation * Math.PI / 180, dx = x - el.width / 2, dy = y - el.height / 2;
  return { x: el.x + el.width / 2 + dx * Math.cos(a) - dy * Math.sin(a),
    y: el.y + el.height / 2 + dx * Math.sin(a) + dy * Math.cos(a) };
}
export function slidePointToPath(el: ShapeElement, x: number, y: number): { x: number; y: number } {
  const a = el.rotation * Math.PI / 180, dx = x - el.x - el.width / 2, dy = y - el.y - el.height / 2;
  return { x: el.width / 2 + dx * Math.cos(a) + dy * Math.sin(a),
    y: el.height / 2 - dx * Math.sin(a) + dy * Math.cos(a) };
}
export function pathPointsInSlide(el: ShapeElement): number[] {
  const out: number[] = [];
  const points = el.points ?? [];
  for (let i = 0; i < points.length; i += 2) {
    const p = pathPointToSlide(el, points[i], points[i + 1]);
    out.push(p.x, p.y);
  }
  return out;
}

/** Normalize LOCAL vertices without shifting their visible rotated positions.
 * Tangents are vertex-relative and therefore need no translation. */
export function pathGeometryUpdate(el: ShapeElement, points: number[], tangents?: number[]): Partial<ShapeElement> {
  const b = pathBoundsFor(points, el.curve ?? 'linear', !!el.closed, tangents);
  const center = pathPointToSlide(el, b.x + b.width / 2, b.y + b.height / 2);
  return { ...b, x: center.x - b.width / 2, y: center.y - b.height / 2,
    ...(tangents ? { tangents } : {}) };
}

/** Extension keeps every original manual tangent verbatim. Only newly inserted
 * vertices get estimates; missing Bézier tangents are frozen BEFORE extending
 * so the already-drawn spans do not get silently reshaped. */
export function pathExtensionUpdate(el: ShapeElement, slidePoints: number[], end: 'start' | 'end'): Partial<ShapeElement> {
  const local: number[] = [];
  for (let i = 0; i < slidePoints.length; i += 2) {
    const p = slidePointToPath(el, slidePoints[i], slidePoints[i + 1]);
    local.push(p.x, p.y);
  }
  const old = el.points ?? [];
  let tangents: number[] | undefined;
  if (el.curve === 'bezier' || el.tangents?.length === old.length * 2) {
    const original = el.tangents?.length === old.length * 2 ? el.tangents : catmullTangents(old, false);
    tangents = catmullTangents(local, false);
    tangents.splice(end === 'start' ? (local.length - old.length) * 2 : 0, original.length, ...original);
  }
  return pathGeometryUpdate(el, local, tangents);
}

/** Preserve path topology/handles while mapping its local geometry to a new
 * design box. A zero-size axis has no scale to infer, so keep it unchanged. */
export function pathGeometryInBox(element: ShapeElement, width: number, height: number): Pick<ShapeElement, 'points' | 'tangents'> {
  const sx = element.width === 0 ? 1 : width / element.width;
  const sy = element.height === 0 ? 1 : height / element.height;
  const scale = (values: number[] | undefined) => values?.map((v, i) => v * (i % 2 ? sy : sx));
  return { points: scale(element.points), tangents: scale(element.tangents) };
}
