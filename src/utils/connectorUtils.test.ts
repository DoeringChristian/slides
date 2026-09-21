/**
 * Pure unit tests for the connector binding helpers (node-env, DOM-free):
 *  - silhouetteIntersect: per-shape ray/outline intersection (rect incl.
 *    cornerRadius arcs, ellipse, triangle, star, text-as-rect, rotation)
 *  - resolveBinding / bindingFor: edge (focus + gap) and pinned (fixedPoint)
 *    modes, legacy-anchor fallback, and the ROUND-TRIP INVARIANT
 *  - getBindingTarget2: inside-or-threshold matching, topmost-z, filters
 *  - rebindAfterElementsMoved, THE shared rebind pass used by all four store
 *    call sites (updateElement / updateElements × Y / JSON)
 *  - bindDraftEndpoints, the bind-while-drawing commit helper
 */
import { describe, expect, test } from 'vitest';
import {
  ANCHOR_TO_UV,
  getAnchorPoint,
  silhouetteIntersect,
  resolveBinding,
  bindingFor,
  effectiveBindingMode,
  isPinnedBinding,
  getBindingTarget2,
  rebindAfterElementsMoved,
  bindDraftEndpoints,
} from './connectorUtils';
import type {
  SlideElement,
  ShapeElement,
  TextElement,
  ConnectorBinding,
  BindingAnchor,
} from '../types/presentation';

// =============================================================================
// Fixtures
// =============================================================================

function rect(id: string, overrides?: Partial<ShapeElement>): ShapeElement {
  return {
    id,
    type: 'shape',
    shapeType: 'rect',
    x: 0, y: 0, width: 100, height: 100,
    rotation: 0, opacity: 1, locked: false, visible: true,
    fill: '#fff', stroke: '#000', strokeWidth: 2, cornerRadius: 0,
    ...overrides,
  };
}

function pathShape(id: string, overrides?: Partial<ShapeElement>): ShapeElement {
  return rect(id, {
    shapeType: 'path',
    fill: '', strokeWidth: 3,
    curve: 'linear', closed: false,
    ...overrides,
  });
}

function textEl(id: string, overrides?: Partial<TextElement>): TextElement {
  return {
    id,
    type: 'text',
    x: 0, y: 0, width: 100, height: 40,
    rotation: 0, opacity: 1, locked: false, visible: true,
    text: 'hi',
    style: {
      fontFamily: 'Inter', fontSize: 32, fontWeight: 'normal',
      fontStyle: 'normal', textDecoration: 'none', color: '#222',
      align: 'left', verticalAlign: 'top', lineHeight: 1.3,
    },
    ...overrides,
  };
}

/** Absolute vertex list of a path shape (points are relative to x/y). */
function absVertices(shape: { x: number; y: number; points?: number[] }): number[] {
  return (shape.points ?? []).map((v, i) => v + (i % 2 === 0 ? shape.x : shape.y));
}

function expectPt(p: { x: number; y: number } | null, x: number, y: number, digits = 6) {
  expect(p).not.toBeNull();
  expect(p!.x).toBeCloseTo(x, digits);
  expect(p!.y).toBeCloseTo(y, digits);
}

// =============================================================================
// silhouetteIntersect
// =============================================================================

