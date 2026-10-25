import type { ShapeElement, VectorContour, VectorGeometry, VectorPoint } from '../types/presentation';

/** Pure shared seam: paint regions and independent strokes never get joined. */
export function vectorContourD(contour: VectorContour, shape: Pick<ShapeElement, 'x' | 'y' | 'width' | 'height'>, close = contour.closed): string {
  const point = ([x, y]: VectorPoint) => `${shape.x + x * shape.width} ${shape.y + y * shape.height}`;
  let previous = contour.start;
  const commands = [`M ${point(previous)}`];
  for (const segment of contour.segments) {
    if (segment.kind === 'line') commands.push(`L ${point(segment.to)}`);
    else if (segment.kind === 'cubic') commands.push(`C ${point(segment.c1)} ${point(segment.c2)} ${point(segment.to)}`);
    else if (segment.to[0] !== previous[0] || segment.to[1] !== previous[1]) {
      const rx = Math.abs(segment.radii[0] * shape.width), ry = Math.abs(segment.radii[1] * shape.height);
      commands.push(rx && ry ? `A ${rx} ${ry} 0 ${+segment.largeArc} ${+segment.sweep} ${point(segment.to)}` : `L ${point(segment.to)}`);
    }
    previous = segment.to;
  }
  if (close) commands.push('Z');
  return commands.join(' ');
}

export function resolveShapeGeometry(shape: ShapeElement) {
  const geometry = shape.shapeType === 'vector' ? shape.geometry : undefined;
  const contours = new Map(geometry?.contours.map(contour => [contour.id, contour]));
  return {
    fills: (geometry?.fills ?? []).map(region => ({
      d: region.contourIds.map(id => contours.has(id) ? vectorContourD(contours.get(id)!, shape, true) : '').join(' '),
      rule: region.rule,
    })),
    strokes: (geometry?.strokes ?? []).flatMap(id => contours.has(id) ? [vectorContourD(contours.get(id)!, shape)] : []),
  };
}

/** Only identical paint roles, contour IDs, segment kinds and arc flags morph.
 * Unsupported topology uses a CROSSFADE, never a joined/resampled outline. */
export function vectorTopology(geometry: VectorGeometry): string {
  return JSON.stringify([geometry.fills, geometry.strokes, geometry.contours.map(c => [c.id, c.closed,
    c.segments.map(s => s.kind === 'arc' ? [s.kind, s.largeArc, s.sweep] : s.kind)])]);
}
export function interpolateVectorGeometry(a: VectorGeometry, b: VectorGeometry, t: number): VectorGeometry | undefined {
  if (vectorTopology(a) !== vectorTopology(b)) return undefined;
  if (t === 0) return a;
  if (t === 1) return b;
  const point = (p: VectorPoint, q: VectorPoint): VectorPoint => [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t];
  return { ...b, contours: a.contours.map((c, i) => ({ ...c, start: point(c.start, b.contours[i].start),
    segments: c.segments.map((s, j) => {
      const end = b.contours[i].segments[j];
      if (s.kind === 'cubic' && end.kind === 'cubic') return { ...s, to: point(s.to, end.to), c1: point(s.c1, end.c1), c2: point(s.c2, end.c2) };
      if (s.kind === 'arc' && end.kind === 'arc') return { ...s, to: point(s.to, end.to), radii: point(s.radii, end.radii) };
      return { ...s, to: point(s.to, end.to) };
    }),
  })) };
}
