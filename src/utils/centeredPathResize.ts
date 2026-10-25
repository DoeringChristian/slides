import type { ShapeElement } from '../types/presentation';
import { pathPointToSlide, slidePointToPath } from './pathEditing';
import type { Point } from './geometry';

/** Two-vertex endpoint resize around the original vertex midpoint. Always
 * derive from the gesture snapshot, including manual tangent similarity. */
export function centeredPathResize(element: ShapeElement, index: number, endpoint: Point) {
  const source = element.points!;
  const center = { x: (source[0] + source[2]) / 2, y: (source[1] + source[3]) / 2 };
  const local = slidePointToPath(element, endpoint.x, endpoint.y);
  const points = source.slice(), opposite = index === 0 ? 1 : 0;
  points[2 * index] = local.x; points[2 * index + 1] = local.y;
  points[2 * opposite] = 2 * center.x - local.x; points[2 * opposite + 1] = 2 * center.y - local.y;
  const a = { x: source[2 * index] - center.x, y: source[2 * index + 1] - center.y };
  const b = { x: local.x - center.x, y: local.y - center.y };
  const length2 = a.x * a.x + a.y * a.y;
  let tangents = element.tangents?.slice();
  if (tangents && length2 > 1e-12) {
    const real = (a.x * b.x + a.y * b.y) / length2, imaginary = (a.x * b.y - a.y * b.x) / length2;
    tangents = tangents.map((v, i, values) => i % 2 ? values[i - 1] * imaginary + v * real : v * real - values[i + 1] * imaginary);
  }
  return { points, tangents, opposite: pathPointToSlide(element, points[2 * opposite], points[2 * opposite + 1]) };
}
