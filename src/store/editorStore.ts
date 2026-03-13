import { create } from 'zustand';
import type { Tool, SlideElement, EditorState } from '../types/presentation';
import { usePresentationStore } from './presentationStore';

export interface MarginLayout {
  id: string;
  name: string;
  left: number;
  right: number;
  top: number;
  bottom: number;
}

interface EditorStore extends EditorState {
  objectDrawerOpen: boolean;
  hoveredObjectId: string | null;
  croppingElementId: string | null;
  marginLayoutId: string | null;
  showMarginGuides: boolean;
  isPresenterMode: boolean;
  presenterStartTime: number;
  textEditClickPosition: { x: number; y: number } | null;
  selectedSlideIds: string[];
  setObjectDrawerOpen: (open: boolean) => void;
  setHoveredObjectId: (id: string | null) => void;
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
  setEditingTextId: (id: string | null, clickPosition?: { x: number; y: number }) => void;
  setIsPanning: (panning: boolean) => void;
  setCroppingElementId: (id: string | null) => void;
  setMarginLayoutId: (id: string | null) => void;
  setShowMarginGuides: (show: boolean) => void;
  setPresenterMode: (mode: boolean) => void;
  resetPresenterTimer: () => void;
  showSlideNumbers: boolean;
  setShowSlideNumbers: (show: boolean) => void;
  setSelectedSlides: (ids: string[]) => void;
  toggleSlideSelection: (slideId: string) => void;
}

export const useEditorStore = create<EditorStore>()((set) => ({
  activeSlideId: '',
  selectedElementIds: [],
  zoom: 1,
  tool: 'select',
  isPresenting: false,
  presentingSlideIndex: 0,
  showGrid: false,
  snapToGrid: true,
  gridSize: 20,
  clipboard: [],
  editingTextId: null,
  isPanning: false,
  objectDrawerOpen: true,
  hoveredObjectId: null,
  croppingElementId: null,
  marginLayoutId: null,
  showMarginGuides: true,
  isPresenterMode: false,
  presenterStartTime: 0,
  textEditClickPosition: null,
  selectedSlideIds: [],
  showSlideNumbers: false,

  setObjectDrawerOpen: (open) => set({ objectDrawerOpen: open }),
  setHoveredObjectId: (id) => set({ hoveredObjectId: id }),
  setActiveSlide: (slideId) => set((s) => {
    const slide = usePresentationStore.getState().presentation.slides[slideId];
    const kept = slide
      ? s.selectedElementIds.filter((id) => id in slide.elements)
      : [];
    // Don't modify selectedSlideIds here - let the caller (SlidePanel) handle it
    // This allows proper multi-select behavior
    return {
      activeSlideId: slideId,
      selectedElementIds: kept,
      editingTextId: null,
    };
  }),
  setSelectedElements: (ids) => set((s) => {
    // Reset slide selection when switching objects or deselecting all
    const hadSelection = s.selectedElementIds.length > 0;
    const changed = hadSelection &&
      (ids.length !== s.selectedElementIds.length || ids.some((id, i) => id !== s.selectedElementIds[i]));
    return {
      selectedElementIds: ids,
      ...(changed && s.selectedSlideIds.length > 1 ? { selectedSlideIds: [s.activeSlideId] } : {}),
    };
  }),
  addToSelection: (id) => set((s) => ({
    selectedElementIds: s.selectedElementIds.includes(id) ? s.selectedElementIds : [...s.selectedElementIds, id]
  })),
  removeFromSelection: (id) => set((s) => ({
    selectedElementIds: s.selectedElementIds.filter((eid) => eid !== id)
  })),
  clearSelection: () => set((s) => ({
    selectedElementIds: [],
    editingTextId: null,
    ...(s.selectedSlideIds.length > 1 ? { selectedSlideIds: [s.activeSlideId] } : {}),
  })),
  setZoom: (zoom) => set({ zoom: Math.max(0.25, Math.min(3, zoom)) }),
  setTool: (tool) => set((s) => ({
    tool,
    // Preserve selection when switching to 'select', clear when switching to drawing tools
    selectedElementIds: tool === 'select' ? s.selectedElementIds : [],
    editingTextId: tool === 'select' ? s.editingTextId : null,
  })),
  setPresenting: (isPresenting) => set({ isPresenting }),
  setPresentingSlideIndex: (index) => set({ presentingSlideIndex: index }),
  setShowGrid: (show) => set({ showGrid: show }),
  setSnapToGrid: (snap) => set({ snapToGrid: snap }),
  setGridSize: (size) => set({ gridSize: size }),
  setClipboard: (elements) => set({ clipboard: elements }),
  setEditingTextId: (id, clickPosition) => set({ editingTextId: id, textEditClickPosition: clickPosition ?? null }),
  setIsPanning: (panning) => set({ isPanning: panning }),
  setCroppingElementId: (id) => set({ croppingElementId: id }),
  setMarginLayoutId: (id) => set({ marginLayoutId: id }),
  setShowMarginGuides: (show) => set({ showMarginGuides: show }),
  setPresenterMode: (mode) => set({ isPresenterMode: mode, presenterStartTime: mode ? Date.now() : 0 }),
  resetPresenterTimer: () => set({ presenterStartTime: Date.now() }),
  setShowSlideNumbers: (show) => set({ showSlideNumbers: show }),
  setSelectedSlides: (ids) => set({ selectedSlideIds: ids }),
  toggleSlideSelection: (slideId) => set((s) => ({
    selectedSlideIds: s.selectedSlideIds.includes(slideId)
      ? s.selectedSlideIds.filter((id) => id !== slideId)
      : [...s.selectedSlideIds, slideId],
  })),
}));