describe('silhouetteIntersect', () => {
  test('plain rect: nearest edge crossing along the ray', () => {
    const box = rect('box');
    expectPt(silhouetteIntersect(box, { x: 150, y: 50 }, { x: 50, y: 50 }), 100, 50);
    expectPt(silhouetteIntersect(box, { x: 50, y: -80 }, { x: 50, y: 50 }), 50, 0);
    // From INSIDE, the ray exits through the boundary.
    expectPt(silhouetteIntersect(box, { x: 50, y: 50 }, { x: 200, y: 50 }), 100, 50);
  });

  test('ray pointing away from the shape misses (null)', () => {
    const box = rect('box');
    expect(silhouetteIntersect(box, { x: 200, y: 50 }, { x: 300, y: 50 })).toBeNull();
    // Degenerate zero-length ray.
    expect(silhouetteIntersect(box, { x: 200, y: 50 }, { x: 200, y: 50 })).toBeNull();
  });

  test('rect with cornerRadius: diagonal ray hits the corner ARC, not the bbox corner', () => {
    const box = rect('box', { cornerRadius: 20 });
    // Ray along y = x toward the center passes through the bottom-right
    // corner circle (center (80,80), r=20) at (80 + 20/√2, 80 + 20/√2).
    const hit = silhouetteIntersect(box, { x: 200, y: 200 }, { x: 50, y: 50 });
    const expected = 80 + 20 / Math.SQRT2;
    expectPt(hit, expected, expected);
    // An axis-aligned ray through the middle still hits the straight edge.
    expectPt(silhouetteIntersect(box, { x: 200, y: 50 }, { x: 50, y: 50 }), 100, 50);
  });

  test('ellipse: exact arc intersection (not the bounding box)', () => {
    const ell = rect('ell', { shapeType: 'ellipse', width: 200, height: 100 });
    expectPt(silhouetteIntersect(ell, { x: 300, y: 50 }, { x: 100, y: 50 }), 200, 50);
    expectPt(silhouetteIntersect(ell, { x: 100, y: 300 }, { x: 100, y: 50 }), 100, 100);
    // 45° toward the center from far out: must hit the ellipse, inside bbox.
    const hit = silhouetteIntersect(ell, { x: 300, y: 150 }, { x: 100, y: 50 })!;
    expect(((hit.x - 100) / 100) ** 2 + ((hit.y - 50) / 50) ** 2).toBeCloseTo(1, 6);
  });

  test('triangle: matches the rendered inscribed-equilateral geometry', () => {
    const tri = rect('tri', { shapeType: 'triangle' });
    // Base edge sits at y = 50 + 50·sin(30°) = 75.
    expectPt(silhouetteIntersect(tri, { x: 50, y: 200 }, { x: 50, y: 50 }), 50, 75);
    // Straight down from above hits the apex (50, 0).
    expectPt(silhouetteIntersect(tri, { x: 50, y: -100 }, { x: 50, y: 50 }), 50, 0);
  });

  test('star: hits the rendered 10-vertex outline', () => {
    const star = rect('star', { shapeType: 'star' });
    // Top outer point is (50, 0).
    expectPt(silhouetteIntersect(star, { x: 50, y: -100 }, { x: 50, y: 50 }), 50, 0);
    // Horizontal ray toward the center passes BETWEEN two arms — the hit is
    // strictly inside the bbox (x > 0), unlike a bbox silhouette.
    const hit = silhouetteIntersect(star, { x: -100, y: 50 }, { x: 50, y: 50 })!;
    expect(hit.y).toBeCloseTo(50, 6);
    expect(hit.x).toBeGreaterThan(0);
  });

  test('rotation: ray is solved in the rotated frame', () => {
    // 100×50 rect rotated 90° about its center (50,25) spans x∈[25,75],
    // y∈[-25,75] in world space.
    const box = rect('box', { width: 100, height: 50, rotation: 90 });
    expectPt(silhouetteIntersect(box, { x: 200, y: 25 }, { x: 50, y: 25 }), 75, 25);
    expectPt(silhouetteIntersect(box, { x: 50, y: -100 }, { x: 50, y: 25 }), 50, -25);
  });

  test('text elements use their bounding box as the silhouette', () => {
    const t = textEl('t');
    expectPt(silhouetteIntersect(t, { x: 50, y: 100 }, { x: 50, y: 20 }), 50, 40);
  });
});

// =============================================================================
// resolveBinding / bindingFor
// =============================================================================

