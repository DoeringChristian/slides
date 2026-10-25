import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { Presentation } from '../types/presentation';
import type { ProjectMeta } from '../types/vault';
import { createPresentation, createTextElement } from '../utils/slideFactory';
import { loadProject, saveProject } from '../utils/projectFiles';
import { usePresentationStore } from './presentationStore';
import { getActiveDoc, setActiveDoc } from '../collab/yDocAdapter';
import { jsonToYDoc } from '../collab/ySchema';
vi.stubGlobal('window', {});
const client = vi.hoisted(() => ({ saveProject: vi.fn(), getProject: vi.fn() }));
vi.mock('../utils/storageClient', () => ({ getStorageClient: () => client }));
const { useVaultStore } = await import('./vaultStore');

// In-memory FileSystemHandle fake, NOT a browser permission/picker test.
function folder() {
  const files = new Map<string, string>();
  const dirs = new Set<string>();
  const handle = {
    async *values() { for (const name of [...files.keys(), ...dirs]) yield { name }; },
    async getFileHandle(name: string, options?: { create?: boolean }) {
      if (!files.has(name) && !options?.create) throw new Error('NotFoundError');
      return {
        getFile: async () => ({ text: async () => files.get(name)! }),
        createWritable: async () => ({ write: async (text: string) => { files.set(name, text); }, close: async () => {} }),
      };
    },
  } as unknown as FileSystemDirectoryHandle;
  return { handle, files, dirs };
}
function deck() {
  const p = createPresentation(); p.title = 'Same title';
  const el = createTextElement({ id: 'same-keyframe-id', text: '$$x$$' });
  const sid = p.slideOrder[0]; p.slides[sid].elements[el.id] = el; p.slides[sid].elementOrder.push(el.id);
  p.objects[el.id] = { id: el.id, name: 'Text', type: 'text' };
  return p;
}
const meta = (p: Presentation): ProjectMeta => ({ id: p.id, title: p.title, filename: '', createdAt: p.createdAt, updatedAt: p.updatedAt });
beforeEach(() => {
  vi.clearAllMocks();
  useVaultStore.setState({ storageMode: 'local', vaultHandle: null, projects: [], activeProjectId: 'prior', currentFilename: 'prior.json', isLoading: false, error: null });
});
afterEach(() => { setActiveDoc(null); });
it('reproduces old folder import: saving elsewhere then opening same ID loads old empty folder snapshot', async () => {
  const f = folder(), source = deck(), empty = { ...source, slides: {}, slideOrder: [] };
  await saveProject(f.handle, empty);
  // Original dialog saved the populated source via getStorageClient, not f.handle.
  const elsewhere = new Map([[source.id, source]]);
  expect(elsewhere.get(source.id)!.slideOrder).toHaveLength(1);
  expect((await loadProject(f.handle, 'same-title.json')).slideOrder).toHaveLength(0);
});
for (const storageMode of ['local', 'server', 'filesystem'] as const) {
  it(`${storageMode}: saves new identity before controlled activation; retains native content`, async () => {
    const source = deck(), prior = createPresentation();
    usePresentationStore.setState({ presentation: prior }); const doc = jsonToYDoc(prior); setActiveDoc(doc);
    const f = folder();
    f.files.set('same-title.json', JSON.stringify({ ...source, slides: {}, slideOrder: [] }));
    f.dirs.add('same-title-2.json');
    useVaultStore.setState({ storageMode, vaultHandle: storageMode === 'filesystem' ? f.handle : null });
    let saved: Presentation;
    client.saveProject.mockImplementation(async (p: Presentation) => {
      expect(usePresentationStore.getState().presentation).toBe(prior);
      expect(getActiveDoc()).toBe(doc); expect(useVaultStore.getState().activeProjectId).toBe('prior');
      saved = p; return meta(p);
    });
    client.getProject.mockImplementation(async () => ({ presentation: saved }));
    await useVaultStore.getState().importProject(source);
    const active = usePresentationStore.getState().presentation;
    expect(active.id).not.toBe(source.id); expect(active).toEqual({ ...source, id: active.id });
    expect(useVaultStore.getState().activeProjectId).toBe(active.id); expect(getActiveDoc()).toBeNull();
    if (storageMode === 'filesystem') {
      expect(client.saveProject).not.toHaveBeenCalled();
      expect(useVaultStore.getState().currentFilename).toBe('same-title-3.json');
      expect(JSON.parse(f.files.get('same-title.json')!).slideOrder).toEqual([]);
    }
  });
}
for (const storageMode of ['local', 'server', 'filesystem'] as const) {
  it(`${storageMode}: save failure preserves current project, store and doc`, async () => {
    const prior = createPresentation(), doc = jsonToYDoc(prior); setActiveDoc(doc);
    usePresentationStore.setState({ presentation: prior });
    useVaultStore.setState({ storageMode, vaultHandle: { values: () => { throw Error('permission denied'); } } as unknown as FileSystemDirectoryHandle });
    client.saveProject.mockRejectedValue(new Error('quota/network failure'));
    await expect(useVaultStore.getState().importProject(deck())).rejects.toThrow();
    expect(usePresentationStore.getState().presentation).toBe(prior); expect(getActiveDoc()).toBe(doc);
    expect(useVaultStore.getState().activeProjectId).toBe('prior'); expect(useVaultStore.getState().currentFilename).toBe('prior.json');
    expect(client.getProject).not.toHaveBeenCalled();
  });
}
it('existing unused-resource cleanup is unchanged by import, not a new import transformation', async () => {
  const source = deck(); source.resources.unused = { id: 'unused', name: 'Unused', type: 'image', src: 'data:image/png;base64,AA==', originalWidth: 1, originalHeight: 1 };
  usePresentationStore.getState().loadPresentation(source);
  const expected = usePresentationStore.getState().presentation;
  let saved: Presentation;
  client.saveProject.mockImplementation(async (p: Presentation) => { saved = p; return meta(p); });
  client.getProject.mockImplementation(async () => ({ presentation: saved }));
  await useVaultStore.getState().importProject(source);
  expect(saved!.resources.unused).toEqual(source.resources.unused);
  const actual = usePresentationStore.getState().presentation;
  expect(actual).toEqual({ ...expected, id: actual.id }); expect(actual.resources.unused).toBeUndefined();
});
it('saved import read failure leaves prior activation and doc unchanged', async () => {
  const source = deck(), prior = createPresentation(), doc = jsonToYDoc(prior); setActiveDoc(doc);
  usePresentationStore.setState({ presentation: prior });
  client.saveProject.mockImplementation(async (p: Presentation) => meta(p));
  client.getProject.mockRejectedValue(Error('read unavailable'));
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  await expect(useVaultStore.getState().importProject(source)).rejects.toThrow('Failed to open project');
  expect(usePresentationStore.getState().presentation).toBe(prior); expect(getActiveDoc()).toBe(doc);
  expect(useVaultStore.getState().activeProjectId).toBe('prior'); log.mockRestore();
});
