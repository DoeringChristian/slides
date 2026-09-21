/**
 * Pure unit tests for the connector binding helpers (node-env, DOM-free):
 *  - getBindingTarget's candidate filtering (invisible / locked / path / self)
 *  - rebindAfterElementsMoved, THE shared rebind pass used by all four store
 *    call sites (updateElement / updateElements × Y / JSON)
 *  - bindDraftEndpoints, the bind-while-drawing commit helper
 */
import { describe, expect, test } from 'vitest';
import {
  getBindingTarget,
  getAnchorPoint,
  rebindAfterElementsMoved,
  bindDraftEndpoints,
} from './connectorUtils';
import type { SlideElement, ShapeElement, TextElement } from '../types/presentation';

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

// =============================================================================
// getBindingTarget
// =============================================================================

describe('getBindingTarget', () => {
  test('binds to the nearest anchor within the threshold', () => {
    const els = [rect('box')];
    expect(getBindingTarget({ x: 52, y: 2 }, els, '')).toEqual({ elementId: 'box', anchor: 'top' });
    expect(getBindingTarget({ x: 98, y: 52 }, els, '')).toEqual({ elementId: 'box', anchor: 'right' });
    // Outside the 30-unit threshold of every anchor.
    expect(getBindingTarget({ x: 75, y: 25 }, els, '')).toBeNull();
  });

  test('skips invisible elements', () => {
    const els = [rect('ghost', { visible: false })];
    expect(getBindingTarget({ x: 50, y: 0 }, els, '')).toBeNull();
  });

  test('skips locked elements', () => {
    const els = [rect('frozen', { locked: true })];
    expect(getBindingTarget({ x: 50, y: 0 }, els, '')).toBeNull();
  });

  test('skips path shapes and the excluded element itself', () => {
    const line = pathShape('line', { points: [0, 0, 100, 0] });
    expect(getBindingTarget({ x: 50, y: 0 }, [line], '')).toBeNull();
    expect(getBindingTarget({ x: 50, y: 0 }, [rect('self')], 'self')).toBeNull();
  });

  test('an invisible element no longer shadows a visible one nearby', () => {
    // (50,0) is EXACTLY the hidden rect's top anchor; the visible rect's top
    // anchor is ~5.7 away. Without the visibility filter the ghost would win.
    const els = [rect('hidden', { visible: false }), rect('shown', { x: 4, y: 4 })];
    expect(getBindingTarget({ x: 50, y: 0 }, els, '')).toEqual({ elementId: 'shown', anchor: 'top' });
  });
});

// =============================================================================
// rebindAfterElementsMoved
// =============================================================================

describe('rebindAfterElementsMoved', () => {
  /** box (post-move) + a 3-vertex connector whose START binds to box:right. */
  function fixture(boxOverrides?: Partial<ShapeElement>) {
    const box = rect('box', boxOverrides);
    // Absolute vertices (100,50) → (150,75) → (200,50); start on box:right.
    const conn = pathShape('conn', {
      x: 100, y: 50, width: 100, height: 25,
      points: [0, 0, 50, 25, 100, 0],
      startBinding: { elementId: 'box', anchor: 'right' },
      endBinding: null,
    });
    return {
      elements: { box, conn } as Record<string, SlideElement>,
      order: ['box', 'conn'],
    };
  }

  test('multi-vertex path: bound endpoint tracks the anchor, other vertices keep their absolute positions', () => {
    // Box already moved down by 100 → right anchor now (100, 150).
    const { elements, order } = fixture({ y: 100 });
    const results = rebindAfterElementsMoved(elements, order, new Set(['box']));
    expect(results).toHaveLength(1);
    expect(results[0].elementId).toBe('conn');
    const rebound = { ...elements['conn'], ...results[0].changes } as ShapeElement;
    expect(absVertices(rebound)).toEqual([100, 150, 150, 75, 200, 50]);
    // Vertex count preserved — no truncation to a 2-point line.
    expect(rebound.points).toHaveLength(6);
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
    // 'ghost' is in the order but not in elements — the pre-fix JSON branch
    // crashed on el.type here.
    const results = rebindAfterElementsMoved(withText, ['ghost', ...order, 'note'], new Set(['box']));
    expect(results.map((r) => r.elementId)).toEqual(['conn']);
  });

  test('a moved connector is itself skipped (its own drag wins over the rebind pass)', () => {
    const { elements, order } = fixture({ y: 100 });
    expect(rebindAfterElementsMoved(elements, order, new Set(['box', 'conn']))).toEqual([]);
  });

  test('a path bound to TWO moved elements tracks both anchors in one pass', () => {
    const a = rect('a', { y: 100 });                 // right anchor → (100, 150)
    const b = rect('b', { x: 300, y: 200 });         // left anchor  → (300, 250)
    const conn = pathShape('conn', {
      x: 100, y: 50, width: 200, height: 30,
      points: [0, 0, 100, 30, 200, 0],               // abs (100,50) (200,80) (300,50)
      startBinding: { elementId: 'a', anchor: 'right' },
      endBinding: { elementId: 'b', anchor: 'left' },
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
  const boxA = rect('a');                       // right anchor (100, 50)
  const boxB = rect('b', { x: 300, y: 300 });   // left anchor  (300, 350)

  test('binds and snaps both endpoints that land near anchors', () => {
    const { absPoints, startBinding, endBinding } =
      bindDraftEndpoints([98, 52, 302, 348], [boxA, boxB]);
    expect(startBinding).toEqual({ elementId: 'a', anchor: 'right' });
    expect(endBinding).toEqual({ elementId: 'b', anchor: 'left' });
    expect(absPoints).toEqual([100, 50, 300, 350]);
    // Sanity: the snapped points sit exactly on the anchors.
    expect(getAnchorPoint(boxA, 'right')).toEqual({ x: 100, y: 50 });
    expect(getAnchorPoint(boxB, 'left')).toEqual({ x: 300, y: 350 });
  });

  test('far endpoints stay unbound and unmoved', () => {
    const { absPoints, startBinding, endBinding } =
      bindDraftEndpoints([98, 52, 200, 200], [boxA, boxB]);
    expect(startBinding).toEqual({ elementId: 'a', anchor: 'right' });
    expect(endBinding).toBeNull();
    expect(absPoints).toEqual([100, 50, 200, 200]);
  });

  test('interior vertices of a poly draft are never touched', () => {
    const { absPoints, startBinding, endBinding } =
      bindDraftEndpoints([98, 52, 180, 120, 250, 90, 302, 348], [boxA, boxB]);
    expect(startBinding).toEqual({ elementId: 'a', anchor: 'right' });
    expect(endBinding).toEqual({ elementId: 'b', anchor: 'left' });
    expect(absPoints).toEqual([100, 50, 180, 120, 250, 90, 300, 350]);
  });

  test('degenerate vertex lists return null bindings', () => {
    expect(bindDraftEndpoints([1, 2], [boxA])).toEqual({
      absPoints: [1, 2], startBinding: null, endBinding: null,
    });
  });

  test('invisible and locked elements are not draft-bind targets', () => {
    const hidden = rect('h', { visible: false });
    const locked = rect('l', { locked: true });
    const { startBinding, endBinding } = bindDraftEndpoints([98, 52, 50, 0], [hidden, locked]);
    expect(startBinding).toBeNull();
    expect(endBinding).toBeNull();
  });
});
