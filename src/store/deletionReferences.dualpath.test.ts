import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GroupElement, Presentation, ShapeElement, SlideElement } from '../types/presentation';
import { createUndoManagerFor } from '../collab/activeUndo';
import { setActiveDoc } from '../collab/yDocAdapter';
import { jsonToYDoc, yDocToJson } from '../collab/ySchema';
import { assertPresentation } from '../utils/currentPresentation';
import { bindingFor, resolveBinding } from '../utils/connectorUtils';
import { pathPointsInSlide } from '../utils/pathEditing';
import { pathBoundsFor } from '../utils/pathShapes';
import { createPresentation, createShapeElement, createSlide, createTextElement } from '../utils/slideFactory';
import { useEditorStore as editor } from './editorStore';
import { usePresentationStore as store } from './presentationStore';

vi.mock('../utils/keyboard', () => ({ isShiftHeld: () => false, isCtrlHeld: () => false }));
afterEach(() => { setActiveDoc(null); vi.restoreAllMocks(); });

function fixture(): Presentation {
  const p = createPresentation(), sid = p.slideOrder[0];
  const box = createShapeElement('rect', { id: 'box', x: 300, y: 100, width: 180, height: 100, rotation: 31 });
  const keeper = createShapeElement('rect', { id: 'keeper', x: 20, y: 300, width: 100, height: 80 });
  const elements: Record<string, SlideElement> = { box, keeper };
  for (const mode of ['aim', 'pinned'] as const) {
    const startTarget = mode === 'aim' ? box : keeper;
    const endTarget = mode === 'aim' ? keeper : box;
    const startBinding = bindingFor({ x: startTarget.x + startTarget.width / 2, y: startTarget.y + startTarget.height / 2 }, startTarget, mode);
    const endBinding = bindingFor({ x: endTarget.x + endTarget.width / 2, y: endTarget.y + endTarget.height / 2 }, endTarget, mode);
    const start = resolveBinding(startBinding, startTarget, { x: endTarget.x, y: endTarget.y });
    const end = resolveBinding(endBinding, endTarget, { x: startTarget.x, y: startTarget.y });
    elements[mode] = createShapeElement('path', {
      id: mode, creationPreset: 'arrow', endHead: 'arrow', startBinding, endBinding,
      ...pathBoundsFor([start.x, start.y, end.x, end.y], 'linear', false),
    });
  }
  elements.label = createTextElement({ id: 'label', text: 'Target label', containerId: 'box', boundTextLayout: 'measured' });
  elements.connectorLabel = createTextElement({ id: 'connectorLabel', text: 'Surviving label', containerId: 'aim' });
  elements.group = { id: 'group', type: 'group', childIds: ['box', 'label', 'aim', 'pinned', 'connectorLabel'], x: 0, y: 0, width: 600, height: 400, rotation: 0, opacity: 1, locked: false, visible: true };
  elements.emptyGroup = { ...elements.group, id: 'emptyGroup', childIds: ['box', 'label'] } as GroupElement;
  p.slides[sid].elements = elements;
  p.slides[sid].elementOrder = Object.keys(elements);
  for (const el of Object.values(elements)) p.objects[el.id] = { id: el.id, name: el.id, type: el.type === 'text' ? 'text' : 'shape' };
  const next = createSlide({ id: 'next', elements: structuredClone(elements), elementOrder: Object.keys(elements) });
  p.slides.next = next; p.slideOrder.push('next');
  return assertPresentation(p);
}

function setup(collab: boolean) {
  const p = fixture();
  store.setState({ presentation: p });
  editor.setState({ activeSlideId: p.slideOrder[0], selectedSlideIds: [], selectedElementIds: [] });
  store.temporal.getState().clear();
  const doc = collab ? jsonToYDoc(p) : null;
  setActiveDoc(doc);
  const undo = doc ? createUndoManagerFor(doc) : null;
  return {
    p, doc, undo,
    read: () => doc ? yDocToJson(doc) : store.getState().presentation,
    dispose: () => { undo?.destroy(); setActiveDoc(null); doc?.destroy(); },
  };
}

