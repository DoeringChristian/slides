import { constrainToAngle } from './geometry';
import { computePointSnap, type Guide } from '../hooks/useAlignmentGuides';
import { screenPixelsToSlide } from './screenSpace';

interface Point { x: number; y: number }

/** Alignment sources for one point: whole-element boxes contribute their edges
 * and centre, a degenerate zero-size box contributes exactly one x and one y. */
export type AlignmentSources = Parameters<typeof computePointSnap>[1];
export interface PointAlignment {
  others: AlignmentSources;
  marginBounds?: Parameters<typeof computePointSnap>[3];
}

/** Explicit Shift-only eight-ray constraint. Object/vertex alignment is a
 * separate caller policy; no angular attraction at all without Shift. */
export function snapPathPoint(point: Point, previous: Point[], zoom: number, shift = false,
  alignment?: PointAlignment,
): { point: Point; guides: Guide[] } {
  const origin = previous[0];
  const constrained = origin && shift ? constrainToAngle(point, origin, 45) : point;
  const snap = alignment ? computePointSnap(constrained, alignment.others, screenPixelsToSlide(5, zoom), alignment.marginBounds, shift ? origin : undefined) : null;
  const snapped = { x: snap?.snapX ?? constrained.x, y: snap?.snapY ?? constrained.y };
  return { point: snapped, guides: [
    ...(origin && shift ? [{ type: 'direction' as const, destination: snapped, x1: origin.x, y1: origin.y, x2: snapped.x, y2: snapped.y }] : []),
    ...(snap?.guides ?? []),
  ] };
}

/** A draft anchors to its live terminal: first vertex for start extension, last otherwise. */
export function draftReferences(vertices: number[], start = false): Point[] {
  const out: Point[] = [];
  for (let n = 0; n < Math.min(1, vertices.length / 2); n++) {
    const i = start ? n * 2 : vertices.length - 2 - n * 2;
    out.push({ x: vertices[i], y: vertices[i + 1] });
  }
  return out;
}

/** The path's OWN vertices as degenerate alignment sources: a vertex offers
 * exactly its own x and y — no box edges, no centre, and (unlike the removed
 * previous-point magnets) no angular attraction, so only the horizontal /
 * vertical magnets of `computePointSnap` can ever match it.
 * `points` is flat slide-space [x0,y0,x1,y1,…]; `exclude` lists vertex indices
 * that are not candidates — above all the vertex being dragged, which must
 * never snap to itself. */
export function vertexAlignmentSources(points: number[], exclude: readonly number[] = []): AlignmentSources {
  const skip = new Set(exclude);
  const out: AlignmentSources = [];
  for (let i = 0; 2 * i + 1 < points.length; i++) {
    if (skip.has(i)) continue;
    out.push({ x: points[2 * i], y: points[2 * i + 1], width: 0, height: 0 });
  }
  return out;
}

/** Compose same-path vertex magnets onto the caller's object/margin alignment.
 * Vertices come FIRST, in index order, so an exact tie resolves to the path's
 * own geometry and the first vertex outranks later ones. `undefined` means the
 * caller has magnets switched off (Cmd held, or snapping disabled) and stays
 * off — the explicit Shift ray is applied by `snapPathPoint` either way. */
export function withVertexMagnets(alignment: PointAlignment | undefined, points: number[],
  exclude: readonly number[] = []): PointAlignment | undefined {
  if (!alignment) return alignment;
  const vertices = vertexAlignmentSources(points, exclude);
  return vertices.length ? { ...alignment, others: [...vertices, ...alignment.others] } : alignment;
}

/** Display-only: binding intent can resolve to a different visible endpoint. */
export function resolvedPointGuides(guides: Guide[], endpoint: Point, origin?: Point): Guide[] {
  return guides.flatMap((guide): Guide[] => {
    if (guide.type === 'direction') return [{ ...guide, x1: origin?.x ?? guide.x1, y1: origin?.y ?? guide.y1,
      x2: endpoint.x, y2: endpoint.y, destination: endpoint }];
    if (guide.type === 'spacing') return [guide];
    if (Math.abs(guide.position - (guide.type === 'vertical' ? endpoint.x : endpoint.y)) > 1e-6) return [];
    return [{ ...guide, destination: endpoint }];
  });
}