describe('resolveBinding (pinned + legacy anchor)', () => {
  test('pinned fixedPoint maps [u,v] onto the bbox', () => {
    const box = rect('box');
    expectPt(resolveBinding({ elementId: 'box', mode: 'pinned', fixedPoint: [1, 0.5] }, box, { x: 0, y: 0 }), 100, 50);
    expectPt(resolveBinding({ elementId: 'box', mode: 'pinned', fixedPoint: [0.25, 1] }, box, { x: 0, y: 0 }), 25, 100);
  });

  test('pinned honors rotation (rotates with the target)', () => {
    const box = rect('box', { rotation: 90 });
    // [1, 0.5] = right anchor; rotated 90° about (50,50) → bottom (50, 100).
    expectPt(resolveBinding({ elementId: 'box', mode: 'pinned', fixedPoint: [1, 0.5] }, box, { x: 0, y: 0 }), 50, 100);
  });

  test('legacy anchor bindings resolve exactly like the old 5-anchor model', () => {
    const box = rect('box', { x: 30, y: 40, width: 200, height: 120, rotation: 33 });
    for (const anchor of Object.keys(ANCHOR_TO_UV) as BindingAnchor[]) {
      const legacy: ConnectorBinding = { elementId: 'box', anchor };
      expect(effectiveBindingMode(legacy)).toBe('pinned');
      const resolved = resolveBinding(legacy, box, { x: 0, y: 0 });
      const expected = getAnchorPoint(box, anchor)!;
      expect(resolved.x).toBeCloseTo(expected.x, 9);
      expect(resolved.y).toBeCloseTo(expected.y, 9);
    }
  });

  test('mode helpers: explicit mode wins, anchor implies pinned, default is edge', () => {
    expect(effectiveBindingMode({ elementId: 'a' })).toBe('edge');
    expect(effectiveBindingMode({ elementId: 'a', anchor: 'top' })).toBe('pinned');
    expect(effectiveBindingMode({ elementId: 'a', mode: 'edge', anchor: 'top' })).toBe('edge');
    expect(isPinnedBinding({ elementId: 'a', mode: 'pinned' })).toBe(true);
    expect(isPinnedBinding({ elementId: 'a', focus: 0.3 })).toBe(false);
  });
});

describe('resolveBinding (edge mode)', () => {
  const box = rect('box'); // (0,0)-(100,100), center (50,50)

  test('focus 0, gap 0: silhouette point on the axis toward the other end', () => {
    expectPt(resolveBinding({ elementId: 'box', mode: 'edge', focus: 0, gap: 0 }, box, { x: 200, y: 50 }), 100, 50);
  });

  test('gap pushes the endpoint back along the ray', () => {
    expectPt(resolveBinding({ elementId: 'box', mode: 'edge', focus: 0, gap: 10 }, box, { x: 200, y: 50 }), 110, 50);
  });

  test('focus sign picks a side of the center axis; ±1 grazes the silhouette', () => {
    const other = { x: 200, y: 50 };
    const plus = resolveBinding({ elementId: 'box', mode: 'edge', focus: 0.5, gap: 0 }, box, other);
    const minus = resolveBinding({ elementId: 'box', mode: 'edge', focus: -0.5, gap: 0 }, box, other);
    expect(plus.y).not.toBeCloseTo(minus.y, 3);
    expect(plus.y + minus.y).toBeCloseTo(100, 6); // symmetric about the axis
    // The resolved point always sits ON the silhouette when gap = 0.
    expect(plus.x).toBeCloseTo(100, 6); // right edge of the rect
  });

  test('degenerate: other end on the center resolves to the center', () => {
    expectPt(resolveBinding({ elementId: 'box', mode: 'edge' }, box, { x: 50, y: 50 }), 50, 50);
  });
});

