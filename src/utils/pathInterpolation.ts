import type { ShapeElement } from '../types/presentation';
import { pathPointToSlide, pathPointsInSlide } from './pathEditing';
import { catmullTangents } from './pathShapes';
import { splitNativeControls, type NativePoint } from './nativePathSpans';

interface StationaryPathPair {
  a: number[]; b: number[]; aTangents: number[]; bTangents: number[];
  /** Deterministic snapshot correspondence, NOT a recovered authored birth anchor. */
  interior?: true;
}

/** Unique ordered subsequence only: comparing earliest and latest embeddings
 * rejects coincident/retraced controls with more than one possible identity.
 * Both endpoints must survive; endpoint extension keeps its existing adapter. */
function interiorEmbedding(small: number[], large: number[]): number[] | null {
  const match = (i: number, j: number) => near(small[2 * i], large[2 * j]) && near(small[2 * i + 1], large[2 * j + 1]);
  const n = small.length / 2, m = large.length / 2;
  const first: number[] = [], last: number[] = [];
  for (let i = 0, j = 0; i < n; i++, j++) {
    while (j < m && !match(i, j)) j++;
    if (j === m) return null;
    first.push(j);
  }
  for (let i = n - 1, j = m - 1; i >= 0; i--, j--) {
    while (j >= 0 && !match(i, j)) j--;
    last[i] = j;
  }
  return first[0] === 0 && first[n - 1] === m - 1 && first.every((v, i) => v === last[i]) ? first : null;
}

/** Refine only the missing spans; never resample the retained chain. Without
 * edit lineage the original midpoint parameter after dragging is unknowable.
 * Use evenly spaced native parameters in each retained bracket as a symmetric,
 * deterministic snapshot policy, not as evidence of authored insertion intent.
 * Cubics are exactly subdivided, not padded with duplicate control points. */
function interiorPathPair(a: ShapeElement, b: ShapeElement, aw: number[], bw: number[]): StationaryPathPair | null {
  const curve = a.curve ?? 'linear';
  if (curve !== 'linear' && curve !== 'bezier') return null;
  // Splitting a rounded leg can change the old corner's radius allocation.
  // That needs a native rounded-span adapter, not vertex padding.
  if (curve === 'linear' && (a.cornerRadius !== 0 || b.cornerRadius !== 0)) return null;
  const aSmall = aw.length < bw.length;
  const small = aSmall ? a : b, large = aSmall ? b : a;
  const sw = aSmall ? aw : bw, lw = aSmall ? bw : aw;
  const embedding = interiorEmbedding(sw, lw);
  if (!embedding) return null;
  const points = small.points!;
  const tangents = (el: ShapeElement) => el.curve === 'bezier' && el.tangents?.length === el.points!.length * 2
    ? el.tangents : catmullTangents(el.points!, false);
  const st = tangents(small), lt = tangents(large);
  if (![...sw, ...lw, ...st, ...lt].every(Number.isFinite)) return null;
  const refined = lw.slice(), rt = new Array(lw.length * 2).fill(0);
  embedding.forEach((j, i) => {
    refined[2 * j] = sw[2 * i]; refined[2 * j + 1] = sw[2 * i + 1];
    rt.splice(4 * j, 4, ...st.slice(4 * i, 4 * i + 4));
  });
  for (let i = 0; i < embedding.length - 1; i++) {
    const start = embedding[i], end = embedding[i + 1], count = end - start;
    if (count === 1) continue;
    if (curve === 'linear') {
      for (let j = 1; j < count; j++) {
        refined[2 * (start + j)] = sw[2 * i] + (sw[2 * i + 2] - sw[2 * i]) * j / count;
        refined[2 * (start + j) + 1] = sw[2 * i + 1] + (sw[2 * i + 3] - sw[2 * i + 1]) * j / count;
      }
    } else {
      let remainder: NativePoint[] = [
        [points[2 * i], points[2 * i + 1]],
        [points[2 * i] + st[4 * i + 2], points[2 * i + 1] + st[4 * i + 3]],
        [points[2 * i + 2] + st[4 * i + 4], points[2 * i + 3] + st[4 * i + 5]],
        [points[2 * i + 2], points[2 * i + 3]],
      ];
      for (let j = 0; j < count; j++) {
        const [span, rest] = splitNativeControls(remainder, 1 / (count - j));
        remainder = rest;
        const k = start + j;
        rt[4 * k + 2] = span[1][0] - span[0][0]; rt[4 * k + 3] = span[1][1] - span[0][1];
        rt[4 * (k + 1)] = span[2][0] - span[3][0]; rt[4 * (k + 1) + 1] = span[2][1] - span[3][1];
        if (k + 1 < end) {
          const world = pathPointToSlide(small, span[3][0], span[3][1]);
          refined[2 * (k + 1)] = world.x; refined[2 * (k + 1) + 1] = world.y;
        }
      }
    }
  }
  return aSmall ? { a: refined, b: bw, aTangents: rt, bTangents: lt, interior: true }
    : { a: aw, b: refined, aTangents: lt, bTangents: rt, interior: true };
}