// Exercise the mutation producers, not a load-time repair or a legacy fixture.
describe.each([false, true])('current deletion references collab=%s', collab => {
  it.each(['deleteElements', 'hideElement', 'removeObject'] as const)('%s purges references and roundtrips with exact atomic undo/redo', action => {
    const ctx = setup(collab);
    try {
      const before = structuredClone(ctx.read());
      const sid = ctx.p.slideOrder[0];
      if (action === 'removeObject') store.getState().removeObject('box');
      else if (action === 'hideElement') {
        // Hide on the second slide first, keeping the target alive on the first.
        store.getState().hideElement('next', 'box');
        ctx.undo?.clear(); store.temporal.getState().clear();
        Object.assign(before, structuredClone(ctx.read()));
        store.getState().hideElement(sid, 'box');
      } else store.getState().deleteElements(sid, ['box']);
      const after = structuredClone(ctx.read());
      for (const slideId of after.slideOrder) {
        const els = after.slides[slideId].elements, old = before.slides[slideId].elements;
        expect(els.box).toBeUndefined(); expect(els.label).toBeUndefined();
        expect(after.objects.box).toBeUndefined(); expect(after.objects.label).toBeUndefined();
        expect(els.aim).toEqual({ ...old.aim, startBinding: null });
        expect(els.pinned).toEqual({ ...old.pinned, endBinding: null });
        for (const id of ['aim', 'pinned']) expect(pathPointsInSlide(els[id] as ShapeElement)).toEqual(pathPointsInSlide(old[id] as ShapeElement));
        expect(els.connectorLabel).toEqual(old.connectorLabel);
        expect((els.group as GroupElement).childIds).toEqual(['aim', 'pinned', 'connectorLabel']);
        expect((els.emptyGroup as GroupElement).childIds).toEqual([]);
      }
      // An in-memory save/reopen through the actual strict store loader must
      // not add a history entry that masks the deletion's own undo transaction.
      const saved = JSON.parse(JSON.stringify(after));
      store.temporal.getState().pause();
      try { store.getState().loadPresentation(saved); } finally { store.temporal.getState().resume(); }
      expect(store.getState().presentation).toEqual(after);
      expect(ctx.undo?.undoStack.length ?? store.temporal.getState().pastStates.length).toBe(1);
      if (ctx.undo) ctx.undo.undo(); else store.temporal.getState().undo();
      expect(ctx.read()).toEqual(before);
      if (ctx.undo) ctx.undo.redo(); else store.temporal.getState().redo();
      expect(ctx.read()).toEqual(after);
      expect(assertPresentation(ctx.read())).toEqual(saved);
    } finally { ctx.dispose(); }
  });

  it.each(['deleteElements', 'hideElement'] as const)('%s preserves bindings and group children when target is only hidden', action => {
    const ctx = setup(collab);
    try {
      const before = structuredClone(ctx.read());
      if (action === 'deleteElements') store.getState().deleteElements('next', ['box']);
      else store.getState().hideElement('next', 'box');
      const after = ctx.read();
      expect(after.slides.next.elements.box.visible).toBe(false);
      expect(after.slides[ctx.p.slideOrder[0]].elements.box.visible).toBe(true);
      for (const sid of after.slideOrder) {
        for (const id of ['aim', 'pinned', 'group', 'emptyGroup']) expect(after.slides[sid].elements[id]).toEqual(before.slides[sid].elements[id]);
      }
      expect(assertPresentation(JSON.parse(JSON.stringify(after)))).toEqual(after);
      if (ctx.undo) ctx.undo.undo(); else store.temporal.getState().undo();
      expect(ctx.read()).toEqual(before);
      if (ctx.undo) ctx.undo.redo(); else store.temporal.getState().redo();
      expect(ctx.read()).toEqual(after);
    } finally { ctx.dispose(); }
  });
});