describe('bindingFor ⇄ resolveBinding round-trip', () => {
  test('worked example: rect, off-axis point outside the silhouette', () => {
    const box = rect('box');
    const other = { x: 200, y: 50 };
    const p = { x: 120, y: 30 };
    const b = bindingFor(p, box, other, 'edge');
    expect(b.mode).toBe('edge');
    expect(b.focus).toBeCloseTo(0.75, 6);
    expect(b.gap!).toBeGreaterThan(0);
    expectPt(resolveBinding(b, box, other), p.x, p.y);
  });

  test('point INSIDE the silhouette gets gap 0 and resolves onto the outline', () => {
    const box = rect('box');
    const other = { x: 300, y: 300 };
    const b = bindingFor({ x: 50, y: 50 }, box, other, 'edge');
    expect(b.gap).toBe(0);
    // Center is on the other→center axis → focus 0 → resolved point is the
    // silhouette crossing (the rect corner here, since the ray is diagonal).
    expectPt(resolveBinding(b, box, other), 100, 100);
  });

  test('pinned round-trip: fixedPoint from a boundary point resolves back to it', () => {
    const box = rect('box', { rotation: 40 });
    const p = getAnchorPoint(box, 'bottom')!;
    const b = bindingFor(p, box, { x: 500, y: 0 }, 'pinned');
    expect(b.fixedPoint![0]).toBeCloseTo(0.5, 6);
    expect(b.fixedPoint![1]).toBeCloseTo(1, 6);
    expectPt(resolveBinding(b, box, { x: 500, y: 0 }), p.x, p.y);
  });

  test('property: resolve ∘ bindingFor ≈ identity over random shapes / rotations / foci / gaps', () => {
    // Deterministic LCG so failures are reproducible.
    let seed = 0x2f6e2b1;
    const rand = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 0x100000000;
    };
    const shapes: Array<Partial<ShapeElement>> = [
      { shapeType: 'rect' },
      { shapeType: 'rect', cornerRadius: 25 },
      { shapeType: 'ellipse' },
      { shapeType: 'triangle' },
      { shapeType: 'star' },
    ];
    for (let i = 0; i < 250; i++) {
      const spec = shapes[i % shapes.length];
      const target = rect('t', {
        ...spec,
        x: -200 + rand() * 400,
        y: -200 + rand() * 400,
        width: 100 + rand() * 150,
        height: 100 + rand() * 150,
        rotation: rand() * 360,
      });
      const c = { x: target.x + target.width / 2, y: target.y + target.height / 2 };
      const theta = rand() * 2 * Math.PI;
      const dir = { x: Math.cos(theta), y: Math.sin(theta) };
      // Place the other end well clear of the WHOLE silhouette (R bounds any
      // boundary radius), so the resolved point never collapses onto it.
      const R = Math.hypot(target.width, target.height) / 2;
      const other = {
        x: c.x + dir.x * R * (1.5 + rand() * 2),
        y: c.y + dir.y * R * (1.5 + rand() * 2),
      };
      const binding: ConnectorBinding = {
        elementId: 't',
        mode: 'edge',
        focus: -0.9 + rand() * 1.8,
        gap: rand() * 20,
      };
      const p = resolveBinding(binding, target, other);
      const b2 = bindingFor(p, target, other, 'edge');
      const p2 = resolveBinding(b2, target, other);
      const err = Math.hypot(p2.x - p.x, p2.y - p.y);
      if (err > 1e-6) {
        // Surface the failing configuration in the assertion message.
        expect.fail(`round-trip error ${err} at iteration ${i}: shape=${spec.shapeType} r=${spec.cornerRadius ?? 0} binding=${JSON.stringify(binding)}`);
      }
      // The recovered payload matches too (focus/gap are the same encoding).
      expect(b2.focus!).toBeCloseTo(binding.focus!, 4);
      expect(b2.gap!).toBeCloseTo(binding.gap!, 4);
    }
  });
});

// =============================================================================
// getBindingTarget2
// =============================================================================

