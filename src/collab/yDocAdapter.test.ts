import { afterEach, expect, it } from 'vitest';
import { Doc } from 'yjs';
import { getActiveDoc, setActiveDoc, subscribeActiveDocChange } from './yDocAdapter';

afterEach(() => setActiveDoc(null));

it('identity changes notify synchronously after publication, including away/back and null; same doc and disposed listeners do not', () => {
  const a = new Doc(), b = new Doc();
  setActiveDoc(a);
  const seen: Array<Doc | null> = [];
  let gestureValid = true;
  const unsubscribe = subscribeActiveDocChange(() => {
    seen.push(getActiveDoc());
    if (getActiveDoc() !== a) gestureValid = false;
  });
  setActiveDoc(a);
  expect(seen).toEqual([]);
  setActiveDoc(b); setActiveDoc(a);
  expect(seen).toEqual([b, a]);
  expect(gestureValid).toBe(false);
  setActiveDoc(null); setActiveDoc(null);
  expect(seen).toEqual([b, a, null]);
  unsubscribe(); setActiveDoc(a);
  expect(seen).toEqual([b, a, null]);
  a.destroy(); b.destroy();
});
