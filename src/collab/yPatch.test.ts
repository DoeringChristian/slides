import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { readFileSync } from 'node:fs';
import { ROOT_KEY, elementToYMap, getYSlide, jsonToYDoc, yDocPatchJson, yDocToJson } from './ySchema';
import type { Presentation } from '../types/presentation';

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
