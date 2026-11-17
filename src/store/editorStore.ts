import { getActiveDoc } from '../collab/yDocAdapter';
import { yDocToJsonSlideOnly } from '../collab/ySchema';
import { create } from 'zustand';
import type {
  Tool, SlideElement, EditorState,
  EasingType, TransitionGroup, TransitionOptions,
} from '../types/presentation';
import { usePresentationStore } from './presentationStore';
import { expandObjectGroups, objectGroupRoot } from '../utils/model/objectGroups';
import { cropGroupOf } from '../utils/model/groupCrop';

export interface MarginLayout {
  id: string;
  name: string;
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export type StandaloneMode = 'off' | 'editor' | 'viewer';

interface EditorStore extends EditorState {
  activeObjectGroupId: string | null;
  hoverPreviewHidden: boolean;
  enterObjectGroup: (id: string, groupId?: string) => boolean;
  exitObjectGroup: () => void;
  standaloneMode: StandaloneMode;
  standaloneEditorOrigin: string | null;
  setStandaloneMode: (mode: StandaloneMode, editorOrigin: string | null) => void;
  hoveredObjectId: string | null;
  /** The image in crop mode: its crop shapes are drawn and edited while the
   *  rest of the slide is dimmed (see enterCropMode). */
  croppingElementId: string | null;
  /** The entered group to return to when crop mode ends. */
  cropReturnScope: string | null;
  marginLayoutId: string | null;
  showMarginGuides: boolean;
  isPresenterMode: boolean;
  presenterStartTime: number;
  textEditClickPosition: { x: number; y: number } | null;
  selectedSlideIds: string[];
  /** When on, each element-level edit duplicates the current slide and
   *  applies the change to the duplicate — so each change becomes its own
   *  keyframe. See utils/autoDraw.ts for the per-mutation hook and the
   *  short debounce window that groups bursts of micro-edits. */
  autoDrawMode: boolean;
  setAutoDrawMode: (on: boolean) => void;
  /** Last easing the user picked for each property group, scoped by
   *  element type. New elements inherit these as their default
   *  transitions if the picked easing is applicable (a `create`
   *  visibility wouldn't follow to a freshly-added text element, for
   *  example — the helper that applies the defaults filters on
   *  `visibilityTypesFor`). The sub-options for the picked easing
   *  travel alongside. */
  lastEasings: Partial<Record<SlideElement['type'], Partial<Record<TransitionGroup, EasingType>>>>;
  lastEasingOptions: Partial<Record<SlideElement['type'], { visibility?: TransitionOptions; content?: TransitionOptions }>>;
  rememberEasing: (
    elementType: SlideElement['type'],
    group: TransitionGroup,
    easing: EasingType,
    options?: TransitionOptions,
  ) => void;
  setHoveredObjectId: (id: string | null, source?: 'canvas' | 'object-list') => void;
  setActiveSlide: (slideId: string) => void;
  setSelectedElements: (ids: string[]) => void;
  addToSelection: (id: string) => void;
  removeFromSelection: (id: string) => void;
  clearSelection: () => void;
  setZoom: (zoom: number) => void;
  setTool: (tool: Tool) => void;
  pathExtension: { elementId: string; end: 'start' | 'end' } | null;
  beginPathExtension: (elementId: string, end: 'start' | 'end') => void;
  setPresenting: (isPresenting: boolean) => void;
  setPresentingSlideIndex: (index: number) => void;
  setShowGrid: (show: boolean) => void;
  setSnapToGrid: (snap: boolean) => void;
  setGridSize: (size: number) => void;
  setClipboard: (elements: SlideElement[]) => void;
  setEditingTextId: (id: string | null, clickPosition?: { x: number; y: number }) => void;
  setIsPanning: (panning: boolean) => void;
  /** Crop mode for one image. Its crop group (if any) becomes the entered
   *  group, so its members alone are selectable; with no crop yet the scope
   *  is the image's own parent group, so clicking it selects only it. */
  enterCropMode: (imageId: string) => void;
  /** End crop mode: dissolve a crop left without shapes, return to the
   *  previous group scope and select the cropped image's group. */
  exitCropMode: () => void;
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
  activeObjectGroupId: null,
  selectedElementIds: [],
  zoom: 1,
  tool: 'select',
  pathExtension: null,
  isPresenting: false,
  presentingSlideIndex: 0,
  showGrid: false,
  snapToGrid: true,
  gridSize: 20,
  clipboard: [],
  hoverPreviewHidden: false,
  editingTextId: null,
  isPanning: false,
  hoveredObjectId: null,
  croppingElementId: null,
  cropReturnScope: null,
  marginLayoutId: null,
  showMarginGuides: true,
  isPresenterMode: false,
  presenterStartTime: 0,
  textEditClickPosition: null,
  selectedSlideIds: [],
  showSlideNumbers: false,
  standaloneMode: 'off',
  standaloneEditorOrigin: null,
  autoDrawMode: false,
  lastEasings: {},
  lastEasingOptions: {},

