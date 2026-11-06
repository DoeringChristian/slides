import type { ShapeElement, SlideElement } from '../../types/presentation';
import { catmullTangents, pathBoundsFor, sampledPath } from './pathShapes';
import { pathPointToSlide } from './pathEditing';

export function canJoinPaths(elements: readonly SlideElement[]): elements is ShapeElement[] {
  return elements.length >= 2 && new Set(elements.map(e => e.id)).size === elements.length && elements.every(e =>
    e.type === 'shape' && e.shapeType === 'path' && !e.geometry && !e.closed && !e.locked && e.visible !== false &&
    (e.points?.length ?? 0) >= 4 && e.points!.length % 2 === 0 && e.points!.every(Number.isFinite) &&
    // Rounded polylines need explicit arc conversion before joining different radii.
    !(e.cornerRadius > 0 && (e.curve ?? 'linear') === 'linear' && e.points!.length > 4));
}

type Vertex = { x: number; y: number; handles: number[] };
type Chain = { vertices: Vertex[]; startHead: ShapeElement['startHead']; endHead: ShapeElement['endHead']; startBinding: ShapeElement['startBinding']; endBinding: ShapeElement['endBinding'] };
function chain(el: ShapeElement): Chain {
  const curve = el.curve ?? 'linear';
  // B-splines are rendered as this same sampled polyline by the shared renderer.
  const points = curve.startsWith('bspline') ? sampledPath(el.points!, curve, false) : el.points!;
  const tangents = curve === 'smooth' || curve === 'bezier'
    ? (curve === 'bezier' && el.tangents?.length === points.length * 2 ? el.tangents : catmullTangents(points, false))
    : new Array(points.length * 2).fill(0);
  const a = el.rotation * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
  const vertices: Vertex[] = [];
  for (let i = 0; i < points.length; i += 2) {
    const handles: number[] = [];
    for (let h = i * 2; h < i * 2 + 4; h += 2) handles.push(tangents[h] * c - tangents[h + 1] * s, tangents[h] * s + tangents[h + 1] * c);
    vertices.push({ ...pathPointToSlide(el, points[i], points[i + 1]), handles });
  }
  return { vertices, startHead: el.startHead, endHead: el.endHead, startBinding: el.startBinding, endBinding: el.endBinding };
}
function reverse(a: Chain): Chain {
  return { vertices: [...a.vertices].reverse().map(v => ({ ...v, handles: [...v.handles.slice(2), ...v.handles.slice(0, 2)] })),
    startHead: a.endHead, endHead: a.startHead, startBinding: a.endBinding, endBinding: a.startBinding };
}
const distance = (a: Vertex, b: Vertex) => Math.hypot(a.x - b.x, a.y - b.y);
function append(a: Chain, b: Chain): Chain {
  const last = a.vertices.at(-1)!, first = b.vertices[0];
  if (distance(last, first) < 1e-6) {
    last.handles = [...last.handles.slice(0, 2), ...first.handles.slice(2)];
    a.vertices.push(...b.vertices.slice(1));
  } else {
    // A gap is a straight connecting span, never a newly inferred curve.
    last.handles.splice(2, 2, 0, 0); first.handles.splice(0, 2, 0, 0);
    a.vertices.push(...b.vertices);
  }
  return { ...a, endHead: b.endHead, endBinding: b.endBinding };
}

/** Join nearest available ends without moving any authored span. Retain the
 * first selected identity/style; consumed identities remain hidden keyframes. */
export function planJoinPaths(elements: readonly SlideElement[], ids: readonly string[]): Array<{ elementId: string; changes: Partial<SlideElement> }> {
  const selected = ids.map(id => elements.find(e => e.id === id));
  if (selected.some(e => !e) || !canJoinPaths(selected as SlideElement[])) return [];
  const paths = selected as ShapeElement[], target = paths[0];
  let joined = chain(target);
  const remaining = paths.slice(1).map(chain);
  while (remaining.length) {
    let best = { index: 0, prepend: false, reversed: false, distance: Infinity };
    remaining.forEach((candidate, index) => {
      for (const prepend of [false, true]) for (const reversed of [false, true]) {
        const endpoint = candidate.vertices[(prepend !== reversed) ? candidate.vertices.length - 1 : 0];
        const d = distance(endpoint, prepend ? joined.vertices[0] : joined.vertices.at(-1)!);
        if (d < best.distance) best = { index, prepend, reversed, distance: d };
      }
    });
    let next = remaining.splice(best.index, 1)[0];
    if (best.reversed) next = reverse(next);
    joined = best.prepend ? append(next, joined) : append(joined, next);
  }
  const points = joined.vertices.flatMap(v => [v.x, v.y]), tangents = joined.vertices.flatMap(v => v.handles);
  const curve = paths.some(e => e.curve === 'smooth' || e.curve === 'bezier') ? 'bezier' : 'linear';
  const binding = (b: ShapeElement['startBinding']) => b && !ids.includes(b.elementId) ? b : null;
  const updates: Array<{ elementId: string; changes: Partial<SlideElement> }> = [{ elementId: target.id, changes: {
    ...pathBoundsFor(points, curve, false, tangents), rotation: 0, curve, tangents, cornerRadius: 0,
    startHead: joined.startHead ?? 'none', endHead: joined.endHead ?? 'none',
    startBinding: binding(joined.startBinding), endBinding: binding(joined.endBinding),
  } }, ...paths.slice(1).map(e => ({ elementId: e.id, changes: { visible: false } }))];
  // Keep existing labels in place rather than discarding their text with a segment.
  for (const e of elements) if (e.type === 'text' && e.containerId && ids.slice(1).includes(e.containerId))
    updates.push({ elementId: e.id, changes: { containerId: null } });
  return updates;
}
