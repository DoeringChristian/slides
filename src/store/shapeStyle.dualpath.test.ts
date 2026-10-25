import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('../utils/keyboard', () => ({ isShiftHeld: () => false, isCtrlHeld: () => false }));
import { usePresentationStore as store } from './presentationStore';
import { useEditorStore as editor } from './editorStore';
import { updateElementFromCurrent } from './currentMutation';
import { createPresentation, createShapeElement, copySlideAsKeyframe } from '../utils/slideFactory';
import { jsonToYDoc, yDocToJson } from '../collab/ySchema';
import { setActiveDoc } from '../collab/yDocAdapter';
import { withPaintAlpha } from '../utils/paintColor';
import type { ShapeElement, SlideElement } from '../types/presentation';

afterEach(() => setActiveDoc(null));
describe.each([false, true])('shape style mutations collab=%s', collab => {
  it('independent paint alpha leaves old opacity untouched; optional solid sync clears hatch', () => {
    const p = createPresentation(), sid = p.slideOrder[0];
    const el = createShapeElement('rect', { id: 'shape', opacity: .4, fill: '#ff0000', stroke: '#0000ff' });
    p.slides[sid].elements = { shape: el }; p.slides[sid].elementOrder = ['shape'];
    const next = copySlideAsKeyframe(p.slides[sid]);
    (next.elements.shape as ShapeElement).fillStyle = 'crosshatch';
    p.slides[next.id] = next; p.slideOrder.push(next.id);
    store.setState({ presentation: p }); editor.setState({ activeSlideId: sid, selectedSlideIds: [] });
    const doc = collab ? jsonToYDoc(p) : null; setActiveDoc(doc);
    const read = () => doc ? yDocToJson(doc) : store.getState().presentation;
    updateElementFromCurrent(sid, el, current => ({ fill: withPaintAlpha(current.fill, .25) }));
    updateElementFromCurrent(sid, el, current => ({ stroke: withPaintAlpha(current.stroke, .75) }));
    expect(read().slides[sid].elements.shape).toMatchObject({ fill: 'rgba(255, 0, 0, 0.25)', stroke: 'rgba(0, 0, 255, 0.75)', opacity: .4 });
    store.getState().syncElementToSlides(sid, 'shape', [next.id], ['fillStyle'] as unknown as (keyof SlideElement)[]);
    expect((read().slides[next.id].elements.shape as ShapeElement).fillStyle).toBe('solid');
    setActiveDoc(null); doc?.destroy();
  });
});

it.each(['dashed', 'dotted', undefined] as const)('Yjs whole-deck and keyframe roundtrip retains optional dash %s', strokeStyle => {
  const p = createPresentation(), sid = p.slideOrder[0];
  const el = createShapeElement('path', { id: 'dash', points: [0, 0, 100, 80], ...(strokeStyle ? { strokeStyle } : {}) });
  p.slides[sid].elements = { dash: el }; p.slides[sid].elementOrder = ['dash'];
  const next = copySlideAsKeyframe(p.slides[sid]); p.slides[next.id] = next; p.slideOrder.push(next.id);
  const doc = jsonToYDoc(p), roundtrip = yDocToJson(doc);
  for (const slide of Object.values(roundtrip.slides)) {
    expect((slide.elements.dash as ShapeElement).strokeStyle).toBe(strokeStyle);
    if (!strokeStyle) expect(slide.elements.dash).not.toHaveProperty('strokeStyle');
  }
  doc.destroy();
});