describe('getBindingTarget2', () => {
  test('binds when the point is INSIDE the silhouette', () => {
    const els = [rect('box')];
    expect(getBindingTarget2({ x: 50, y: 50 }, els, '')?.id).toBe('box');
    expect(getBindingTarget2({ x: 99, y: 99 }, els, '')?.id).toBe('box');
  });

  test('binds within the size-scaled threshold, not beyond', () => {
    // 100×100 → threshold max(16, min(50, 32)) = 32 slide units.
    const els = [rect('box')];
    expect(getBindingTarget2({ x: 130, y: 50 }, els, '')?.id).toBe('box');
    expect(getBindingTarget2({ x: 150, y: 50 }, els, '')).toBeNull();
    // 20×20 → floor of 16.
    const small = [rect('s', { width: 20, height: 20 })];
    expect(getBindingTarget2({ x: 35, y: 10 }, small, '')?.id).toBe('s');
    expect(getBindingTarget2({ x: 38, y: 10 }, small, '')).toBeNull();
  });

  test('threshold grows when zoomed out (zoom < 1), unchanged at zoom ≥ 1', () => {
    const els = [rect('box')];
    expect(getBindingTarget2({ x: 150, y: 50 }, els, '', 1)).toBeNull();
    expect(getBindingTarget2({ x: 150, y: 50 }, els, '', 2)).toBeNull();
    expect(getBindingTarget2({ x: 150, y: 50 }, els, '', 0.5)?.id).toBe('box'); // 32/0.5 = 64
  });

  test('distance is measured to the SILHOUETTE, not the bbox (ellipse corner)', () => {
    const els = [rect('ell', { shapeType: 'ellipse' })];
    // (145,50) is 45 from the ellipse edge on-axis → outside threshold…
    expect(getBindingTarget2({ x: 145, y: 50 }, els, '')).toBeNull();
    // …while (95,5) is inside the bbox corner but ~14 outside the arc → binds.
    expect(getBindingTarget2({ x: 95, y: 5 }, els, '')?.id).toBe('ell');
  });

  test('topmost element in z-order wins (elements given bottom → top)', () => {
    const els = [
      rect('under', { width: 300, height: 300 }),
      rect('over', { x: 100, y: 100 }),
    ];
    // Inside both → the topmost (later in the array) wins.
    expect(getBindingTarget2({ x: 150, y: 150 }, els, '')?.id).toBe('over');
    // Inside only the lower one (and outside `over`'s threshold) → under.
    expect(getBindingTarget2({ x: 20, y: 260 }, els, '')?.id).toBe('under');
  });

  test('skips invisible, locked, path shapes, and the excluded element', () => {
    expect(getBindingTarget2({ x: 50, y: 50 }, [rect('ghost', { visible: false })], '')).toBeNull();
    expect(getBindingTarget2({ x: 50, y: 50 }, [rect('frozen', { locked: true })], '')).toBeNull();
    expect(getBindingTarget2({ x: 50, y: 0 }, [pathShape('line', { points: [0, 0, 100, 0] })], '')).toBeNull();
    expect(getBindingTarget2({ x: 50, y: 50 }, [rect('self')], 'self')).toBeNull();
    // An invisible topmost element doesn't shadow the visible one below.
    expect(getBindingTarget2({ x: 50, y: 50 }, [rect('shown'), rect('hidden', { visible: false })], '')?.id).toBe('shown');
  });
});

// =============================================================================
// rebindAfterElementsMoved
// =============================================================================

