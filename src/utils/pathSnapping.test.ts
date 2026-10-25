import { describe, expect, test } from 'vitest';
import { draftReferences, snapPathPoint, vertexAlignmentSources, withVertexMagnets } from './pathSnapping';
import { screenPixelsToSlide } from './screenSpace';

describe('Shift-only eight-ray constraint (not grid or sibling snapping)', () => {
  test.each([0, 45, 90, 135, 180, 225, 270, 315])('%s° ray preserves radius', degrees => {
    const angle = (degrees + 2) * Math.PI / 180, origin = { x: 40, y: 70 };
    const result = snapPathPoint({ x: 40 + 100 * Math.cos(angle), y: 70 + 100 * Math.sin(angle) }, [origin], 1, true);
    expect(result.guides).toHaveLength(1);
    expect(result.point.x).toBeCloseTo(40 + 100 * Math.cos(degrees * Math.PI / 180));
    expect(result.point.y).toBeCloseTo(70 + 100 * Math.sin(degrees * Math.PI / 180));
  });
  test('no passive angular magnets at any zoom; explicit Shift ignores tolerance', () => {
    for(const zoom of [.5,1,2]) {
      const p={x:100,y:4};
      expect(snapPathPoint(p,[{x:0,y:0}],zoom)).toEqual({point:p,guides:[]});
      expect(snapPathPoint({x:100,y:20},[{x:0,y:0}],zoom,true).point.y).toBe(0);
    }
    expect(draftReferences([0,0,10,20,30,40])).toEqual([{x:30,y:40}]);
    expect(draftReferences([0,0,10,20,30,40],true)).toEqual([{x:0,y:0}]);
  });
});

describe('same-path vertex alignment magnets', () => {
  // v0 is the first vertex, v1 the far terminal, v2 an arbitrary earlier one.
  const PATH = [100, 50, 300, 400, 260, 120];
  const magnet = (point: { x: number; y: number }, options: {
    points?: number[]; zoom?: number; shift?: boolean; exclude?: number[];
    others?: { x: number; y: number; width: number; height: number }[];
  } = {}) => snapPathPoint(point, [{ x: 0, y: 0 }], options.zoom ?? 1, options.shift ?? false,
    withVertexMagnets({ others: options.others ?? [] }, options.points ?? PATH, options.exclude ?? []));

  test('a vertex contributes only its own x and y — never an edge or a centre', () => {
    expect(vertexAlignmentSources([10, 20, 30, 40])).toEqual([
      { x: 10, y: 20, width: 0, height: 0 }, { x: 30, y: 40, width: 0, height: 0 },
    ]);
    // Zero size collapses all three candidate lines onto the vertex itself, so
    // vertices never act as a box spanning them (no magnet at their midpoint).
    expect(magnet({ x: 20, y: 300 }, { points: [10, 20, 30, 40] }).point).toEqual({ x: 20, y: 300 });
  });

  test('snaps to the FIRST vertex, horizontally and vertically, independently', () => {
    const vertical = magnet({ x: 104, y: 300 });
    expect(vertical.point).toEqual({ x: 100, y: 300 });
    expect(vertical.guides).toEqual([{ type: 'vertical', position: 100, destination: { x: 100, y: 300 } }]);

    const horizontal = magnet({ x: 200, y: 54 });
    expect(horizontal.point).toEqual({ x: 200, y: 50 });
    expect(horizontal.guides).toEqual([{ type: 'horizontal', position: 50, destination: { x: 200, y: 50 } }]);

    // Both axes at once still resolve to the first vertex itself.
    expect(magnet({ x: 97, y: 53 }).point).toEqual({ x: 100, y: 50 });
  });

  test('snaps to an arbitrary earlier vertex, and the first vertex wins a tie', () => {
    const v2 = magnet({ x: 262, y: 300 });
    expect(v2.point).toEqual({ x: 260, y: 300 });
    expect(v2.guides).toEqual([{ type: 'vertical', position: 260, destination: { x: 260, y: 300 } }]);
    expect(magnet({ x: 500, y: 118 }).point).toEqual({ x: 500, y: 120 });
    expect(magnet({ x: 104, y: 300 }, { points: [100, 50, 108, 400] }).point.x).toBe(100);
  });

  test('tolerance is the shared 5 screen pixels at every zoom', () => {
    for (const zoom of [0.5, 1, 2]) {
      const tolerance = screenPixelsToSlide(5, zoom);
      expect(magnet({ x: 100 + tolerance, y: 300 }, { zoom }).point.x).toBe(100);
      expect(magnet({ x: 100 + tolerance * 1.001, y: 300 }, { zoom }).point.x).toBeCloseTo(100 + tolerance * 1.001);
      expect(magnet({ x: 200, y: 50 - tolerance }, { zoom }).point.y).toBe(50);
      expect(magnet({ x: 200, y: 50 - tolerance * 1.001 }, { zoom }).guides).toEqual([]);
    }
  });

  test('Cmd disables every magnet — no candidates are even built', () => {
    for (const zoom of [0.5, 1, 2]) {
      expect(withVertexMagnets(undefined, PATH)).toBeUndefined();
      const point = { x: 101, y: 51 };
      expect(snapPathPoint(point, [{ x: 0, y: 0 }], zoom, false, withVertexMagnets(undefined, PATH)))
        .toEqual({ point, guides: [] });
    }
  });

  test('explicit Shift keeps the ray: vertex magnets may only slide along it', () => {
    for (const zoom of [0.5, 1, 2]) {
      // 0° ray from the origin meets the first vertex's vertical at x = 100.
      const along = magnet({ x: 98, y: 0 }, { zoom, shift: true, points: [100, 500] });
      expect(along.point.x).toBeCloseTo(100);
      expect(along.point.y).toBeCloseTo(0);
      expect(along.guides.map(g => g.type)).toEqual(['direction', 'vertical']);
      // An off-ray vertex cannot pull the point off the constrained direction.
      const off = magnet({ x: 98, y: 0 }, { zoom, shift: true, points: [0, 300] });
      expect(off.point).toEqual({ x: 98, y: 0 });
      expect(off.guides.map(g => g.type)).toEqual(['direction']);
    }
  });

  test('the dragged vertex is excluded, so it never snaps to itself', () => {
    expect(magnet({ x: 101, y: 300 }).point.x).toBe(100);
    expect(magnet({ x: 101, y: 300 }, { exclude: [0] }).point).toEqual({ x: 101, y: 300 });
    expect(magnet({ x: 101, y: 300 }, { exclude: [0] }).guides).toEqual([]);
    expect(vertexAlignmentSources(PATH, [0, 2])).toEqual([{ x: 300, y: 400, width: 0, height: 0 }]);
    // Excluding every vertex leaves the caller's own sources untouched.
    const others = [{ x: 600, y: 600, width: 10, height: 10 }];
    expect(withVertexMagnets({ others, marginBounds: null }, PATH, [0, 1, 2]))
      .toEqual({ others, marginBounds: null });
  });

  test('vertex candidates outrank sibling boxes at equal distance', () => {
    const result = magnet({ x: 104, y: 300 }, { others: [{ x: 108, y: 0, width: 40, height: 40 }] });
    expect(result.point.x).toBe(100);
    expect(result.guides).toEqual([
      { type: 'vertical', position: 100, destination: { x: 100, y: 300 } },
      { type: 'vertical', position: 108 },
    ]);
  });
});