const near = (a: number, b: number) => Math.abs(a - b) < 1e-5;

/** Identify unchanged world-space vertices BEFORE interpolating normalized
 * x/y + relative points. Extension otherwise resamples the whole old path or
 * snaps its relative points while its new bbox origin drifts underneath it.
 * No new persisted vertex IDs: recognize endpoint extensions, uniquely proven
 * interior subsequences, or same-count edits with a stationary vertex. */
export function stationaryPathPair(a: ShapeElement, b: ShapeElement): StationaryPathPair | null {
  if (a.closed || b.closed || (a.curve ?? 'linear') !== (b.curve ?? 'linear') || !near(a.rotation, b.rotation)) return null;
  const aw = pathPointsInSlide(a), bw = pathPointsInSlide(b);
  if (aw.length < 4 || bw.length < 4) return null;
  let offsetA = 0, offsetB = 0;
  if (aw.length === bw.length) {
    if (!aw.some((v, i) => i % 2 === 0 && near(v, bw[i]) && near(aw[i + 1], bw[i + 1]))) return null;
  } else {
    if (a.curve === 'bspline2' || a.curve === 'bspline3') return null;
    const small = aw.length < bw.length ? aw : bw, large = aw.length < bw.length ? bw : aw;
    const prefix = small.every((v, i) => near(v, large[i]));
    const suffix = small.every((v, i) => near(v, large[large.length - small.length + i]));
    if (!prefix && !suffix) return interiorPathPair(a, b, aw, bw);
    const offset = prefix ? 0 : (large.length - small.length) / 2;
    if (aw.length < bw.length) offsetA = offset; else offsetB = offset;
  }
  const n = Math.max(aw.length, bw.length) / 2;
  const pad = (points: number[], offset: number) => Array.from({ length: n * 2 }, (_, i) => {
    const vertex = Math.max(0, Math.min(points.length / 2 - 1, Math.floor(i / 2) - offset));
    return points[2 * vertex + i % 2];
  });
  const tangents = (el: ShapeElement, offset: number) => {
    const points = el.points!;
    const original = el.curve === 'bezier' && el.tangents?.length === points.length * 2
      ? el.tangents : catmullTangents(points, false);
    const result = new Array(n * 4).fill(0);
    result.splice(offset * 4, original.length, ...original);
    // A missing segment collapses at its old terminal; do not turn an
    // unused endpoint tangent into a loop between two identical vertices.
    if (offset > 0) result.splice(offset * 4, 2, 0, 0);
    if (offset + points.length / 2 < n) result.splice((offset + points.length / 2 - 1) * 4 + 2, 2, 0, 0);
    return result;
  };
  return { a: pad(aw, offsetA), b: pad(bw, offsetB), aTangents: tangents(a, offsetA), bTangents: tangents(b, offsetB) };
}
