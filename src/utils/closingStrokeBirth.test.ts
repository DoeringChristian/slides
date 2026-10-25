import { describe, expect, test } from 'vitest';
import { nativePathGeometry, pathArrowGeometry } from './pathShapes';
import { consumeNativeTerminals, paintedNativePath } from './nativePathSpans';
import { nativeSpanLength } from './nativeStrokePlan';

// Geometry prerequisites for closing-coverage birth: painted length is NOT a
// birth clock. These fixtures deliberately retain the historical serializer
// and ownership barriers, including raw-positive / painted-point prefixes.
const shape = (y: number, height: number, progress: number) => ({
  points: [0, y, 100, y, 100, y + height, 0, y + height],
  curve: 'linear' as const, closed: false, cornerRadius: 25, strokeWidth: 20,
  startHead: 'triangle' as const, endHead: 'triangle' as const,
  _pathClosure: { progress, fillOpacity: 0 },
});

function retained(y: number, height: number, progress: number) {
  const el = shape(y, height, progress);
  const raw = nativePathGeometry(el)!;
  const { startGeo, endGeo } = pathArrowGeometry(el);
  const consume = (path: typeof raw) => consumeNativeTerminals(path, startGeo!.boundary, endGeo!.boundary);
  return { raw, rawResult: consume(raw), painted: paintedNativePath(raw), paintResult: consume(paintedNativePath(raw)) };
}

describe('closing stroke birth provenance', () => {
  test.each([[0, .01], [.004, .006]])('raw-positive prefix precedes late serialized birth: y=%s height=%s', (y, height) => {
    for (const p of [1e-9, 1e-6, .001, .1]) {
      const r = retained(y, height, p);
      const closing = r.raw.spans.findIndex(s => s.role === 'closing');
      // Both terminal radii clamp to height/2: line + first-Q budget is
      // exactly height, hence the unquantized prefix has length p * height.
      expect(nativeSpanLength(r.raw.spans[closing])).toBeCloseTo(p * height, 14);
      expect(r.rawResult.consumed[closing]).toEqual([]);
      expect(r.paintResult.consumed[closing]).toEqual([]);
      expect(nativeSpanLength(r.painted.spans[closing])).toBe(0);
      expect(r.rawResult.runs.at(-1)!.map(part => part.span.role)).toEqual(['end-corner', 'closing']);
    }
  });

  test('short seam serialization changes after one third, not in the first ten percent', () => {
    const before = retained(0, .01, 1 / 3 - 1e-8);
    const after = retained(0, .01, 1 / 3 + 1e-8);
    expect(nativeSpanLength(before.painted.spans.at(-1)!)).toBe(0);
    expect(nativeSpanLength(after.painted.spans.at(-1)!)).toBe(.01);
    expect(before.rawResult.consumed.at(-1)).toEqual([]);
    expect(after.rawResult.consumed.at(-1)).toEqual([]);
  });

  test('late first-corner introduction extends an existing raw cohort, even when all painted controls coincide', () => {
    const before = retained(.004, .006, .5);
    const after = retained(.004, .006, .5 + 1e-8);
    expect(before.raw.spans.at(-1)!.role).toBe('closing');
    expect(after.raw.spans.at(-1)!.role).toBe('start-corner');
    const rawRun = after.rawResult.runs.at(-1)!;
    expect(rawRun.map(part => part.span.role)).toEqual(['end-corner', 'closing', 'start-corner']);
    expect(rawRun.reduce((sum, part) => sum + nativeSpanLength(part.span), 0)).toBeGreaterThan(.003);
    const paintedRun = after.paintResult.runs.at(-1)!;
    expect(paintedRun.map(part => part.span.role)).toEqual(['closing', 'start-corner']);
    expect(paintedRun.every(part => part.span.controls.every(([x, y]) => x === 0 && y === .01))).toBe(true);
  });

  test('fully subpixel seam has positive raw extent even at the static closed target', () => {
    const r = retained(0, .004, 1);
    const rawRun = r.rawResult.runs.at(-1)!;
    expect(rawRun.reduce((sum, part) => sum + nativeSpanLength(part.span), 0)).toBeGreaterThan(.003);
    expect(r.paintResult.runs.at(-1)!.every(part => part.span.controls.every(([x, y]) => x === 0 && y === 0))).toBe(true);
  });

  test('a coincident zero target is not a raw-positive birth', () => {
    const raw = nativePathGeometry({ ...shape(0, 0, 1), points: [0, 0, 0, 0, 0, 0] })!;
    expect(raw.spans.reduce((sum, span) => sum + nativeSpanLength(span), 0)).toBe(0);
  });
});