describe('rebindAfterElementsMoved', () => {
  /** box (post-move) + a 3-vertex connector whose START binds to box. */
  function fixture(boxOverrides?: Partial<ShapeElement>, startBinding?: ConnectorBinding) {
    const box = rect('box', boxOverrides);
    // Absolute vertices (100,50) → (150,75) → (200,50).
    const conn = pathShape('conn', {
      x: 100, y: 50, width: 100, height: 25,
      points: [0, 0, 50, 25, 100, 0],
      startBinding: startBinding ?? { elementId: 'box', anchor: 'right' },
      endBinding: null,
    });
    return {
      elements: { box, conn } as Record<string, SlideElement>,
      order: ['box', 'conn'],
    };
  }

  test('legacy-anchor binding: endpoint tracks the anchor point, interior vertices keep their absolute positions', () => {
    // Box already moved down by 100 → legacy right anchor now (100, 150).
    const { elements, order } = fixture({ y: 100 });
    const results = rebindAfterElementsMoved(elements, order, new Set(['box']));
    expect(results).toHaveLength(1);
    expect(results[0].elementId).toBe('conn');
    const rebound = { ...elements['conn'], ...results[0].changes } as ShapeElement;
    expect(absVertices(rebound)).toEqual([100, 150, 150, 75, 200, 50]);
    // Vertex count preserved — no truncation to a 2-point line.
    expect(rebound.points).toHaveLength(6);
  });

  test('pinned fixedPoint binding tracks the moved target', () => {
    const { elements, order } = fixture({ y: 100 }, { elementId: 'box', mode: 'pinned', fixedPoint: [0.5, 0] });
    const results = rebindAfterElementsMoved(elements, order, new Set(['box']));
    const rebound = { ...elements['conn'], ...results[0].changes } as ShapeElement;
    // [0.5, 0] on the moved box = (50, 100).
    expect(absVertices(rebound)).toEqual([50, 100, 150, 75, 200, 50]);
  });

  test('edge binding: endpoint re-solves against the silhouette toward the adjacent vertex', () => {
    // Box moved to y=100 → occupies (0,100)-(100,200), center (50,150).
    const { elements, order } = fixture({ y: 100 }, { elementId: 'box', mode: 'edge', focus: 0, gap: 0 });
    const results = rebindAfterElementsMoved(elements, order, new Set(['box']));
    const rebound = { ...elements['conn'], ...results[0].changes } as ShapeElement;
    const abs = absVertices(rebound);
    // Ray from the ADJACENT vertex (150,75) toward the center (50,150)
    // enters through the right edge x=100 at y = 112.5.
    expect(abs[0]).toBeCloseTo(100, 6);
    expect(abs[1]).toBeCloseTo(112.5, 6);
    expect(abs.slice(2)).toEqual([150, 75, 200, 50]);
  });

  test("a path's OWN geometry change re-solves its edge-mode ends", () => {
    // Box static; conn's points changed this mutation (conn ∈ movedIds).
    const { elements, order } = fixture(undefined, { elementId: 'box', mode: 'edge', focus: 0, gap: 0 });
    const results = rebindAfterElementsMoved(elements, order, new Set(['conn']));
    expect(results).toHaveLength(1);
    const rebound = { ...elements['conn'], ...results[0].changes } as ShapeElement;
    const abs = absVertices(rebound);
    // Ray (150,75) → box center (50,50) enters through x=100 at y = 62.5.
    expect(abs[0]).toBeCloseTo(100, 6);
    expect(abs[1]).toBeCloseTo(62.5, 6);
  });

  test("a moved path's PINNED / legacy ends are left alone (its own drag wins)", () => {
    const legacy = fixture({ y: 100 });
    expect(rebindAfterElementsMoved(legacy.elements, legacy.order, new Set(['box', 'conn']))).toEqual([]);
    const pinned = fixture(undefined, { elementId: 'box', mode: 'pinned', fixedPoint: [1, 0.5] });
    expect(rebindAfterElementsMoved(pinned.elements, pinned.order, new Set(['conn']))).toEqual([]);
  });

  test('no-op when the moved element anchors nothing', () => {
    const { elements, order } = fixture();
    const other = rect('other', { x: 500, y: 500 });
    expect(
      rebindAfterElementsMoved({ ...elements, other }, [...order, 'other'], new Set(['other'])),
    ).toEqual([]);
    expect(rebindAfterElementsMoved(elements, order, new Set())).toEqual([]);
  });

  test('tolerates stale elementOrder ids (missing element) and skips non-shapes', () => {
    const { elements, order } = fixture({ y: 100 });
    const withText = { ...elements, note: textEl('note') as SlideElement };
    const results = rebindAfterElementsMoved(withText, ['ghost', ...order, 'note'], new Set(['box']));
    expect(results.map((r) => r.elementId)).toEqual(['conn']);
  });

  test('a binding whose target no longer exists is skipped, not crashed on', () => {
    const { elements, order } = fixture(undefined, { elementId: 'gone', mode: 'edge' });
    const other = rect('other');
    expect(
      rebindAfterElementsMoved({ ...elements, other }, [...order, 'other'], new Set(['other', 'conn'])),
    ).toEqual([]);
  });

  test('a path bound to TWO moved elements tracks both in one pass', () => {
    const a = rect('a', { y: 100 });                 // pinned right → (100, 150)
    const b = rect('b', { x: 300, y: 200 });         // pinned left  → (300, 250)
    const conn = pathShape('conn', {
      x: 100, y: 50, width: 200, height: 30,
      points: [0, 0, 100, 30, 200, 0],               // abs (100,50) (200,80) (300,50)
      startBinding: { elementId: 'a', mode: 'pinned', fixedPoint: [1, 0.5] },
      endBinding: { elementId: 'b', mode: 'pinned', fixedPoint: [0, 0.5] },
    });
    const elements = { a, b, conn } as Record<string, SlideElement>;
    const results = rebindAfterElementsMoved(elements, ['a', 'b', 'conn'], new Set(['a', 'b']));
    expect(results).toHaveLength(1);
    const rebound = { ...conn, ...results[0].changes } as ShapeElement;
    expect(absVertices(rebound)).toEqual([100, 150, 200, 80, 300, 250]);
  });
});

