import type { SlideElement } from '../../types/presentation';
import type { BoundingBox } from '../geometry/geometry';
import { sampledPath } from '../paths/pathShapes';
import { pathPointsInSlide } from '../paths/pathEditing';

/** Snap the dot's centre to the centreline, not a path's bounding box. */
export function snapDotCenter(point: { x: number; y: number }, elements: SlideElement[], threshold: number, viewport?: BoundingBox) {
  let best: { x: number; y: number } | undefined;
  let distance = threshold;
  for (const el of elements) {
    if (!el.visible || el.type !== 'shape' || el.shapeType !== 'path') continue;
    const points = pathPointsInSlide({...el, points: sampledPath(el.points ?? [], el.curve ?? 'linear', !!el.closed, el.tangents)});
    if (el.closed && points.length >= 4) points.push(points[0], points[1]);
    for (let i = 2; i < points.length; i += 2) {
      const x = points[i-2], y = points[i-1], dx = points[i]-x, dy = points[i+1]-y;
      const length = dx*dx+dy*dy;
      const t = length ? Math.max(0, Math.min(1, ((point.x-x)*dx+(point.y-y)*dy)/length)) : 0;
      const candidate = {x: x+t*dx, y: y+t*dy};
      if (viewport && (candidate.x < viewport.x || candidate.y < viewport.y || candidate.x > viewport.x+viewport.width || candidate.y > viewport.y+viewport.height)) continue;
      const d = Math.hypot(candidate.x-point.x, candidate.y-point.y);
      if (d <= distance) { distance = d; best = candidate; }
    }
  }
  return best;
}
