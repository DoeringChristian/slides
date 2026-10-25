import { afterEach, expect, it, vi } from 'vitest';
const effects = vi.hoisted(() => ({ cleanup: undefined as undefined | (() => void) }));
vi.mock('react', async (original) => ({ ...await original<typeof import('react')>(), useEffect: (fn: () => (() => void) | undefined) => { effects.cleanup = fn(); } }));
import { useYToStoreSync } from './yToStoreSync';
import { jsonToYDoc } from './ySchema';
import { setActiveDoc } from './yDocAdapter';
import { usePresentationStore } from '../store/presentationStore';
import { createPresentation } from '../utils/slideFactory';
afterEach(() => { effects.cleanup?.(); setActiveDoc(null); });
it('does not apply a queued pull after effect cleanup', async () => {
  const old = jsonToYDoc(createPresentation()); setActiveDoc(old);
  useYToStoreSync(old); effects.cleanup?.();
  const next = createPresentation(); usePresentationStore.setState({ presentation: next });
  await Promise.resolve();
  expect(usePresentationStore.getState().presentation).toBe(next);
});
it('does not apply a queued pull after active document ownership changes', async () => {
  const old = jsonToYDoc(createPresentation()); setActiveDoc(old); useYToStoreSync(old);
  const next = createPresentation(); setActiveDoc(jsonToYDoc(next));
  usePresentationStore.setState({ presentation: next });
  await Promise.resolve();
  expect(usePresentationStore.getState().presentation).toBe(next);
});
it('still mirrors an owned live document after coalesced updates', async () => {
  const p = createPresentation(), doc = jsonToYDoc(p); setActiveDoc(doc); useYToStoreSync(doc);
  await Promise.resolve(); expect(usePresentationStore.getState().presentation).toEqual(p);
});
