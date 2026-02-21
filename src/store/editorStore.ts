import { create } from 'zustand';
import type { Tool, SlideElement, EditorState } from '../types/presentation';

interface EditorStore extends EditorState {
  setActiveSlide: (slideId: string) => void;
  setSelectedElements: (ids: string[]) => void;
  addToSelection: (id: string) => void;
  removeFromSelection: (id: string) => void;
  clearSelection: () => void;
  setZoom: (zoom: number) => void;
  setTool: (tool: Tool) => void;
  setPresenting: (isPresenting: boolean) => void;
  setPresentingSlideIndex: (index: number) => void;
  setShowGrid: (show: boolean) => void;
  setSnapToGrid: (snap: boolean) => void;
  setGridSize: (size: number) => void;
  setClipboard: (elements: SlideElement[]) => void;
  setEditingTextId: (id: string | null) => void;
  setIsPanning: (panning: boolean) => void;
}

export const useEditorStore = create<EditorStore>()((set) => ({
  activeSlideId: '',
  selectedElementIds: [],
  zoom: 1,
  tool: 'select',
  isPresenting: false,
  presentingSlideIndex: 0,
  showGrid: false,
  snapToGrid: false,
  gridSize: 20,
  clipboard: [],
  editingTextId: null,
  isPanning: false,

  setActiveSlide: (slideId) => set({ activeSlideId: slideId, selectedElementIds: [], editingTextId: null }),
  setSelectedElements: (ids) => set({ selectedElementIds: ids }),
  addToSelection: (id) => set((s) => ({
    selectedElementIds: s.selectedElementIds.includes(id) ? s.selectedElementIds : [...s.selectedElementIds, id]
  })),
  removeFromSelection: (id) => set((s) => ({
    selectedElementIds: s.selectedElementIds.filter((eid) => eid !== id)
  })),
  clearSelection: () => set({ selectedElementIds: [], editingTextId: null }),
  setZoom: (zoom) => set({ zoom: Math.max(0.25, Math.min(3, zoom)) }),
  setTool: (tool) => set({ tool, selectedElementIds: [], editingTextId: null }),
  setPresenting: (isPresenting) => set({ isPresenting }),
  setPresentingSlideIndex: (index) => set({ presentingSlideIndex: index }),
  setShowGrid: (show) => set({ showGrid: show }),
  setSnapToGrid: (snap) => set({ snapToGrid: snap }),
  setGridSize: (size) => set({ gridSize: size }),
  setClipboard: (elements) => set({ clipboard: elements }),
  setEditingTextId: (id) => set({ editingTextId: id }),
  setIsPanning: (panning) => set({ isPanning: panning }),
}));
