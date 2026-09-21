import { describe, expect, test } from 'vitest';
import {
  shapeToUnitOutline,
  morphShapeOutlines,
  outlineIsClosed,
  partitionOutline,
  parseTransformChain,
  applyMat,
  bestAlignment,
  rotateSamples,
  reverseSamples,
  alignForMorph,
  lerpMorphedPaths,
  polylineForMorph,
} from './morphGeometry';
import type { ShapeElement } from '../types/presentation';

function makeShape(overrides: Partial<ShapeElement> = {}): ShapeElement {
  return {
    id: 'el-shape',
    type: 'shape',
    shapeType: 'rect',
    x: 0, y: 0, width: 100, height: 50,
    rotation: 0, opacity: 1, locked: false, visible: true,
    fill: '#ff0000', stroke: '#0000ff', strokeWidth: 2, cornerRadius: 0,
    ...overrides,
  };
}

// =============================================================================
// shapeToUnitOutline
// =============================================================================

describe('shapeToUnitOutline', () => {
  test('rect: all four unit corners appear exactly in the samples (n−1 divisible by 4)', () => {
    const { points, closed } = shapeToUnitOutline(makeShape(), 17);
    expect(closed).toBe(true);
    expect(points.length).toBe(34);
    // Loop starts at (0,0) and bakes the closing edge (first == last).
    expect(points[0]).toBeCloseTo(0, 10);
    expect(points[1]).toBeCloseTo(0, 10);
    expect(points[32]).toBeCloseTo(0, 10);
    expect(points[33]).toBeCloseTo(0, 10);
    const has = (x: number, y: number) => {
      for (let i = 0; i < points.length; i += 2) {
        if (Math.abs(points[i] - x) < 1e-9 && Math.abs(points[i + 1] - y) < 1e-9) return true;
      }
      return false;
    };
    expect(has(0, 0)).toBe(true);
    expect(has(1, 0)).toBe(true);
    expect(has(1, 1)).toBe(true);
    expect(has(0, 1)).toBe(true);
    // Every sample lies ON the unit-square perimeter.
    for (let i = 0; i < points.length; i += 2) {
      const onEdge =
        Math.abs(points[i]) < 1e-9 || Math.abs(points[i] - 1) < 1e-9 ||
        Math.abs(points[i + 1]) < 1e-9 || Math.abs(points[i + 1] - 1) < 1e-9;
      expect(onEdge).toBe(true);
    }
  });

  test('ellipse: every sample lies exactly on the unit-space circle (cos/sin accuracy)', () => {
    const { points, closed } = shapeToUnitOutline(makeShape({ shapeType: 'ellipse' }), 33);
    expect(closed).toBe(true);
    expect(points.length).toBe(66);
    for (let i = 0; i < points.length; i += 2) {
      const r = Math.hypot(points[i] - 0.5, points[i + 1] - 0.5);
      expect(r).toBeCloseTo(0.5, 12);
    }
    // Baked loop: first == last.
    expect(points[0]).toBeCloseTo(points[64], 12);
    expect(points[1]).toBeCloseTo(points[65], 12);
    // Scaled to the real box the samples sit on the true ellipse.
    const s = makeShape({ shapeType: 'ellipse' });
    for (let i = 0; i < points.length; i += 2) {
      const px = points[i] * s.width;
      const py = points[i + 1] * s.height;
      const v = ((px - 50) / 50) ** 2 + ((py - 25) / 25) ** 2;
      expect(v).toBeCloseTo(1, 10);
    }
  });

  test('star: outer vertices of the star land in the samples', () => {
    // 10 star vertices + bake = 11 loop points; n = 10k+1 keeps them exact.
    const { points, closed } = shapeToUnitOutline(makeShape({ shapeType: 'star', width: 80, height: 80 }), 41);
    expect(closed).toBe(true);
    // Top outer vertex of a star in an 80×80 box: (40, 0) → unit (0.5, 0).
    const hasTop = (() => {
      for (let i = 0; i < points.length; i += 2) {
        if (Math.abs(points[i] - 0.5) < 1e-6 && Math.abs(points[i + 1]) < 1e-6) return true;
      }
      return false;
    })();
    expect(hasTop).toBe(true);
  });

  test('open path keeps its endpoints and reports closed: false', () => {
    const s = makeShape({ shapeType: 'path', points: [0, 0, 100, 50], curve: 'linear', closed: false });
    const { points, closed } = shapeToUnitOutline(s, 5);
    expect(closed).toBe(false);
    expect(points.slice(0, 2)).toEqual([0, 0]);
    expect(points.slice(-2)).toEqual([1, 1]);
    // Interior samples sit on the normalized segment.
    expect(points[4]).toBeCloseTo(0.5);
    expect(points[5]).toBeCloseTo(0.5);
  });

  test('outlineIsClosed: primitives always, paths per their flag', () => {
    expect(outlineIsClosed(makeShape())).toBe(true);
    expect(outlineIsClosed(makeShape({ shapeType: 'ellipse' }))).toBe(true);
    expect(outlineIsClosed(makeShape({ shapeType: 'path', points: [0, 0, 1, 1], closed: false }))).toBe(false);
    expect(outlineIsClosed(makeShape({ shapeType: 'path', points: [0, 0, 1, 1, 0, 1], closed: true }))).toBe(true);
  });
});

