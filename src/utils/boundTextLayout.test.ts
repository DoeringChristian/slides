import { describe, expect, it } from 'vitest';
import { boundLabelChangesFor, createBoundLabel, fitLabelToDoc, labelWrapWidthFor, syncDependentsAfterMutation } from './syncDependents';
import { boundTextBaseline, boundTextMeasurementKey, boundTextUsableRect, textInsets } from './boundTextLayout';
import { createShapeElement, createTextElement } from './slideFactory';
import { jsonToYDoc, yDocToJson } from '../collab/ySchema';
import { createPresentation } from './slideFactory';

describe('measured bound text policy', () => {
  for (const kind of ['rect', 'ellipse'] as const) it(`${kind} overflow gate, below-baseline shrink, fixed top-left and rotation`, () => {
    const box = createShapeElement(kind, { id: 'box', x: 400, y: 380, width: 200, height: 190, rotation: 30 });
    const label = createBoundLabel(box);
    const context = { baselineHeight: 190, currentHeight: 190 };
    expect(textInsets(label)).toBe(0);
    expect(labelWrapWidthFor(box, label)).toBe(kind === 'rect' ? 190 : 131);
    expect(fitLabelToDoc(box, label, { width: 16, height: 25 }, context).container).toBeNull();
    const long = fitLabelToDoc(box, label, { width: 100, height: 200 }, context);
    expect(long.container).toEqual({ height: kind === 'rect' ? 210 : 297 });
    context.currentHeight = long.container!.height!;
    const short = fitLabelToDoc(box, label, { width: 16, height: 25 }, context);
    expect(short.container).toEqual({ height: kind === 'rect' ? 35 : 49 });
    expect(short.label).toMatchObject({ width: 16.001, height: 25, rotation: 30 });
    const usable = boundTextUsableRect({ ...box, height: short.container!.height! });
    expect(short.label!.x).toBeCloseTo(usable.x + (usable.width - 16.001) / 2, 10);
    expect(short.label!.y).toBeCloseTo(usable.y + (usable.height - 25) / 2, 10);
    // Passive layout must not shrink a loaded/manual shape.
    expect(fitLabelToDoc(box, label, { width: 16, height: 25 }).container).toBeNull();
  });
  it('path labels retain padded wrap policy; invalid baseline uses container height', () => {
    const box = createShapeElement('path', { width: 200, height: 190, points: [0, 0, 200, 190] });
    const legacy = createBoundLabel(box);
    expect(textInsets(legacy)).toBe(14);
    expect(labelWrapWidthFor(box, legacy)).toBe(132);
    expect(createBoundLabel(createShapeElement('path')).boundTextLayout).toBe('padded');
    expect(boundTextBaseline(box, { ...legacy, boundTextLayout: 'measured', boundTextBaselineHeight: NaN })).toBe(190);
  });
  it('manual width-only resize resets baseline, internal measured fit and position do not', () => {
    const box = createShapeElement('rect', { id: 'box', width: 200, height: 190 });
    const label = { ...createBoundLabel(box), id: 'label', boundTextBaselineHeight: 100 };
    const before = { box, label };
    const after = { ...before, box: { ...box, width: 240 } };
    expect(syncDependentsAfterMutation(after, ['box', 'label'], new Set(['box']), before)[0].changes).toMatchObject({ boundTextBaselineHeight: 190 });
    expect(syncDependentsAfterMutation(after, ['box', 'label'], new Set(['box']), before, true)[0].changes).not.toHaveProperty('boundTextBaselineHeight');
    const moved = { ...before, box: { ...box, x: 444 } };
    expect(syncDependentsAfterMutation(moved, ['box', 'label'], new Set(['box']), before)[0].changes).not.toHaveProperty('boundTextBaselineHeight');
  });
  it('semantic key includes raw source/style/binding/policy/width, excludes latest placement', () => {
    const box = createShapeElement('rect'); const label = createBoundLabel(box);
    const key = boundTextMeasurementKey(box, label);
    expect(boundTextMeasurementKey({ ...box, x: 10, y: 20, rotation: 30, height: 999 }, label)).toBe(key);
    expect(boundTextMeasurementKey(box, label, new Set([0]))).not.toBe(key);
    expect(boundTextMeasurementKey(box, { ...label, style: { ...label.style, fontSize: 50 } })).not.toBe(key);
    expect(boundTextMeasurementKey(box, { ...label, containerId: 'other' })).not.toBe(key);
  });
  it('current bound and free policies roundtrip Yjs', () => {
    const p = createPresentation(); const sid = p.slideOrder[0];
    const box = createShapeElement('ellipse'); const label = createBoundLabel(box); const legacy = createTextElement();
    p.slides[sid].elements = { [box.id]: box, [label.id]: label, [legacy.id]: legacy };
    p.slides[sid].elementOrder = [box.id, label.id, legacy.id];
    const doc = jsonToYDoc(p);
    expect(yDocToJson(doc).slides[sid].elements).toEqual(p.slides[sid].elements);
    doc.destroy();
  });
  it('rounded ellipse dimensions share the unrounded usable origin in fit and dependent placement', () => {
    const box = createShapeElement('ellipse', { x: 100, y: 200, width: 200, height: 49 });
    const label = { ...createBoundLabel(box), width: 16.001, height: 25, x: 191.9995, y: 212 };
    const usable = boundTextUsableRect(box);
    expect(usable).toMatchObject({ width: 131, height: 25 });
    expect(usable.x).toBeCloseTo(134.28932188134524, 10);
    expect(usable.y).toBeCloseTo(212.1758838609296, 10);
    const expectedX = usable.x + (131 - label.width) / 2;
    const fit = fitLabelToDoc(box, label, { width: 16, height: 25 });
    expect(fit.label!.x).toBeCloseTo(expectedX, 10);
    expect(fit.label!.y).toBeCloseTo(usable.y, 10);
    expect(boundLabelChangesFor(box, label)).toMatchObject({ x: expectedX, y: usable.y });
    expect(boundLabelChangesFor(box, { ...label, ...fit.label })).toBeNull();
  });

});
