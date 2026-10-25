import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { assertPresentation } from './currentPresentation';
import { createPresentation, createShapeElement, createTextElement, duplicateElements } from './slideFactory';
import { createBoundLabel } from './syncDependents';
import { textInsets } from './boundTextLayout';
import { jsonToYDoc, yDocToJson } from '../collab/ySchema';
import { usePresentationStore } from '../store/presentationStore';
import { importPresentationFile } from './importPresentation';

function fixture() {
  const p = createPresentation(), slide = p.slides[p.slideOrder[0]];
  const box = createShapeElement('rect', { id: 'box' });
  const arrow = createShapeElement('path', { id: 'arrow', creationPreset: 'arrow', points: [0, 0, 100, 100], endHead: 'triangle',
    startBinding: { elementId: box.id, mode: 'aim', fixedPoint: [.3, .6], gap: 0 },
    endBinding: { elementId: box.id, mode: 'pinned', fixedPoint: [1, .5] } });
  const label = { ...createBoundLabel(box), id: 'label' };
  const free = createTextElement({ id: 'free', text: '$x$ **free**', textSizing: 'auto-content' });
  slide.elements = { box, arrow, label, free }; slide.elementOrder = Object.keys(slide.elements);
  p.templates.template = { id: 'template', name: 'Current', elements: structuredClone(slide.elements), elementOrder: [...slide.elementOrder], background: slide.background };
  return p;
}
describe('currentPresentation native schema', () => {
  it('current factory, template, JSON import, loader and Yjs agree without rewriting', async () => {
    const p = fixture();
    expect(assertPresentation(p)).toBe(p);
    const parsed = await importPresentationFile({ name: 'current.json', text: async () => JSON.stringify(p) } as File);
    expect(parsed).toEqual(p);
    usePresentationStore.getState().loadPresentation(parsed);
    expect(usePresentationStore.getState().presentation).toEqual(p);
    const doc = jsonToYDoc(p);
    expect(yDocToJson(doc)).toEqual(p); doc.destroy();
  });
  it.each(['autoAdvance', 'shapeType', 'booleanHead', 'anchor', 'edge', 'missingMode', 'missingSizing', 'oldLayout', 'missingPreset', 'template'])('rejects %s before any native conversion or store replacement', obsolete => {
    const p = fixture(), slide = p.slides[p.slideOrder[0]];
    const shape = slide.elements.arrow as unknown as Record<string, unknown>;
    const text = slide.elements.free as unknown as Record<string, unknown>;
    if (obsolete === 'autoAdvance') Object.assign(slide, { autoAdvance: true });
    if (obsolete === 'shapeType') shape.shapeType = 'arrow';
    if (obsolete === 'booleanHead') shape.endArrow = true;
    if (obsolete === 'anchor') shape.startBinding = { elementId: 'box', anchor: 'top' };
    if (obsolete === 'edge') shape.startBinding = { elementId: 'box', mode: 'edge', focus: .2 };
    if (obsolete === 'missingMode') shape.startBinding = { elementId: 'box', fixedPoint: [.5, .5] };
    if (obsolete === 'missingSizing') delete text.textSizing;
    if (obsolete === 'oldLayout') text.boundTextLayout = 'measured-v1';
    if (obsolete === 'missingPreset') delete shape.creationPreset;
    if (obsolete === 'template') Object.assign(p.templates.template.elements.arrow, { shapeType: 'line' });
    const before = structuredClone(p), storeBefore = usePresentationStore.getState().presentation;
    expect(() => assertPresentation(p)).toThrow('Unsupported presentation format:');
    const empty = new Y.Doc();
    expect(() => jsonToYDoc(p, empty)).toThrow('Unsupported presentation format:');
    expect(empty.getMap('presentation').size).toBe(0); empty.destroy();
    expect(() => usePresentationStore.getState().loadPresentation(p)).toThrow('Unsupported presentation format:');
    expect(usePresentationStore.getState().presentation).toBe(storeBefore);
    expect(p).toEqual(before);
  });
  it('rejects old live Yjs payloads rather than projecting or stripping bindings', () => {
    const doc = jsonToYDoc(fixture());
    doc.getMap('presentation').set('slides', { old: { id: 'old', elements: {}, elementOrder: [], autoAdvance: true } });
    expect(() => yDocToJson(doc)).toThrow('Unsupported presentation format:');
    doc.destroy();
  });
  it('rejects dangling labels rather than silently freeing text', () => {
    const p = fixture(); Object.assign(p.slides[p.slideOrder[0]].elements.label, { containerId: 'gone' });
    expect(() => assertPresentation(p)).toThrow('references missing element');
    expect(() => usePresentationStore.getState().loadPresentation(p)).toThrow('references missing element');
  });
  it.each(['rect', 'ellipse', 'triangle', 'star', 'path', 'vector'] as const)('%s labels carry explicit current layout through copy/detach and Yjs', shapeType => {
    const p = createPresentation(), slide = p.slides[p.slideOrder[0]], container = createShapeElement(shapeType);
    const label = createBoundLabel(container), measured = shapeType === 'rect' || shapeType === 'ellipse';
    expect(label.boundTextLayout).toBe(measured ? 'measured' : 'padded');
    expect(textInsets(label)).toBe(measured ? 0 : 14);
    const copies = duplicateElements([container, label]);
    expect((copies[1] as typeof label).containerId).toBe(copies[0].id);
    const detached = duplicateElements([label])[0] as typeof label;
    expect(detached.containerId).toBeUndefined(); expect(detached.textSizing).toBe('user-width'); expect(textInsets(detached)).toBe(0);
    for (const el of [container, label, ...copies, detached]) { slide.elements[el.id] = el; slide.elementOrder.push(el.id); }
    const doc = jsonToYDoc(p); expect(yDocToJson(doc)).toEqual(p); doc.destroy();
  });
});
