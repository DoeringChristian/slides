import { describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { createPresentation, createShapeElement, createTextElement } from './slideFactory';
import { upgradeNativePresentation } from './legacyPresentation';
import { importPresentationFile } from '../io/importPresentation';
import { jsonToYDoc, yDocToJson, restoreStoredYProject, ROOT_KEY } from '../../collab/ySchema';
import type { Presentation } from '../../types/presentation';

function legacy() {
  const p = createPresentation(), sid = p.slideOrder[0];
  const box = createShapeElement('rect', { id: 'box', x: 90, y: 80, rotation: 20 });
  const text = createTextElement({ id: 'text', text: 'Keep this text', width: 160, height: 85 });
  const arrow = createShapeElement('path', { id: 'arrow', points: [0,0,100,40], rotation: 12 });
  const oldBox = { ...box, creationPreset: undefined };
  const oldText = { ...text, textSizing: undefined, boundTextLayout: undefined };
  const oldArrow = { ...arrow, shapeType: 'arrow', creationPreset: undefined, endHead: undefined, endArrow: true,
    startBinding: { elementId: 'box', anchor: 'left' } };
  p.slides[sid].elements = { box: oldBox, text: oldText, arrow: oldArrow } as unknown as typeof p.slides[string]['elements'];
  p.slides[sid].elementOrder = ['box', 'text', 'arrow'];
  p.slides.other = { ...structuredClone(p.slides[sid]), id: 'other' };
  Object.assign(p.slides[sid], { autoAdvance: true });
  p.templates.tpl = { id: 'tpl', name: 'Old template', background: p.slides[sid].background, elements: { text: oldText } as unknown as typeof p.slides[string]['elements'], elementOrder: ['text'] };
  delete (p as Partial<Presentation>).updatedAt;
  return p;
}

it('upgrades JSON imports without mutating source, identities, geometry or resources', async () => {
  const p = legacy(), before = structuredClone(p), sid = p.slideOrder[0];
  const result = await importPresentationFile({ name: 'old.json', text: async () => JSON.stringify(p) } as File);
  expect(p).toEqual(before);
  expect(result.slideOrder).toEqual([sid, 'other']);
  expect(result.slides[sid].groupId).toBe(result.slides.other.groupId);
  expect(result.slides[sid]).not.toHaveProperty('autoAdvance');
  expect(result.templates.tpl.elements.text).toMatchObject({ textSizing: 'user-width', boundTextLayout: 'padded' });
  expect(result.slides[sid].elements.arrow).toMatchObject({ shapeType: 'path', creationPreset: 'arrow', endHead: 'triangle',
    startBinding: { elementId: 'box', mode: 'pinned', fixedPoint: [0,.5] } });
  for (const id of ['box','text','arrow']) for (const key of ['id','x','y','width','height','rotation','opacity'] as const) {
    expect(result.slides[sid].elements[id][key]).toEqual(before.slides[sid].elements[id][key]);
  }
  expect(result.resources).toEqual(before.resources);
  expect(upgradeNativePresentation(result)).toBe(result);
  const doc = jsonToYDoc(result); expect(yDocToJson(doc)).toEqual(result); doc.destroy();
});

it('repairs persisted Y data in place and persists the repair over sync', () => {
  const p = legacy();
  const doc = jsonToYDoc(upgradeNativePresentation(p));
  const root = doc.getMap(ROOT_KEY);
  const order = root.get('slideOrder') as Y.Array<string>;
  order.delete(1,1); root.delete('updatedAt');
  const slides = root.get('slides') as Y.Map<Y.Map<unknown>>;
  const elements = slides.get(p.slideOrder[0])!.get('elements') as Y.Map<Y.Map<unknown>>;
  const text = elements.get('text')!;
  text.delete('textSizing'); text.delete('boundTextLayout');
  expect(restoreStoredYProject(doc)).toBe(true);
  expect(elements.get('text')).toBe(text);
  expect(restoreStoredYProject(doc)).toBe(false);
  const remote = new Y.Doc(); Y.applyUpdate(remote, Y.encodeStateAsUpdate(doc));
  expect(yDocToJson(remote)).toEqual(yDocToJson(doc));
  expect(yDocToJson(remote).slideOrder).toHaveLength(2);
  remote.destroy(); doc.destroy();
});

it('still rejects broken references instead of dropping content', () => {
  const p = legacy();
  Object.assign(p.slides[p.slideOrder[0]].elements.arrow, { startBinding: { elementId: 'missing', anchor: 'top' } });
  expect(() => upgradeNativePresentation(p)).toThrow('references missing element');
});

describe('jsonEqual', () => {
  it('agrees with comparing JSON text, ignoring key order', async () => {
    const { jsonEqual } = await import('./legacyPresentation');
    expect(jsonEqual({ a: 1, b: [1, { c: 'x' }] }, { b: [1, { c: 'x' }], a: 1 })).toBe(true);
    expect(jsonEqual({ a: 1, u: undefined }, { a: 1 })).toBe(true);
    expect(jsonEqual([undefined, NaN], [null, null])).toBe(true);
    expect(jsonEqual({ a: 1 }, { a: '1' })).toBe(false);
    expect(jsonEqual({ a: [1, 2] }, { a: [1, 2, 3] })).toBe(false);
    expect(jsonEqual({ a: {} }, { a: [] })).toBe(false);
    expect(jsonEqual({ a: null }, { a: {} })).toBe(false);
  });

  it('upgrading a deck never stringifies the whole deck (large media would not fit one string)', async () => {
    const { upgradeNativePresentation } = await import('./legacyPresentation');
    const { createPresentation } = await import('./slideFactory');
    const deck = createPresentation();
    const spy = vi.spyOn(JSON, 'stringify');
    try {
      expect(upgradeNativePresentation(deck)).toBe(deck);
      expect(spy.mock.calls.some(([v]) => v === deck || (v as { slides?: unknown })?.slides === deck.slides)).toBe(false);
    } finally { spy.mockRestore(); }
  });
});
