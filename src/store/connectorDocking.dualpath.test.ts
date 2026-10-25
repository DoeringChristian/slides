import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('../utils/keyboard', () => ({ isShiftHeld: () => false, isCtrlHeld: () => false }));
import { usePresentationStore as store } from './presentationStore';
import { useEditorStore as editor } from './editorStore';
import { createUndoManagerFor } from '../collab/activeUndo';
import { setActiveDoc } from '../collab/yDocAdapter';
import { jsonToYDoc, yDocToJson } from '../collab/ySchema';
import { createPresentation, createShapeElement, createTextElement } from '../utils/slideFactory';
import { bindingAimPoint, bindDraftEndpoints, connectorDockCue } from '../utils/connectorUtils';
import { pathPointsInSlide } from '../utils/pathEditing';
import { pathBoundsFor } from '../utils/pathShapes';
import { projectGestureScene } from '../utils/gestureProjection';
import type { ShapeElement } from '../types/presentation';
afterEach(() => setActiveDoc(null));

describe.each([false, true])('connector docking JSON/Yjs collab=%s', collab => {
  it.each(['rect', 'ellipse'] as const)('%s latched creation, target transform, dependent projection and undo', shapeType => {
    const p = createPresentation(), sid = p.slideOrder[0];
    const target = createShapeElement(shapeType, { id: 'target', x: 100, y: 100, width: 200, height: 120 });
    p.slides[sid].elements = { target }; p.slides[sid].elementOrder = ['target'];
    store.setState({ presentation: p }); editor.setState({ activeSlideId: sid, selectedSlideIds: [] }); store.temporal.getState().clear();
    const doc = collab ? jsonToYDoc(p) : null; setActiveDoc(doc);
    const undo = doc ? createUndoManagerFor(doc) : null;
    const read = () => (doc ? yDocToJson(doc) : store.getState().presentation).slides[sid];
    try {
      const before = read();
      const pin = connectorDockCue({ x: 305, y: 160 }, target)!.binding;
      const draft = bindDraftEndpoints([300, 160, 600, 330], [target], 1, false, pin);
      expect(read()).toEqual(before); // cancelled preview needs no rollback
      const arrow = createShapeElement('path', { id: 'arrow', ...pathBoundsFor(draft.absPoints, 'linear', false), startBinding: draft.startBinding, endBinding: draft.endBinding, endHead: 'triangle' });
      store.getState().addElement(sid, arrow);
      expect((read().elements.arrow as ShapeElement).startBinding).toEqual(pin);
      expect(undo?.undoStack.length ?? store.temporal.getState().pastStates.length).toBe(1);
      if (undo) undo.undo(); else store.temporal.getState().undo();
      expect(read().elements).toEqual(before.elements);
      store.getState().addElement(sid, arrow);
      store.getState().addElement(sid, createTextElement({ id: 'label', containerId: 'arrow', text: 'Dock label' }));
      undo?.clear(); undo?.stopCapturing(); store.temporal.getState().clear();
      const preTransform = read();
      const updates = [{ elementId: 'target', changes: { x: 180, y: 140, width: 320, height: 90, rotation: 37 } }];
      const projected = projectGestureScene(preTransform, updates);
      expect(read()).toEqual(preTransform);
      store.getState().updateElements(sid, updates);
      const after = read(), result = after.elements.arrow as ShapeElement;
      expect(projected.find(el => el.id === 'arrow')).toMatchObject(result);
      expect(after.elements.label).toEqual(projected.find(el => el.id === 'label'));
      expect(result.startBinding).toEqual(pin);
      const point = bindingAimPoint(pin, after.elements.target), points = pathPointsInSlide(result);
      expect(points[0]).toBeCloseTo(point.x, 9); expect(points[1]).toBeCloseTo(point.y, 9);
      expect(undo?.undoStack.length ?? store.temporal.getState().pastStates.length).toBe(1);
      if (undo) undo.undo(); else store.temporal.getState().undo();
      expect(read().elements).toEqual(preTransform.elements);
    } finally { undo?.destroy(); setActiveDoc(null); doc?.destroy(); }
  });
});
