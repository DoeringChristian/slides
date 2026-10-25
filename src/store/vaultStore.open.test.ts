import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Presentation } from '../types/presentation';
import { createUndoManagerFor } from '../collab/activeUndo';
import { getActiveDoc, setActiveDoc } from '../collab/yDocAdapter';
import { jsonToYDoc, yDocToJson } from '../collab/ySchema';
import { createPresentation, createShapeElement } from '../utils/slideFactory';
import { usePresentationStore as store } from './presentationStore';
import { useEditorStore as editor } from './editorStore';

const mocks = vi.hoisted(() => ({ getProject: vi.fn(), loadProject: vi.fn(), getJoinedProject: vi.fn(), updateJoinedProjectMeta: vi.fn() }));
vi.mock('../utils/storageClient', () => ({ getStorageClient: () => ({ getProject: mocks.getProject }) }));
vi.mock('../utils/projectFiles', () => ({ loadProject: mocks.loadProject }));
vi.mock('./joinedStore', () => ({ getJoinedProject: mocks.getJoinedProject, updateJoinedProjectMeta: mocks.updateJoinedProjectMeta }));
vi.mock('../utils/keyboard', () => ({ isShiftHeld: () => false, isCtrlHeld: () => false }));
vi.stubGlobal('window', {});
const { useVaultStore: vault } = await import('./vaultStore');

function deck() {
  const p = createPresentation(), sid = p.slideOrder[0];
  const box = createShapeElement('rect', { id: 'box', x: 120 });
  p.slides[sid].elements = { box }; p.slides[sid].elementOrder = ['box'];
  p.objects.box = { id: 'box', name: 'Box', type: 'shape' };
  return p;
}
const meta = (p: Presentation) => ({ id: p.id, title: p.title, filename: `${p.id}.json`, createdAt: p.createdAt, updatedAt: p.updatedAt });

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Unexpected real network access'); }));
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vault.setState({ vaultHandle: null, projects: [], activeProjectId: null, isLoading: false, error: null, currentFilename: null, saveDebounceTimer: null });
});
afterEach(() => { setActiveDoc(null); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe.each(['local', 'server', 'filesystem'] as const)('openProject %s rejection', storageMode => {
  it.each(['missing binding target', 'missing group child', 'read failure'])('%s preserves current project, document and working collaborative undo', failure => {
    return runRejectedOpen(storageMode, failure);
  });
});

async function runRejectedOpen(storageMode: 'local' | 'server' | 'filesystem', failure: string) {
  const initial = deck(), sid = initial.slideOrder[0], incoming = deck();
  if (failure === 'missing binding target') {
    const arrow = createShapeElement('path', { id: 'arrow', points: [0, 0, 100, 100], endBinding: { elementId: 'missing', mode: 'aim', fixedPoint: [.5, .5] } });
    incoming.slides[incoming.slideOrder[0]].elements.arrow = arrow;
    incoming.slides[incoming.slideOrder[0]].elementOrder.push('arrow');
  } else if (failure === 'missing group child') {
    incoming.slides[incoming.slideOrder[0]].elements.group = { id: 'group', type: 'group', childIds: ['missing'], x: 0, y: 0, width: 100, height: 100, rotation: 0, opacity: 1, locked: false, visible: true };
    incoming.slides[incoming.slideOrder[0]].elementOrder.push('group');
  }
  const doc = jsonToYDoc(initial); setActiveDoc(doc);
  const undo = createUndoManagerFor(doc);
  try {
    store.setState({ presentation: initial });
    editor.setState({ activeSlideId: sid, selectedSlideIds: [], selectedElementIds: ['box'] });
    store.getState().updateTitle('Unsaved collaborative title');
    undo.stopCapturing();
    const before = yDocToJson(doc);
    store.setState({ presentation: before });
    store.temporal.getState().clear();
    vault.setState({ storageMode, vaultHandle: storageMode === 'filesystem' ? {} as FileSystemDirectoryHandle : null, projects: [meta(initial), meta(incoming)], activeProjectId: initial.id, currentFilename: `${initial.id}.json` });
    if (failure === 'read failure') {
      mocks.getProject.mockRejectedValue(Error('network unavailable'));
      mocks.loadProject.mockRejectedValue(Error('file unavailable'));
    } else {
      mocks.getProject.mockResolvedValue({ presentation: incoming });
      mocks.loadProject.mockResolvedValue(incoming);
    }
    await vault.getState().openProject(incoming.id);
    expect(vault.getState().error).toBe('Failed to open project');
    expect(vault.getState().isLoading).toBe(false);
    expect(vault.getState().activeProjectId).toBe(initial.id);
    expect(vault.getState().currentFilename).toBe(`${initial.id}.json`);
    expect(store.getState().presentation).toBe(before);
    expect(editor.getState().activeSlideId).toBe(sid);
    expect(editor.getState().selectedElementIds).toEqual(['box']);
    expect(getActiveDoc()).toBe(doc);
    expect(yDocToJson(doc)).toEqual(before);
    expect(undo.undoStack).toHaveLength(1);
    expect(store.temporal.getState().pastStates).toHaveLength(0);
    if (storageMode === 'filesystem') {
      expect(mocks.loadProject).toHaveBeenCalledWith(vault.getState().vaultHandle, `${incoming.id}.json`);
      expect(mocks.getProject).not.toHaveBeenCalled();
    } else expect(mocks.getProject).toHaveBeenCalledWith(incoming.id, undefined);
    expect(fetch).not.toHaveBeenCalled();

    // A real store mutation must still write Yjs, not silently fall back to
    // JSON. Both the new mutation and the pre-existing history remain usable.
    store.getState().updateElement(sid, 'box', { x: 275 });
    const edited = yDocToJson(doc);
    expect(edited.slides[sid].elements.box.x).toBe(275);
    expect(undo.undoStack).toHaveLength(2);
    expect(store.temporal.getState().pastStates).toHaveLength(0);
    undo.undo(); expect(yDocToJson(doc)).toEqual(before);
    undo.redo(); expect(yDocToJson(doc)).toEqual(edited);
    undo.undo(); undo.undo(); expect(yDocToJson(doc)).toEqual(initial);
  } finally { undo.destroy(); setActiveDoc(null); doc.destroy(); }
}

it('valid current-format open still detaches the old document and activates the loaded project', async () => {
  const prior = deck(), incoming = deck(), doc = jsonToYDoc(prior);
  setActiveDoc(doc); store.setState({ presentation: prior });
  vault.setState({ storageMode: 'server', activeProjectId: prior.id, projects: [meta(incoming)] });
  mocks.getProject.mockResolvedValue({ presentation: incoming });
  try {
    await vault.getState().openProject(incoming.id);
    expect(vault.getState().error).toBeNull();
    expect(vault.getState().activeProjectId).toBe(incoming.id);
    expect(getActiveDoc()).toBeNull();
    expect(store.getState().presentation).toEqual(incoming);
    expect(editor.getState().activeSlideId).toBe(incoming.slideOrder[0]);
  } finally { setActiveDoc(null); doc.destroy(); }
});