// =============================================================================
// bindDraftEndpoints (bind-while-drawing commit helper)
// =============================================================================

describe('bindDraftEndpoints', () => {
  const boxA = rect('a');                       // (0,0)-(100,100)
  const boxB = rect('b', { x: 300, y: 300 });   // (300,300)-(400,400)

  test('endpoints near targets get edge bindings and keep their exact position', () => {
    const { absPoints, startBinding, endBinding } =
      bindDraftEndpoints([120, 50, 290, 350], [boxA, boxB]);
    // Outside the silhouette → focus/gap encode the exact point (identity).
    expect(absPoints[0]).toBeCloseTo(120, 6);
    expect(absPoints[1]).toBeCloseTo(50, 6);
    expect(absPoints[2]).toBeCloseTo(290, 6);
    expect(absPoints[3]).toBeCloseTo(350, 6);
    expect(startBinding).toMatchObject({ elementId: 'a', mode: 'edge' });
    // Gap is measured along the ray from the adjacent vertex, so it's > 0
    // for any endpoint outside the silhouette.
    expect(startBinding!.gap!).toBeGreaterThan(0);
    expect(endBinding).toMatchObject({ elementId: 'b', mode: 'edge' });
  });

  test('an endpoint INSIDE a shape is pulled onto its silhouette (gap 0)', () => {
    const { absPoints, startBinding } =
      bindDraftEndpoints([50, 50, 300, 300], [boxA]);
    expect(startBinding).toMatchObject({ elementId: 'a', mode: 'edge', gap: 0 });
    // Ray from the adjacent vertex (300,300) through the center exits the
    // rect at its corner (100,100) — the endpoint hugs the outline there.
    expect(absPoints[0]).toBeCloseTo(100, 6);
    expect(absPoints[1]).toBeCloseTo(100, 6);
  });

  test('far endpoints stay unbound and unmoved', () => {
    const { absPoints, startBinding, endBinding } =
      bindDraftEndpoints([120, 50, 200, 200], [boxA, boxB]);
    expect(startBinding).toMatchObject({ elementId: 'a', mode: 'edge' });
    expect(endBinding).toBeNull();
    expect(absPoints.slice(2)).toEqual([200, 200]);
  });

  test('interior vertices of a poly draft are never touched', () => {
    const { absPoints, startBinding, endBinding } =
      bindDraftEndpoints([120, 50, 180, 120, 250, 90, 290, 350], [boxA, boxB]);
    expect(startBinding).not.toBeNull();
    expect(endBinding).not.toBeNull();
    expect(absPoints.slice(2, 6)).toEqual([180, 120, 250, 90]);
  });

  test('degenerate vertex lists return null bindings', () => {
    expect(bindDraftEndpoints([1, 2], [boxA])).toEqual({
      absPoints: [1, 2], startBinding: null, endBinding: null,
    });
  });

  test('invisible and locked elements are not draft-bind targets', () => {
    const hidden = rect('h', { visible: false });
    const locked = rect('l', { locked: true });
    const { startBinding, endBinding } = bindDraftEndpoints([50, 50, 50, 0], [hidden, locked]);
    expect(startBinding).toBeNull();
    expect(endBinding).toBeNull();
  });
});
