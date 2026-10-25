import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('./keyboard', () => ({ isShiftHeld: () => false, isCtrlHeld: () => false }));
import { projectGestureScene, type GesturePatch } from './gestureProjection';
import { createPresentation, createShapeElement } from './slideFactory';
import { createBoundLabel, attachLabelMasks, fitLabelToDoc } from './syncDependents';
import { planElementTranslation } from './elementTranslation';
import { resizeSelection, selectionResizeBounds } from './resizeGeometry';
import { pathGeometryUpdate } from './pathEditing';
import { usePresentationStore as store } from '../store/presentationStore';
import { useEditorStore as editor } from '../store/editorStore';
import { setActiveDoc } from '../collab/yDocAdapter';
import { jsonToYDoc, yDocToJson } from '../collab/ySchema';

afterEach(() => setActiveDoc(null));

describe.each([false, true])('gesture scene projection / collab=%s', collab => {
  it.each(['translate', 'resize', 'rotate', 'path', 'radius'])('%s matches the existing commit without preview writes', kind => {
    const p = createPresentation(), sid = p.slideOrder[0], slide = p.slides[sid];
    const target = createShapeElement('rect', { id: 'target', x: 100, y: 100, width: 160, height: 100, opacity: .37, fillStyle: 'crosshatch' });
    const arrow = createShapeElement('path', { id: 'arrow', x: 260, y: 150, width: 200, height: 80,
      points: [0, 0, 200, 80], strokeWidth: 9, strokeStyle: 'dotted', endHead: 'diamond',
      startBinding: { elementId: target.id, mode: 'pinned', fixedPoint: [1, .5] } });
    const label = { ...createBoundLabel(arrow), id: 'label', text: 'Label', width: 55, height: 25 };
    const front = createShapeElement('ellipse', { id: 'front', x: 125, y: 135, opacity: .6 });
    slide.elements = { target, arrow, label, front }; slide.elementOrder = ['target', 'arrow', 'label', 'front'];
    store.setState({ presentation: p }); editor.setState({ activeSlideId: sid, selectedSlideIds: [] });
    const doc = collab ? jsonToYDoc(p) : null; setActiveDoc(doc);
    store.temporal.getState().clear();
    const read = () => (doc ? yDocToJson(doc) : store.getState().presentation).slides[sid];
    const before = JSON.stringify(read());
    let patches: GesturePatch[];
    const batch = !['path', 'radius'].includes(kind);
    switch (kind) {
      case 'translate': patches = planElementTranslation(slide.elements, new Map([['target', { x: target.x, y: target.y }]]), { x: 70, y: 30 }); break;
      case 'resize': { const b = selectionResizeBounds([target]); patches = resizeSelection([target], b, { ...b, width: 220, height: 160 }); break; }
      case 'rotate': patches = [{ elementId: 'target', changes: { rotation: 37 } }]; break;
      case 'path': patches = [{ elementId: 'arrow', changes: { ...pathGeometryUpdate(arrow, [0, 0, 150, 180]), endBinding: null } }]; break;
      default: patches = [{ elementId: 'target', changes: { cornerRadius: 40 } }];
    }
    try {
      const projected = projectGestureScene(slide, patches, batch);
      expect(JSON.stringify(read())).toBe(before);
      expect(store.temporal.getState().pastStates).toHaveLength(0);
      expect(projected.map(el => el.id)).toEqual(slide.elementOrder);
      expect(projected[0].opacity).toBe(.37);
      expect(projected[3]).toBe(front);
      if (batch) store.getState().updateElements(sid, patches);
      else store.getState().updateElement(sid, patches[0].elementId, patches[0].changes);
      const committed = read();
      expect(projected).toEqual(attachLabelMasks(committed.elementOrder.map(id => committed.elements[id]), '#ffffff'));
      expect(projected[1]).toHaveProperty('_labelMask.x', projected[2].x);
    } finally { setActiveDoc(null); doc?.destroy(); }
  });
  it('measured bound fit projects container, label and labeled connector exactly like atomic commit', () => {
    const p = createPresentation(), sid = p.slideOrder[0], slide = p.slides[sid];
    const target = createShapeElement('rect', { id: 'target', x: 100, y: 100, width: 200, height: 190 });
    const label = { ...createBoundLabel(target), id: 'label', text: 'old' };
    const arrow = createShapeElement('path', { id: 'arrow', x: 300, y: 195, width: 200, height: 80,
      points: [0, 0, 200, 80], startBinding: { elementId: target.id, mode: 'pinned', fixedPoint: [1, .5] } });
    const arrowLabel = { ...createBoundLabel(arrow), id: 'arrowLabel', text: 'Arrow label' };
    slide.elements = { target, label, arrow, arrowLabel }; slide.elementOrder = ['target', 'label', 'arrow', 'arrowLabel'];
    store.setState({ presentation: p }); editor.setState({ activeSlideId: sid, selectedSlideIds: [] });
    const doc = collab ? jsonToYDoc(p) : null; setActiveDoc(doc); store.temporal.getState().clear();
    const read = () => (doc ? yDocToJson(doc) : store.getState().presentation).slides[sid];
    const before = JSON.stringify(read());
    const fit = fitLabelToDoc(target, label, { width: 180, height: 200 }, { baselineHeight: 190, currentHeight: 190 });
    const patches = [{ elementId: 'label', changes: { ...fit.label, text: 'long' } }, { elementId: 'target', changes: fit.container! }];
    try {
      const projected = projectGestureScene(slide, patches, true, true);
      expect(JSON.stringify(read())).toBe(before); expect(store.temporal.getState().pastStates).toHaveLength(0);
      expect(projected[0]).toMatchObject({ height: 210, x: 100, y: 100 });
      expect(projected[1]).toMatchObject({ boundTextBaselineHeight: 190 });
      expect(projected[2].y).not.toBe(arrow.y);
      expect(projected[2]).toHaveProperty('_labelMask.y', projected[3].y);
      store.getState().updateElements(sid, patches, true);
      const committed = read();
      expect(projected).toEqual(attachLabelMasks(committed.elementOrder.map(id => committed.elements[id]), '#ffffff'));
    } finally { setActiveDoc(null); doc?.destroy(); }
  });

});