  enterObjectGroup: (id, groupId) => {
    const state = useEditorStore.getState();
    const doc = getActiveDoc();
    const slide = doc ? yDocToJsonSlideOnly(doc, state.activeSlideId) : usePresentationStore.getState().presentation.slides[state.activeSlideId];
    const el = slide?.elements[id];
    const group = groupId ? (el?.objectGroupIds?.includes(groupId) ? groupId : undefined) : objectGroupRoot(el, state.activeObjectGroupId);
    if (!group || !slide) return false;
    set({ activeObjectGroupId: group, selectedElementIds: expandObjectGroups(slide.elements, [id], group), editingTextId: null });
    return true;
  },
  exitObjectGroup: () => set(s => {
    const elements = usePresentationStore.getState().presentation.slides[s.activeSlideId]?.elements ?? {};
    const member = Object.values(elements).find(el => el.objectGroupIds?.includes(s.activeObjectGroupId ?? ''));
    const path = member?.objectGroupIds ?? [];
    const parent = path[path.indexOf(s.activeObjectGroupId ?? '') - 1] ?? null;
    return { activeObjectGroupId: parent, editingTextId: null,
      selectedElementIds: member ? expandObjectGroups(elements, [member.id], parent) : [] };
  }),
  setAutoDrawMode: (on) => set({ autoDrawMode: on }),
  rememberEasing: (elementType, group, easing, options) => set((s) => {
    const byType = { ...s.lastEasings };
    byType[elementType] = { ...(byType[elementType] || {}), [group]: easing };
    let nextOptions = s.lastEasingOptions;
    if (options !== undefined && (group === 'visibility' || group === 'content')) {
      nextOptions = { ...s.lastEasingOptions };
      const slot = { ...(nextOptions[elementType] || {}) };
      slot[group] = options;
      nextOptions[elementType] = slot;
    }
    return { lastEasings: byType, lastEasingOptions: nextOptions };
  }),
  setStandaloneMode: (mode, editorOrigin) => set({ standaloneMode: mode, standaloneEditorOrigin: editorOrigin }),
  setHoveredObjectId: (id, source = 'canvas') => set(s => {
    const doc = getActiveDoc();
    const slide = doc ? yDocToJsonSlideOnly(doc, s.activeSlideId) : usePresentationStore.getState().presentation.slides[s.activeSlideId];
    return {hoveredObjectId: id, hoverPreviewHidden: !!id && source === 'object-list' && !slide?.elements[id]?.visible};
  }),
  setActiveSlide: (slideId) => set((s) => {
    // A collab add/duplicate returns BEFORE the microtask Y→Zustand sync.
    // Read the authoritative new keyframe, not the stale UI snapshot.
    const doc = getActiveDoc();
    const slide = doc ? yDocToJsonSlideOnly(doc, slideId)
      : usePresentationStore.getState().presentation.slides[slideId];
    const kept = slide
      ? s.selectedElementIds.filter((id) => id in slide.elements)
      : [];
    // Don't modify selectedSlideIds here - let the caller (SlidePanel) handle it
    // This allows proper multi-select behavior
    return {
      activeSlideId: slideId,
      hoveredObjectId: null,
      hoverPreviewHidden: false,
      activeObjectGroupId: null,
      croppingElementId: null,
      cropReturnScope: null,
      pathExtension: null,
      selectedElementIds: slide ? expandObjectGroups(slide.elements, kept) : kept,
      editingTextId: null,
    };
  }),
  setSelectedElements: (ids) => set((s) => {
    const doc = getActiveDoc();
    const slide = doc ? yDocToJsonSlideOnly(doc, s.activeSlideId)
      : usePresentationStore.getState().presentation.slides[s.activeSlideId];
    let scope = s.activeObjectGroupId;
    if (scope && ids.some(id => !slide?.elements[id]?.objectGroupIds?.includes(scope!))) scope = null;
    if (slide) ids = expandObjectGroups(slide.elements, ids, scope);
    // Reset slide selection when switching objects or deselecting all
    const hadSelection = s.selectedElementIds.length > 0;
    const changed = hadSelection &&
      (ids.length !== s.selectedElementIds.length || ids.some((id, i) => id !== s.selectedElementIds[i]));
    return {
      activeObjectGroupId: scope,
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
    activeObjectGroupId: null,
    editingTextId: null,
    ...(s.selectedSlideIds.length > 1 ? { selectedSlideIds: [s.activeSlideId] } : {}),
  })),
  setZoom: (zoom) => set({ zoom: Math.max(0.25, Math.min(3, zoom)) }),
  beginPathExtension: (elementId, end) => set((s) => {
    const el = usePresentationStore.getState().presentation.slides[s.activeSlideId]?.elements[elementId];
    if (!el || el.type !== 'shape' || el.shapeType !== 'path' || el.closed || el.locked || !el.visible || (el.points?.length ?? 0) < 4) return s;
    return { pathExtension: { elementId, end }, tool: 'line', selectedElementIds: [], editingTextId: null };
  }),
  setTool: (tool) => set((s) => ({
    tool,
    pathExtension: null,
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
  enterCropMode: (imageId) => set(s => {
    const doc = getActiveDoc();
    const slide = doc ? yDocToJsonSlideOnly(doc, s.activeSlideId) : usePresentationStore.getState().presentation.slides[s.activeSlideId];
    const image = slide?.elements[imageId];
    if (!slide || image?.type !== 'image' || image.locked) return s;
    const group = cropGroupOf(slide.elements, imageId);
    const path = image.objectGroupIds ?? [];
    return {
      croppingElementId: imageId,
      cropReturnScope: s.activeObjectGroupId,
      activeObjectGroupId: group ?? path[path.length - 1] ?? null,
      selectedElementIds: [], editingTextId: null, tool: 'select', pathExtension: null,
    };
  }),
  exitCropMode: () => {
    const s = useEditorStore.getState();
    const imageId = s.croppingElementId;
    if (!imageId) return;
    const doc = getActiveDoc();
    const read = () => doc ? yDocToJsonSlideOnly(doc, s.activeSlideId) : usePresentationStore.getState().presentation.slides[s.activeSlideId];
    const before = read();
    const group = before ? cropGroupOf(before.elements, imageId) : undefined;
    // A crop whose shapes were all removed is dissolved (hidden crop shapes
    // still mark the group, so it is found).
    if (group) usePresentationStore.getState().cleanupCrop(s.activeSlideId, group);
    const after = read();
    const ret = s.cropReturnScope && after && Object.values(after.elements).some(el => el.objectGroupIds?.includes(s.cropReturnScope!)) ? s.cropReturnScope : null;
    set({
      croppingElementId: null, cropReturnScope: null, activeObjectGroupId: ret, editingTextId: null, tool: 'select',
      selectedElementIds: after?.elements[imageId] ? expandObjectGroups(after.elements, [imageId], ret) : [],
    });
  },
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