// =============================================================================
// Alignment
// =============================================================================

describe('alignment minimizes travel', () => {
  const square = [0, 0, 1, 0, 1, 1, 0, 1];

  test('a rotated loop realigns onto the reference exactly', () => {
    const rotated = rotateSamples(square, 2);
    expect(rotated).not.toEqual(square);
    expect(bestAlignment(rotated, square)).toEqual(square);
  });

  test('a reversed loop realigns via reflection', () => {
    const reversed = reverseSamples(square);
    expect(bestAlignment(reversed, square)).toEqual(square);
  });

  test('morphShapeOutlines: identical shapes never travel', () => {
    const a = makeShape({ width: 80, height: 80 });
    const b = makeShape({ id: 'other', width: 80, height: 80 });
    const at0 = morphShapeOutlines(a, b, 0, 33);
    const mid = morphShapeOutlines(a, b, 0.5, 33);
    const at1 = morphShapeOutlines(a, b, 1, 33);
    expect(mid).toEqual(at0);
    expect(at1).toEqual(at0);
  });
});

// =============================================================================
// morphShapeOutlines
// =============================================================================

describe('morphShapeOutlines', () => {
  const rect = makeShape({ width: 100, height: 50 });
  const star = makeShape({ id: 's', shapeType: 'star', width: 60, height: 60 });

  test('t=0 lands on the source outline (as a point set, scaled to its box)', () => {
    const out = morphShapeOutlines(rect, star, 0, 17);
    // Every point lies on the 100×50 rect perimeter.
    for (let i = 0; i < out.length; i += 2) {
      const onEdge =
        Math.abs(out[i]) < 1e-6 || Math.abs(out[i] - 100) < 1e-6 ||
        Math.abs(out[i + 1]) < 1e-6 || Math.abs(out[i + 1] - 50) < 1e-6;
      expect(onEdge).toBe(true);
    }
  });

  test('t=1 lands on the target outline bounding box', () => {
    const out = morphShapeOutlines(rect, star, 1, 41);
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (let i = 0; i < out.length; i += 2) {
      minX = Math.min(minX, out[i]); maxX = Math.max(maxX, out[i]);
      minY = Math.min(minY, out[i + 1]); maxY = Math.max(maxY, out[i + 1]);
    }
    // Star spans the full box horizontally at its widest ring points… its
    // outer ring touches top (y=0); bbox stays within the box.
    expect(minY).toBeCloseTo(0, 5);
    expect(maxX).toBeLessThanOrEqual(60 + 1e-6);
    expect(maxY).toBeLessThanOrEqual(60 + 1e-6);
    expect(minX).toBeGreaterThanOrEqual(-1e-6);
  });

  test('explicit box override scales the result (size easing hook)', () => {
    const out = morphShapeOutlines(rect, star, 0.5, 17, 200, 100);
    const ref = morphShapeOutlines(rect, star, 0.5, 17, 100, 50);
    for (let i = 0; i < out.length; i += 2) {
      expect(out[i]).toBeCloseTo(ref[i] * 2, 8);
      expect(out[i + 1]).toBeCloseTo(ref[i + 1] * 2, 8);
    }
  });

  test('deterministic: repeated calls return identical geometry', () => {
    expect(morphShapeOutlines(rect, star, 0.3, 33)).toEqual(morphShapeOutlines(rect, star, 0.3, 33));
  });
});

// =============================================================================
// partitionOutline — the arc-partition correspondence
// =============================================================================

