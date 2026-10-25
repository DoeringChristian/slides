import type { ShapeElement } from '../types/presentation';
import { pathPointsInSlide } from './pathEditing';
import { sampledBsplineSpans } from './pathShapes';

const near = (a: number, b: number) => Math.abs(a - b) < 1e-5;

/** Exact correspondence of the CURRENT sampled renderer, not an exact spline.
 * Only normalization-only one-end extensions/deletions are recognized. Changes
 * in the terminal basis support are legitimate target geometry, not drift. */
export function bsplineExtensionPair(a: ShapeElement, b: ShapeElement): { a: number[]; b: number[] } | null {
  if (a.shapeType !== 'path' || b.shapeType !== 'path' || a.closed || b.closed
    || a.curve !== b.curve || (a.curve !== 'bspline2' && a.curve !== 'bspline3')
    || !near(a.rotation, b.rotation)) return null;
  const aw = pathPointsInSlide(a), bw = pathPointsInSlide(b);
  const degree = a.curve === 'bspline2' ? 2 : 3;
  if (aw.length === bw.length || Math.min(aw.length, bw.length) < (degree + 1) * 2
    || aw.length % 2 || bw.length % 2 || ![...aw, ...bw].every(Number.isFinite)) return null;
  const small = aw.length < bw.length ? aw : bw, large = aw.length < bw.length ? bw : aw;
  const prefix = small.every((v, i) => near(v, large[i]));
  const suffix = small.every((v, i) => near(v, large[large.length - small.length + i]));
  if (prefix === suffix) return null; // ambiguous repeated/reversed chains use general interpolation
  const offset = suffix ? (large.length - small.length) / 2 : 0;
  const as = sampledBsplineSpans(aw, degree), bs = sampledBsplineSpans(bw, degree);
  if (aw.length < bw.length) as.parameters = as.parameters.map(v => v + offset);
  else bs.parameters = bs.parameters.map(v => v + offset);
  const parameters = [...new Set([...as.parameters, ...bs.parameters])].sort((x, y) => x - y);
  const align = (samples: typeof as) => {
    let i = 0;
    return parameters.flatMap(u => {
      while (i < samples.parameters.length - 2 && samples.parameters[i + 1] < u) i++;
      const f = Math.max(0, Math.min(1, (u - samples.parameters[i]) / (samples.parameters[i + 1] - samples.parameters[i])));
      return [0, 1].map(axis => samples.points[2 * i + axis]
        + (samples.points[2 * i + 2 + axis] - samples.points[2 * i + axis]) * f);
    });
  };
  return { a: align(as), b: align(bs) };
}
