import { afterEach, expect, it, vi } from 'vitest';
import { saveProjectToIDB } from './vaultStorage';
import { createPresentation } from './slideFactory';
afterEach(() => vi.unstubAllGlobals());
function database() {
  const request = { error: null as Error | null, onerror: undefined as undefined | (() => void), onsuccess: undefined as undefined | (() => void) };
  const transaction = { error: null as Error | null, oncomplete: undefined as undefined | (() => void), onabort: undefined as undefined | (() => void), onerror: undefined as undefined | (() => void), objectStore: () => ({ put: vi.fn(() => request) }) };
  const db = { close: vi.fn(), transaction: vi.fn(() => transaction) };
  vi.stubGlobal('indexedDB', { open: () => { const open = { result: db, onsuccess: undefined as undefined | (() => void) }; queueMicrotask(() => open.onsuccess?.()); return open; } });
  return { db, transaction, request };
}
it('does not activate after put success; waits for commit, exactly once', async () => {
  const f = database(), activate = vi.fn(); const presentation = createPresentation();
  const saving = saveProjectToIDB({ id: presentation.id, presentation }).then(activate);
  await Promise.resolve(); await Promise.resolve(); f.request.onsuccess?.(); await Promise.resolve();
  expect(activate).not.toHaveBeenCalled(); expect(f.db.close).not.toHaveBeenCalled();
  f.transaction.oncomplete?.(); await saving; f.transaction.oncomplete?.();
  expect(activate).toHaveBeenCalledTimes(1); expect(f.db.close).toHaveBeenCalledTimes(1);
});
it('put success followed by abort rejects without activating or replacing prior state', async () => {
  const f = database(), prior = createPresentation(), imported = createPresentation(); let current = prior;
  const saving = saveProjectToIDB({ id: imported.id, presentation: imported }).then(() => { current = imported; });
  const rejected = expect(saving).rejects.toThrow('aborted');
  await Promise.resolve(); await Promise.resolve(); f.request.onsuccess?.(); f.transaction.onabort?.(); await rejected;
  expect(current).toBe(prior); expect(f.db.close).toHaveBeenCalledTimes(1);
});
it('preserves request errors and settles/closes only once across bubbled transaction events', async () => {
  const f = database(), presentation = createPresentation();
  const saving = saveProjectToIDB({ id: presentation.id, presentation }); const rejected = expect(saving).rejects.toThrow('quota');
  await Promise.resolve(); await Promise.resolve(); f.request.error = Error('quota'); f.request.onerror?.(); f.transaction.onerror?.(); f.transaction.onabort?.(); await rejected;
  expect(f.db.close).toHaveBeenCalledTimes(1);
});
it('closes on synchronous transaction setup failure', async () => {
  const f = database(), presentation = createPresentation(); f.db.transaction.mockImplementation(() => { throw Error('closed'); });
  await expect(saveProjectToIDB({ id: presentation.id, presentation })).rejects.toThrow('closed'); expect(f.db.close).toHaveBeenCalledTimes(1);
});
