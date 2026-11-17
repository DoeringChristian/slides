import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { readFileSync } from 'node:fs';
import { ROOT_KEY, elementToYMap, getYSlide, jsonToYDoc, slideToYMap, yDocPatchJson, yDocToJson } from './ySchema';
import type { Presentation, Slide, SlideElement } from '../types/presentation';

const deck = JSON.parse(readFileSync(new URL('../../examples/02-animation-highlights.json', import.meta.url), 'utf8')) as Presentation;

/** Run `change` on the doc and patch the JSON from its events. */
function patched(doc: Y.Doc, prev: Presentation, change: () => void): Presentation {
  const events: Array<Y.YEvent<Y.AbstractType<unknown>>> = [];
  const root = doc.getMap(ROOT_KEY);
  const observe = (e: Array<Y.YEvent<Y.AbstractType<unknown>>>) => events.push(...e);
  root.observeDeep(observe);
  doc.transact(change);
  root.unobserveDeep(observe);
  return yDocPatchJson(doc, prev, events);
}

describe('yDocPatchJson: patch the store JSON with only what changed', () => {
  it('equals a full rebuild after each kind of change, and keeps untouched parts', () => {
    const doc = jsonToYDoc(deck);
    let json = yDocToJson(doc);
    const [s1, s2] = json.slideOrder;
    const el = json.slides[s1].elementOrder[0];
    const elements = () => getYSlide(doc, s1)!.get('elements') as Y.Map<Y.Map<unknown>>;
    const steps: Array<[string, () => void]> = [
      ['move an element', () => elements().get(el)!.set('x', 123)],
      ['add an element', () => elements().set('new', elementToYMap({ ...json.slides[s1].elements[el], id: 'new' }))],
      ['delete it', () => elements().delete('new')],
      ['reorder slides', () => { const order = doc.getMap(ROOT_KEY).get('slideOrder') as Y.Array<string>; order.delete(0, 1); order.push([s1]); }],
      ['retitle', () => (doc.getMap(ROOT_KEY).get('title') as Y.Text).insert(0, 'x')],
      ['set a scalar', () => doc.getMap(ROOT_KEY).set('updatedAt', 42)],
    ];
    for (const [what, change] of steps) {
      const before = json;
      json = patched(doc, before, change);
      expect(json, what).toEqual(yDocToJson(doc));
      if (what !== 'reorder slides' && what !== 'retitle' && what !== 'set a scalar') {
        expect(json.slides[s2], `${what}: other slides keep their identity`).toBe(before.slides[s2]);
        expect(json.resources, `${what}: resources keep their identity`).toBe(before.resources);
      }
      if (what === 'move an element') {
        const other = json.slides[s1].elementOrder.find(id => id !== el)!;
        expect(json.slides[s1].elements[other], 'other elements keep their identity').toBe(before.slides[s1].elements[other]);
      }
    }
  });
});

describe('yDocPatchJson under bursts of transactions', () => {
  it('matches a full rebuild when several transactions land before one patch', () => {
    const doc = jsonToYDoc(deck);
    let json = yDocToJson(doc);
    const root = doc.getMap(ROOT_KEY);
    let events: Array<Y.YEvent<Y.AbstractType<unknown>>> = [];
    root.observeDeep(e => { events.push(...e); });
    let seed = 7;
    const rnd = (n: number) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };
    const slides = () => root.get('slides') as Y.Map<Y.Map<unknown>>;
    for (let round = 0; round < 300; round++) {
      for (let k = 0, n = 1 + rnd(4); k < n; k++) doc.transact(() => {
        const ids = [...slides().keys()];
        const slide = slides().get(ids[rnd(ids.length)])!;
        const els = slide.get('elements') as Y.Map<Y.Map<unknown>>;
        const elIds = [...els.keys()];
        if (!elIds.length) return;
        const id = elIds[rnd(elIds.length)];
        switch (rnd(4)) {
          case 0: els.get(id)!.set('x', rnd(1000)); break;
          case 1: { const copy = els.get(id)!.toJSON() as SlideElement; els.delete(id); els.set(id, elementToYMap({ ...copy, x: rnd(1000) })); break; }
          case 2: { const copy = els.get(id)!.toJSON() as SlideElement; els.set(`${id}-c${round}`, elementToYMap({ ...copy, id: `${id}-c${round}` })); break; }
          case 3: { const yslide = slide; const copy = yslide.toJSON() as Slide; slides().set(copy.id, slideToYMap(copy)); break; }
        }
      });
      json = yDocPatchJson(doc, json, events); events = [];
      expect(json).toEqual(yDocToJson(doc));
    }
  });
});