describe('partitionOutline', () => {
  // A 4×4 square loop (baked: last == first), perimeter 16.
  const loop = [0, 0, 4, 0, 4, 4, 0, 4, 0, 0];

  test('segments tile the outline exactly (boundaries shared, ends anchored)', () => {
    const segs = partitionOutline(loop, 4, 5);
    expect(segs.length).toBe(4);
    for (const s of segs) expect(s.length).toBe(10);
    // Start anchored to the outline start, end to the outline end.
    expect(segs[0].slice(0, 2)).toEqual([0, 0]);
    expect(segs[3].slice(-2)).toEqual([0, 0]);
    // Adjacent segments share their boundary point EXACTLY.
    for (let i = 0; i < 3; i++) {
      expect(segs[i].slice(-2)).toEqual(segs[i + 1].slice(0, 2));
    }
    // Equal arc: each segment covers one side of the square.
    expect(segs[0].slice(-2)).toEqual([4, 0]);
    expect(segs[1].slice(-2)).toEqual([4, 4]);
    expect(segs[2].slice(-2)).toEqual([0, 4]);
  });

  test('deterministic pairing: identical partitions on repeated calls', () => {
    expect(partitionOutline(loop, 3, 7)).toEqual(partitionOutline(loop, 3, 7));
  });

  test('degenerate inputs return empty', () => {
    expect(partitionOutline([], 3, 5)).toEqual([]);
    expect(partitionOutline(loop, 0, 5)).toEqual([]);
    expect(partitionOutline(loop, 3, 1)).toEqual([]);
  });
});

// =============================================================================
// Transform-chain parser
// =============================================================================

describe('parseTransformChain', () => {
  test('translate', () => {
    const m = parseTransformChain('translate(10,20)');
    expect(applyMat(m, 1, 2)).toEqual([11, 22]);
    // Single-argument translate: y defaults to 0.
    expect(applyMat(parseTransformChain('translate(5)'), 0, 0)).toEqual([5, 0]);
  });

  test('translate ∘ scale composes left-to-right like the SVG attribute', () => {
    const m = parseTransformChain('translate(10,5) scale(2,3)');
    // scale applies first, then translate: (1,1) → (2,3) → (12,8).
    expect(applyMat(m, 1, 1)).toEqual([12, 8]);
  });

  test('uniform scale from one argument', () => {
    expect(applyMat(parseTransformChain('scale(2)'), 3, 4)).toEqual([6, 8]);
  });

  test('matrix passthrough and mixed chains', () => {
    // 90° rotation matrix (0,1,-1,0,0,0) after a translate(1,0):
    // p=(0,0) → translate → (1,0) → matrix → (0,1).
    const m = parseTransformChain('matrix(0,1,-1,0,0,0) translate(1,0)');
    const [x, y] = applyMat(m, 0, 0);
    expect(x).toBeCloseTo(0, 12);
    expect(y).toBeCloseTo(1, 12);
  });

  test('empty / unknown input yields identity', () => {
    expect(applyMat(parseTransformChain(''), 7, 8)).toEqual([7, 8]);
    expect(applyMat(parseTransformChain(undefined), 7, 8)).toEqual([7, 8]);
    expect(applyMat(parseTransformChain('rotate(45)'), 7, 8)).toEqual([7, 8]);
  });

  test('tolerates the layout emitter format (decimals, comma-separated)', () => {
    const m = parseTransformChain('translate(12.345,-7.500) scale(0.0173,0.0173) translate(0.000,792.000)');
    const [x, y] = applyMat(m, 100, -100);
    expect(x).toBeCloseTo(12.345 + 0.0173 * 100, 6);
    expect(y).toBeCloseTo(-7.5 + 0.0173 * (792 - 100), 6);
  });
});

// =============================================================================
// Moved plumbing keeps its behaviour (smoke)
// =============================================================================

describe('moved path-morph plumbing', () => {
  test('polylineForMorph bakes the closing edge for closed paths', () => {
    const out = polylineForMorph([0, 0, 10, 0, 10, 10], 'linear', true);
    expect(out.slice(-2)).toEqual([0, 0]);
    expect(out.length).toBe(8);
  });

  test('alignForMorph leaves two open paths untouched', () => {
    const a = [0, 0, 1, 1];
    const b = [2, 2, 3, 3];
    expect(alignForMorph(a, b, false, false)).toEqual({ a, b });
  });

  test('lerpMorphedPaths endpoints are the (sampled) inputs', () => {
    const a = [0, 0, 100, 0];
    const b = [0, 0, 100, 0, 100, 100, 0, 100];
    const at0 = lerpMorphedPaths(a, 'linear', false, undefined, b, 'linear', true, undefined, 0);
    const at1 = lerpMorphedPaths(a, 'linear', false, undefined, b, 'linear', true, undefined, 1);
    // t=0: every sample lies on the source segment y=0.
    for (let i = 1; i < at0.length; i += 2) expect(at0[i]).toBeCloseTo(0, 8);
    // t=1: samples lie on the target square perimeter.
    for (let i = 0; i < at1.length; i += 2) {
      const onEdge =
        Math.abs(at1[i]) < 1e-6 || Math.abs(at1[i] - 100) < 1e-6 ||
        Math.abs(at1[i + 1]) < 1e-6 || Math.abs(at1[i + 1] - 100) < 1e-6;
      expect(onEdge).toBe(true);
    }
  });
});
