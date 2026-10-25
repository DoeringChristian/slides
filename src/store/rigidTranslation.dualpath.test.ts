import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('../utils/keyboard', () => ({ isShiftHeld: () => false, isCtrlHeld: () => false }));
import { usePresentationStore as store } from './presentationStore';
import { useEditorStore as editor } from './editorStore';
import { setActiveDoc } from '../collab/yDocAdapter';
import { jsonToYDoc, yDocToJson } from '../collab/ySchema';
import { createPresentation, createShapeElement } from '../utils/slideFactory';
import { bindingAimPoint, bindingFor, resolveBinding } from '../utils/connectorUtils';
import { pathPointsInSlide } from '../utils/pathEditing';
import { planElementTranslation } from '../utils/elementTranslation';
import type { ShapeElement, SlideElement } from '../types/presentation';

afterEach(() => setActiveDoc(null));

function fixture(collab: boolean, locked = false) {
  const p = createPresentation(), sid = p.slideOrder[0];
  const a = createShapeElement('rect', { id: 'a', x: 0, y: 0, width: 100, height: 100, cornerRadius: 0 });
  const b = createShapeElement('rect', { id: 'b', x: 200, y: 0, width: 100, height: 100, cornerRadius: 0 });
  const startBinding = bindingFor({ x:95, y:20 }, a, 'aim');
  const endBinding = bindingFor({ x:205, y:80 }, b, 'aim');
  const start = resolveBinding(startBinding, a, { x:205, y:80 });
  const end = resolveBinding(endBinding, b, { x:95, y:20 });
  const bound = { startBinding, endBinding, absPoints:[start.x,start.y,end.x,end.y] };
  const arrow = createShapeElement('path', {
    id: 'arrow', x: bound.absPoints[0], y: bound.absPoints[1], width: 100,
    height: bound.absPoints[3] - bound.absPoints[1], rotation: 0,
    points: [0, 0, 100, bound.absPoints[3] - bound.absPoints[1]],
    startBinding: bound.startBinding, endBinding: bound.endBinding,
  });
  b.locked = locked;
  p.slides[sid].elements = { a, b, arrow }; p.slides[sid].elementOrder = ['a', 'b', 'arrow'];
  store.setState({ presentation: p }); editor.setState({ activeSlideId: sid, selectedSlideIds: [] });
  const doc = collab ? jsonToYDoc(p) : null; setActiveDoc(doc);
  return {
    sid,
    read: () => (doc ? yDocToJson(doc) : store.getState().presentation).slides[sid].elements,
    dispose: () => { setActiveDoc(null); doc?.destroy(); },
  };
}

function plan(elements: Record<string, SlideElement>, ids = ['arrow', 'a', 'b']) {
  return planElementTranslation(elements, new Map(ids.map(id => [id, { x: elements[id].x, y: elements[id].y }])), { x: 60, y: 40 });
}

describe.each([false, true])('verified rigid translations collab=%s', collab => {
  it.each(['both', 'one', 'locked'])('%s targets: repeated exact translations retain only co-moving bindings', targets => {
    const f = fixture(collab, targets === 'locked');
    try {
      for (let n = 0; n < 3; n++) {
        const before = f.read(), arrow = before.arrow as ShapeElement;
        const vertices = pathPointsInSlide(arrow);
        const updates = plan(before, targets === 'one' ? ['arrow', 'a'] : undefined);
        store.getState().updateElements(f.sid, updates);
        const after = f.read(), result = after.arrow as ShapeElement;
        pathPointsInSlide(result).forEach((v, i) => expect(v).toBeCloseTo(vertices[i] + (i % 2 ? 40 : 60), 10));
        expect(result.points).toEqual(arrow.points);
        expect(result.width).toBe(arrow.width); expect(result.height).toBe(arrow.height);
        expect(result.startBinding).toEqual(arrow.startBinding);
        expect(result.endBinding).toEqual(targets === 'both' ? arrow.endBinding : null);
        expect(after.a.x - before.a.x).toBe(60);
        expect(after.b.x - before.b.x).toBe(targets === 'both' ? 60 : 0);
      }
    } finally { f.dispose(); }
  });

  const mutations: Array<{ name: string; id: string; changes: Partial<ShapeElement> }> = [
    { name: 'target resize', id: 'a', changes: { width: 120 } },
    { name: 'target rotation', id: 'a', changes: { rotation: 20 } },
    { name: 'target radius', id: 'a', changes: { cornerRadius: 40 } },
    { name: 'target shape type', id: 'a', changes: { shapeType: 'ellipse' } },
    { name: 'unequal target delta', id: 'a', changes: { y: 45 } },
    { name: 'connector resize', id: 'arrow', changes: { width: 120 } },
    { name: 'connector rotation', id: 'arrow', changes: { rotation: 20 } },
    { name: 'connector points', id: 'arrow', changes: { points: [0, 0, 100, 90] } },
    { name: 'connector curve', id: 'arrow', changes: { curve: 'smooth' } },
    { name: 'connector tangents', id: 'arrow', changes: { tangents: [0, 0, 10, 10, -10, -10, 0, 0] } },
    { name: 'binding focus', id: 'arrow', changes: { startBinding: { elementId: 'a', mode: 'aim', fixedPoint: [.5, .5], gap: 0 } } },
    { name: 'binding gap', id: 'arrow', changes: { startBinding: { elementId: 'a', mode: 'aim', fixedPoint: [.5, .5], gap: 10 } } },
  ];
  it.each(mutations)('$name must not be mistaken for a rigid translation', ({ id, changes }) => {
    const f = fixture(collab);
    try {
      const before = f.read(), updates = plan(before);
      Object.assign(updates.find(u => u.elementId === id)!.changes, changes);
      const post = { ...before };
      for (const update of updates) post[update.elementId] = { ...post[update.elementId], ...update.changes } as SlideElement;
      const arrow = post.arrow as ShapeElement, points = pathPointsInSlide(arrow);
      const expected = resolveBinding(arrow.startBinding!, post.a, arrow.curve && arrow.curve !== 'linear' ? { x: points[2], y: points[3] } : bindingAimPoint(arrow.endBinding!, post.b));
      store.getState().updateElements(f.sid, updates);
      const actual = pathPointsInSlide(f.read().arrow as ShapeElement);
      expect(actual[0]).toBeCloseTo(expected.x, 9); expect(actual[1]).toBeCloseTo(expected.y, 9);
      // Re-solving an aim can legitimately leave its border unchanged when the target-to-target ray is unchanged.
    } finally { f.dispose(); }
  });

  it.each(['endpoint edit', 'target only'])('%s still resolves the binding', operation => {
    const f = fixture(collab);
    try {
      const before = f.read();
      const update = operation === 'endpoint edit'
        ? { elementId: 'arrow', changes: { points: [0, 0, 100, 90] } }
        : { elementId: 'a', changes: { x: 60, y: 40 } };
      const post = { ...before, [update.elementId]: { ...before[update.elementId], ...update.changes } };
      const arrow = post.arrow as ShapeElement, points = pathPointsInSlide(arrow);
      const expected = resolveBinding(arrow.startBinding!, post.a, arrow.curve && arrow.curve !== 'linear' ? { x: points[2], y: points[3] } : bindingAimPoint(arrow.endBinding!, post.b));
      store.getState().updateElements(f.sid, [update]);
      const actual = pathPointsInSlide(f.read().arrow as ShapeElement);
      expect(actual[0]).toBeCloseTo(expected.x, 9); expect(actual[1]).toBeCloseTo(expected.y, 9);
    } finally { f.dispose(); }
  });
});
