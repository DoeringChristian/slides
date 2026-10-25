import { create } from 'zustand';
import { temporal } from 'zundo';
import { guardLocalActions, beforeLocalMutation } from '../utils/scrubMutation';
import * as Y from 'yjs';
import type { Presentation, Slide, SlideElement, TextElement, ObjectMeta, SlideTemplate, Resource } from '../types/presentation';
import { generateId } from '../utils/idGenerator';
import { createPresentation, createSlide, copySlideAsKeyframe, generateObjectName } from '../utils/slideFactory';
import { assertPresentation } from '../utils/currentPresentation';
import { syncDependentsAfterMutation, expandWithBoundTexts } from '../utils/syncDependents';
import { beforeMutation } from '../utils/autoDraw';
import { lerpAngle } from '../utils/interpolation';
import { mirrorTargets, withMirroring } from '../utils/multiSlide';
import { areSlidesContiguous, groupsToDissolve } from '../utils/presenterAdvance';
import { planSlideGroupEdit } from '../utils/slideGroupEditing';
import { getActiveUndoManager } from '../collab/activeUndo';
import { canMergeObjects, mergeObjectInSlides } from '../utils/mergeObjects';
import { applyStickyDefaults } from '../utils/stickyEasings';
import {
  collectGhostObjectIds,
  isObjectVisibleAnywhere,
  isResourceReferencedInSlides,
  objectSubtypeForElement,
  objectTypeForElement,
  purgeObjectFromSlides,
  repairPresentation,
} from '../utils/presentationCleanup';
import { getActiveDoc, runInTxn } from '../collab/yDocAdapter';
import {
  elementToYMap,
  slideToYMap,
  templateToYMap,
  backgroundToYMap,
  mkScalarMap,
  getYRoot,
  getYSlide,
  getYElement,
  yDocToJsonSlideOnly,
  yArrayReplaceAll,
  applyChangesToYElement,
} from '../collab/ySchema';
import {
  collectBoundTextIdsInY,
  objectExistsAnywhereInY,
  objectVisibleAnywhereInY,
  purgeObjectInY,
  resourceReferencedInY,
} from '../collab/yCleanup';

// Collab helpers — small adapters over the Y schema so the actions below can
// stay close to their original shape. All `getYxxx` returns either a Y type
// or undefined if the doc hasn't been populated yet (cold-start in flight).
/** Y.Array reorder helpers. Y.Array doesn't have a `set`-style replace; we
 *  delete and re-insert inside the surrounding transaction. */
function moveInYArray(doc: Y.Doc, slideId: string, elementId: string, mode: 1 | -1 | 'front' | 'back') {
  const order = getYSlide(doc, slideId)?.get('elementOrder') as Y.Array<string> | undefined;
  if (!order) return;
  const arr = order.toArray();
  const idx = arr.indexOf(elementId);
  if (idx === -1) return;
  let newIdx: number;
  if (mode === 'front') newIdx = arr.length - 1;
  else if (mode === 'back') newIdx = 0;
  else newIdx = idx + mode;
  newIdx = Math.max(0, Math.min(arr.length - 1, newIdx));
  if (newIdx === idx) return;
  order.delete(idx, 1);
  order.insert(newIdx, [elementId]);
  getYRoot(doc).set('updatedAt', Date.now());
}

/** Walk slideOrder forward from `fromSlideId` and apply `changes` to the same
 *  element on every subsequent slide where it exists. Mirrors the JSON-side
 *  propagateToSubsequentSlides helper. */
function propagateInY(doc: Y.Doc, fromSlideId: string, elementId: string, changes: Record<string, unknown>, boundTo?: string) {
  const order = (getYRoot(doc).get('slideOrder') as Y.Array<string>).toArray();
  const fromIdx = order.indexOf(fromSlideId);
  if (fromIdx === -1) return;
  for (let i = fromIdx + 1; i < order.length; i++) {
    const elMap = getYElement(doc, order[i], elementId);
    if (!elMap || (boundTo && elMap.get('containerId') !== boundTo)) continue;
    applyChangesToYElement(elMap, changes);
  }
}

// Helper: propagate partial changes to an element across all slides after fromSlideId
function propagateToSubsequentSlides(
  slides: Record<string, Slide>,
  slideOrder: string[],
  fromSlideId: string,
  elementId: string,
  changes: Partial<SlideElement>,
  boundTo?: string,
): Record<string, Slide> {
  const fromIdx = slideOrder.indexOf(fromSlideId);
  if (fromIdx === -1) return slides;
  const updated = { ...slides };
  for (let i = fromIdx + 1; i < slideOrder.length; i++) {
    const sid = slideOrder[i];
    const slide = updated[sid];
    if (slide && slide.elements[elementId] && (!boundTo || (slide.elements[elementId] as TextElement).containerId === boundTo)) {
      updated[sid] = {
        ...slide,
        elements: {
          ...slide.elements,
          [elementId]: { ...slide.elements[elementId], ...changes } as SlideElement,
        },
      };
    }
  }
  return updated;
}

/** Build the slide inserted by addSlideWithMode from its neighbours. Shared
 *  by the Y and Zustand branches — the Y side passes plain-JSON snapshots. */
function buildSlideWithMode(
  prevSlide: Slide | null,
  nextSlide: Slide | null,
  mode: 'previous' | 'next' | 'interpolate',
): Slide {
  if (mode === 'previous' && prevSlide) return copySlideAsKeyframe(prevSlide);
  if (mode === 'next' && nextSlide) return copySlideAsKeyframe(nextSlide);
  if (mode === 'interpolate' && prevSlide && nextSlide) {
    // Start from previous, then lerp numeric properties toward next
    const newSlide = copySlideAsKeyframe(prevSlide);
    for (const elId of newSlide.elementOrder) {
      const elA = prevSlide.elements[elId];
      const elB = nextSlide.elements[elId];
      if (elA && elB) {
        newSlide.elements[elId] = {
          ...JSON.parse(JSON.stringify(elA)),
          x: (elA.x + elB.x) / 2,
          y: (elA.y + elB.y) / 2,
          width: (elA.width + elB.width) / 2,
          height: (elA.height + elB.height) / 2,
          rotation: lerpAngle(elA.rotation, elB.rotation, 0.5),
          opacity: (elA.opacity + elB.opacity) / 2,
        } as SlideElement;
      }
    }
    return newSlide;
  }
  if (prevSlide) return copySlideAsKeyframe(prevSlide);
  if (nextSlide) return copySlideAsKeyframe(nextSlide);
  return createSlide();
}

interface PresentationStore {
  presentation: Presentation;

  // Slide actions
  addSlide: (index?: number) => string;
  deleteSlide: (slideId: string) => void;
  duplicateSlide: (slideId: string) => string;
  reorderSlides: (slideOrder: string[]) => void;
  updateSlideBackground: (slideId: string, background: Slide['background']) => void;
  updateSlideTransition: (slideId: string, transition: Slide['transition']) => void;
  updateSlideNotes: (slideId: string, notes: string) => void;
  addSlideWithMode: (afterIndex: number, mode: 'previous' | 'next' | 'interpolate') => string;
  addEmptySlide: (index?: number) => string;
  toggleSlideHidden: (slideId: string) => void;
  /** Group ≥2 slides that are contiguous in slideOrder into one timed-chain
   *  group (members' existing groupIds are overwritten). Returns the new
   *  groupId, or null when the selection is invalid. */
  groupSlides: (slideIds: string[]) => string | null;
  /** Strip the groupId from every slide sharing a group with any given id. */
  ungroupSlides: (slideIds: string[]) => void;
  /** Split BEFORE this slide; singletons become ungrouped. */
  splitSlideGroup: (slideId: string) => void;
  /** Remove membership only, preserving the slide and its position/content. */
  removeSlideFromGroup: (slideId: string) => void;
  /** Per-slide hold (seconds) before the timed chain advances past it. */
  updateSlideAutoAdvanceDelay: (slideId: string, delay: number) => void;

  // Element actions
  addElement: (slideId: string, element: SlideElement) => void;
  addElements: (slideId: string, elements: SlideElement[]) => void;
  updateElement: (slideId: string, elementId: string, changes: Partial<SlideElement>) => void;
  updateElements: (slideId: string, updates: Array<{ elementId: string; changes: Partial<SlideElement> }>, measuredFit?: boolean) => void;
  deleteElements: (slideId: string, elementIds: string[]) => void;
  moveElementForward: (slideId: string, elementId: string) => void;
  moveElementBackward: (slideId: string, elementId: string) => void;
  moveElementToFront: (slideId: string, elementId: string) => void;
  moveElementToBack: (slideId: string, elementId: string) => void;

  // Resource actions
  addResource: (resource: Resource) => void;

  // Keyframe actions
  hideElement: (slideId: string, elementId: string) => void;
  unhideElement: (slideId: string, elementId: string, position?: { x: number; y: number }) => void;
  resetElementToKeyframe: (slideId: string, elementId: string) => void;
  resetElementToNextKeyframe: (slideId: string, elementId: string) => void;
  renameObject: (objectId: string, name: string) => void;
  removeObject: (objectId: string) => void;
  /** Merge object `sourceId` into `targetId`: every keyframe of the source
   *  is re-identified under the target's id so playback morphs between what
   *  were two objects. Conflicts resolve TARGET-WINS (on slides where both
   *  exist the source's element is dropped; those slide ids are returned).
   *  Connector bindings and bound-text containerIds pointing at the source
   *  are remapped deck-wide; the source's registry entry is removed (the
   *  target keeps its id/name/type). No-op (`merged: false`) when the ids
   *  are equal, the source exists nowhere, or either id is a group element. */
  mergeObjects: (targetId: string, sourceId: string) => { merged: boolean; droppedOnSlides: string[] };

  // Multi-slide sync actions
  syncElementToSlides: (sourceSlideId: string, elementId: string, targetSlideIds: string[], properties: (keyof SlideElement)[]) => void;

  // Template actions
  saveAsTemplate: (slideId: string, name: string) => string;
  addSlideFromTemplate: (templateId: string, index?: number) => string;
  deleteTemplate: (templateId: string) => void;

  // Presentation actions
  updateTitle: (title: string) => void;
  loadPresentation: (presentation: Presentation) => void;
  resetPresentation: () => void;
}

type StoreSet = (
  updater: (state: PresentationStore) => PresentationStore | { presentation: Presentation },
) => void;

/** Shared implementation of the four z-order actions. The JSON index math is
 *  computed exactly like moveInYArray (clamp, splice out, splice in) so both
 *  paths agree — including the early return when the element isn't in the
 *  order array. */
function moveElement(set: StoreSet, slideId: string, elementId: string, mode: 1 | -1 | 'front' | 'back') {
  slideId = beforeMutation(slideId);
  const __mirrors = mirrorTargets(slideId);
  withMirroring(() => {
    for (const mid of __mirrors) {
      moveElement(set, mid, elementId, mode);
    }
  });
  const doc = getActiveDoc();
  if (doc) {
    runInTxn(() => moveInYArray(doc, slideId, elementId, mode));
    return;
  }
  set((state) => {
    const slide = state.presentation.slides[slideId];
    if (!slide) return state;
    const order = [...slide.elementOrder];
    const idx = order.indexOf(elementId);
    if (idx === -1) return state;
    let newIdx: number;
    if (mode === 'front') newIdx = order.length - 1;
    else if (mode === 'back') newIdx = 0;
    else newIdx = idx + mode;
    newIdx = Math.max(0, Math.min(order.length - 1, newIdx));
    if (newIdx === idx) return state;
    order.splice(idx, 1);
    order.splice(newIdx, 0, elementId);
    return {
      presentation: {
        ...state.presentation,
        slides: { ...state.presentation.slides, [slideId]: { ...slide, elementOrder: order } },
        updatedAt: Date.now(),
      },
    };
  });
}

function editSlideGroup(
  slideId: string,
  mode: 'split' | 'remove',
  set: (update: (state: PresentationStore) => Partial<PresentationStore>) => void,
) {
  const doc = getActiveDoc();
  if (doc) {
    const root = getYRoot(doc);
    const order = (root.get('slideOrder') as Y.Array<string> | undefined)?.toArray() ?? [];
    const groupIdOf = (id: string) => getYSlide(doc, id)?.get('groupId') as string | undefined;
    const changes = planSlideGroupEdit(order, groupIdOf, slideId, mode, generateId);
    if (!changes.size) return;
    const undo = getActiveUndoManager();
    undo?.stopCapturing();
    runInTxn(() => {
      for (const [id, groupId] of changes) {
        const slide = getYSlide(doc, id);
        if (groupId) slide?.set('groupId', groupId);
        else slide?.delete('groupId');
      }
      root.set('updatedAt', Date.now());
    });
    undo?.stopCapturing();
    return;
  }
  set(state => {
    const p = state.presentation;
    const changes = planSlideGroupEdit(p.slideOrder, id => p.slides[id]?.groupId, slideId, mode, generateId);
    if (!changes.size) return state;
    const slides = { ...p.slides };
    for (const [id, groupId] of changes) {
      slides[id] = { ...slides[id] };
      if (groupId) slides[id].groupId = groupId;
      else delete slides[id].groupId;
    }
    return { presentation: { ...p, slides, updatedAt: Date.now() } };
  });
}

export const usePresentationStore = create<PresentationStore>()(
  temporal(
    (set) => guardLocalActions<PresentationStore>({
      presentation: createPresentation(),

      addSlide: (index?: number) => {
        const doc = getActiveDoc();
        if (doc) {
          let newSlideId = '';
          runInTxn(() => {
            const root = getYRoot(doc);
            const slides = root.get('slides') as Y.Map<unknown> | undefined;
            const order = root.get('slideOrder') as Y.Array<string> | undefined;
            if (!slides || !order) return;
            const orderArr = order.toArray();
            const insertIndex = index !== undefined ? index : orderArr.length;
            const neighborId = orderArr[insertIndex - 1] ?? orderArr[insertIndex];
            const source = neighborId ? yDocToJsonSlideOnly(doc, neighborId) : null;
            const fresh = source ? copySlideAsKeyframe(source) : createSlide();
            slides.set(fresh.id, slideToYMap(fresh));
            order.insert(insertIndex, [fresh.id]);
            root.set('updatedAt', Date.now());
            newSlideId = fresh.id;
          });
          return newSlideId;
        }
        let newSlideId = '';
        set((state) => {
          const { slideOrder, slides } = state.presentation;
          const insertIndex = index !== undefined ? index : slideOrder.length;

          // Find neighbor to copy from
          let sourceSlide: Slide | null = null;
          if (insertIndex > 0 && slides[slideOrder[insertIndex - 1]]) {
            sourceSlide = slides[slideOrder[insertIndex - 1]];
          } else if (insertIndex < slideOrder.length && slides[slideOrder[insertIndex]]) {
            sourceSlide = slides[slideOrder[insertIndex]];
          }

          const newSlide = sourceSlide
            ? copySlideAsKeyframe(sourceSlide)
            : createSlide();
          newSlideId = newSlide.id;

          const newOrder = [...slideOrder];
          newOrder.splice(insertIndex, 0, newSlide.id);

          return {
            presentation: {
              ...state.presentation,
              slides: { ...slides, [newSlide.id]: newSlide },
              slideOrder: newOrder,
              updatedAt: Date.now(),
            },
          };
        });
        return newSlideId;
      },

      deleteSlide: (slideId: string) => {
        const doc = getActiveDoc();
        if (doc) {
          runInTxn(() => {
            const root = getYRoot(doc);
            const slides = root.get('slides') as Y.Map<unknown> | undefined;
            const order = root.get('slideOrder') as Y.Array<string> | undefined;
            if (!slides || !order) return;
            if (order.length <= 1) return; // refuse to delete the last slide

            // Remember which resources the doomed slide referenced so they
            // can be freed below if this was their last reference.
            const doomedResourceIds = new Set<string>();
            const doomedElements = getYSlide(doc, slideId)?.get('elements') as
              | Y.Map<Y.Map<unknown>>
              | undefined;
            if (doomedElements) {
              for (const el of doomedElements.values()) {
                if (el.get('type') !== 'image') continue;
                const rid = el.get('resourceId');
                if (typeof rid === 'string' && rid) doomedResourceIds.add(rid);
              }
            }

            slides.delete(slideId);
            const idx = order.toArray().indexOf(slideId);
            if (idx !== -1) order.delete(idx, 1);

            // GC: registry entries whose object no longer exists on any slide
            // would otherwise linger as "ghost" rows in the objects bar.
            const objects = root.get('objects') as Y.Map<unknown> | undefined;
            if (objects) {
              for (const objectId of [...objects.keys()]) {
                if (!objectExistsAnywhereInY(doc, objectId)) objects.delete(objectId);
              }
            }
            // …and resources only the deleted slide referenced leak the same way.
            const resources = root.get('resources') as Y.Map<unknown> | undefined;
            if (resources) {
              for (const rid of doomedResourceIds) {
                if (!resourceReferencedInY(doc, rid)) resources.delete(rid);
              }
            }
            root.set('updatedAt', Date.now());
          });
          return;
        }
        set((state) => {
          if (state.presentation.slideOrder.length <= 1) return state;
          const removedSlide = state.presentation.slides[slideId];
          const { [slideId]: _removed, ...remainingSlides } = state.presentation.slides;

          // GC: drop registry entries whose object no longer exists on any
          // slide ("ghost" objects in the objects bar).
          let objects = state.presentation.objects;
          const ghostIds = collectGhostObjectIds(remainingSlides, objects);
          if (ghostIds.length > 0) {
            objects = { ...objects };
            for (const id of ghostIds) delete objects[id];
          }

          // …and free resources only the deleted slide referenced.
          let resources = state.presentation.resources;
          if (removedSlide) {
            for (const element of Object.values(removedSlide.elements)) {
              if (element.type !== 'image' || !element.resourceId) continue;
              if (isResourceReferencedInSlides(remainingSlides, element.resourceId)) continue;
              const { [element.resourceId]: _removedResource, ...remainingResources } = resources;
              resources = remainingResources;
            }
          }

          return {
            presentation: {
              ...state.presentation,
              slides: remainingSlides,
              slideOrder: state.presentation.slideOrder.filter((id) => id !== slideId),
              objects,
              resources,
              updatedAt: Date.now(),
            },
          };
        });
      },

      duplicateSlide: (slideId: string) => {
        const doc = getActiveDoc();
        if (doc) {
          let newSlideId = '';
          runInTxn(() => {
            const root = getYRoot(doc);
            const slides = root.get('slides') as Y.Map<unknown> | undefined;
            const order = root.get('slideOrder') as Y.Array<string> | undefined;
            if (!slides || !order) return;
            const sourceJson = yDocToJsonSlideOnly(doc, slideId);
            if (!sourceJson) return;
            const fresh = copySlideAsKeyframe(sourceJson);
            fresh.notes = sourceJson.notes;
            slides.set(fresh.id, slideToYMap(fresh));
            const idx = order.toArray().indexOf(slideId);
            order.insert(idx + 1, [fresh.id]);
            root.set('updatedAt', Date.now());
            newSlideId = fresh.id;
          });
          return newSlideId;
        }
        let newSlideId = '';
        set((state) => {
          const sourceSlide = state.presentation.slides[slideId];
          if (!sourceSlide) return state;

          const newSlide = copySlideAsKeyframe(sourceSlide);
          newSlide.notes = sourceSlide.notes;
          newSlideId = newSlide.id;

          const slideOrder = [...state.presentation.slideOrder];
          const idx = slideOrder.indexOf(slideId);
          slideOrder.splice(idx + 1, 0, newSlide.id);

          return {
            presentation: {
              ...state.presentation,
              slides: { ...state.presentation.slides, [newSlide.id]: newSlide },
              slideOrder,
              updatedAt: Date.now(),
            },
          };
        });
        return newSlideId;
      },

      reorderSlides: (slideOrder: string[]) => {
        const doc = getActiveDoc();
        if (doc) {
          runInTxn(() => {
            const root = getYRoot(doc);
            const order = root.get('slideOrder') as Y.Array<string> | undefined;
            if (!order) return;
            yArrayReplaceAll(order, slideOrder);
            // Post-pass: dissolve slide groups the reorder split apart —
            // a group is only meaningful as a contiguous run.
            const slidesMap = root.get('slides') as Y.Map<Y.Map<unknown>> | undefined;
            if (slidesMap) {
              const dissolve = groupsToDissolve(slideOrder, (id) => {
                const gid = slidesMap.get(id)?.get('groupId');
                return typeof gid === 'string' ? gid : undefined;
              });
              if (dissolve.size > 0) {
                for (const slideMap of slidesMap.values()) {
                  const gid = slideMap.get('groupId');
                  if (typeof gid === 'string' && dissolve.has(gid)) slideMap.delete('groupId');
                }
              }
            }
            root.set('updatedAt', Date.now());
          });
          return;
        }
        set((state) => {
          // Post-pass mirroring the Y branch: strip groups no longer contiguous.
          const dissolve = groupsToDissolve(slideOrder, (id) => state.presentation.slides[id]?.groupId);
          let slides = state.presentation.slides;
          if (dissolve.size > 0) {
            slides = { ...slides };
            for (const sid of Object.keys(slides)) {
              const slide = slides[sid];
              if (slide.groupId && dissolve.has(slide.groupId)) {
                const { groupId: _gid, ...rest } = slide;
                slides[sid] = rest as Slide;
              }
            }
          }
          return {
            presentation: { ...state.presentation, slides, slideOrder, updatedAt: Date.now() },
          };
        });
      },

      updateSlideBackground: (slideId, background) => {
        slideId = beforeMutation(slideId);
        const __mirrors = mirrorTargets(slideId);
        withMirroring(() => {
          for (const mid of __mirrors) {
            usePresentationStore.getState().updateSlideBackground(mid, background);
          }
        });
        const doc = getActiveDoc();
        if (doc) {
          runInTxn(() => {
            const slideMap = getYSlide(doc, slideId);
            if (!slideMap) return;
            // Replace the whole background Y.Map — backgrounds are discriminated
            // unions; a partial overlay would leak stale fields from the
            // previous variant (e.g. gradient `from`/`to` lingering after
            // switching to a solid color).
            slideMap.set('background', backgroundToYMap(background));
            getYRoot(doc).set('updatedAt', Date.now());
          });
          return;
        }
        set((state) => {
          const slide = state.presentation.slides[slideId];
          if (!slide) return state;
          return {
            presentation: {
              ...state.presentation,
              slides: {
                ...state.presentation.slides,
                [slideId]: { ...slide, background },
              },
              updatedAt: Date.now(),
            },
          };
        });
      },

      updateSlideTransition: (slideId, transition) => {
        const doc = getActiveDoc();
        if (doc) {
          runInTxn(() => {
            const slideMap = getYSlide(doc, slideId);
            if (!slideMap) return;
            const txMap = slideMap.get('transition') as Y.Map<unknown> | undefined;
            if (txMap instanceof Y.Map) {
              for (const [k, v] of Object.entries(transition)) txMap.set(k, v);
            } else {
              const fresh = new Y.Map<unknown>();
              for (const [k, v] of Object.entries(transition)) fresh.set(k, v);
              slideMap.set('transition', fresh);
            }
            getYRoot(doc).set('updatedAt', Date.now());
          });
          return;
        }
        set((state) => {
          const slide = state.presentation.slides[slideId];
          if (!slide) return state;
          return {
            presentation: {
              ...state.presentation,
              slides: {
                ...state.presentation.slides,
                [slideId]: { ...slide, transition },
              },
              updatedAt: Date.now(),
            },
          };
        });
      },

      updateSlideNotes: (slideId, notes) => {
        const doc = getActiveDoc();
        if (doc) {
          runInTxn(() => {
            const slideMap = getYSlide(doc, slideId);
            if (!slideMap) return;
            const yText = slideMap.get('notes');
            if (yText instanceof Y.Text) {
              yText.delete(0, yText.length);
              yText.insert(0, notes);
            } else {
              const fresh = new Y.Text();
              if (notes) fresh.insert(0, notes);
              slideMap.set('notes', fresh);
            }
            getYRoot(doc).set('updatedAt', Date.now());
          });
          return;
        }
        set((state) => {
          const slide = state.presentation.slides[slideId];
          if (!slide) return state;
          return {
            presentation: {
              ...state.presentation,
              slides: {
                ...state.presentation.slides,
                [slideId]: { ...slide, notes },
              },
              updatedAt: Date.now(),
            },
          };
        });
      },

      addSlideWithMode: (afterIndex: number, mode: 'previous' | 'next' | 'interpolate') => {
        const doc = getActiveDoc();
        if (doc) {
          // Read the neighbour slides out of Y as plain JSON, build the new
          // Slide via buildSlideWithMode (shared with the Zustand branch
          // below), then push it back into Y as a Y.Map subtree.
          let newSlideId = '';
          runInTxn(() => {
            const root = getYRoot(doc);
            const slides = root.get('slides') as Y.Map<unknown> | undefined;
            const order = root.get('slideOrder') as Y.Array<string> | undefined;
            if (!slides || !order) return;
            const orderArr = order.toArray();
            const prevSlide = orderArr[afterIndex] ? yDocToJsonSlideOnly(doc, orderArr[afterIndex]) : null;
            const nextSlide = orderArr[afterIndex + 1] ? yDocToJsonSlideOnly(doc, orderArr[afterIndex + 1]) : null;

            const newSlide = buildSlideWithMode(prevSlide, nextSlide, mode);

            slides.set(newSlide.id, slideToYMap(newSlide));
            order.insert(afterIndex + 1, [newSlide.id]);
            root.set('updatedAt', Date.now());
            newSlideId = newSlide.id;
          });
          return newSlideId;
        }
        let newSlideId = '';
        set((state) => {
          const { slideOrder, slides } = state.presentation;
          const prevSlide = slides[slideOrder[afterIndex]] ?? null;
          const nextSlide = slides[slideOrder[afterIndex + 1]] ?? null;

          const newSlide = buildSlideWithMode(prevSlide, nextSlide, mode);

          newSlideId = newSlide.id;
          const newOrder = [...slideOrder];
          newOrder.splice(afterIndex + 1, 0, newSlide.id);

          return {
            presentation: {
              ...state.presentation,
              slides: { ...slides, [newSlide.id]: newSlide },
              slideOrder: newOrder,
              updatedAt: Date.now(),
            },
          };
        });
        return newSlideId;
      },

      addEmptySlide: (index?: number) => {
        const doc = getActiveDoc();
        if (doc) {
          let newSlideId = '';
          runInTxn(() => {
            const root = getYRoot(doc);
            const slides = root.get('slides') as Y.Map<unknown> | undefined;
            const order = root.get('slideOrder') as Y.Array<string> | undefined;
            if (!slides || !order) return;
            const fresh = createSlide();
            slides.set(fresh.id, slideToYMap(fresh));
            const insertIndex = index !== undefined ? index : order.length;
            order.insert(insertIndex, [fresh.id]);
            root.set('updatedAt', Date.now());
            newSlideId = fresh.id;
          });
          return newSlideId;
        }
        let newSlideId = '';
        set((state) => {
          const { slideOrder, slides } = state.presentation;
          const insertIndex = index !== undefined ? index : slideOrder.length;
          const newSlide = createSlide();
          newSlideId = newSlide.id;
          const newOrder = [...slideOrder];
          newOrder.splice(insertIndex, 0, newSlide.id);
          return {
            presentation: {
              ...state.presentation,
              slides: { ...slides, [newSlide.id]: newSlide },
              slideOrder: newOrder,
              updatedAt: Date.now(),
            },
          };
        });
        return newSlideId;
      },

      toggleSlideHidden: (slideId: string) => {
        const doc = getActiveDoc();
        if (doc) {
          runInTxn(() => {
            const slideMap = getYSlide(doc, slideId);
            if (!slideMap) return;
            slideMap.set('hidden', !slideMap.get('hidden'));
            getYRoot(doc).set('updatedAt', Date.now());
          });
          return;
        }
        set((state) => {
          const slide = state.presentation.slides[slideId];
          if (!slide) return state;
          return {
            presentation: {
              ...state.presentation,
              slides: {
                ...state.presentation.slides,
                [slideId]: { ...slide, hidden: !slide.hidden },
              },
              updatedAt: Date.now(),
            },
          };
        });
      },

      groupSlides: (slideIds: string[]) => {
        const doc = getActiveDoc();
        if (doc) {
          let result: string | null = null;
          runInTxn(() => {
            const root = getYRoot(doc);
            const order = root.get('slideOrder') as Y.Array<string> | undefined;
            if (!order) return;
            if (!areSlidesContiguous(order.toArray(), slideIds)) return;
            const groupId = generateId();
            for (const sid of slideIds) {
              const slideMap = getYSlide(doc, sid);
              if (slideMap) slideMap.set('groupId', groupId);
            }
            root.set('updatedAt', Date.now());
            result = groupId;
          });
          return result;
        }
        let result: string | null = null;
        set((state) => {
          const { slideOrder, slides } = state.presentation;
          if (!areSlidesContiguous(slideOrder, slideIds)) return state;
          const groupId = generateId();
          const newSlides = { ...slides };
          for (const sid of slideIds) {
            if (newSlides[sid]) newSlides[sid] = { ...newSlides[sid], groupId };
          }
          result = groupId;
          return {
            presentation: { ...state.presentation, slides: newSlides, updatedAt: Date.now() },
          };
        });
        return result;
      },

      splitSlideGroup: (slideId) => editSlideGroup(slideId, 'split', set),
      removeSlideFromGroup: (slideId) => editSlideGroup(slideId, 'remove', set),

      ungroupSlides: (slideIds: string[]) => {
        const doc = getActiveDoc();
        if (doc) {
          runInTxn(() => {
            const root = getYRoot(doc);
            const slidesMap = root.get('slides') as Y.Map<Y.Map<unknown>> | undefined;
            if (!slidesMap) return;
            const targetGroups = new Set<string>();
            for (const sid of slideIds) {
              const gid = getYSlide(doc, sid)?.get('groupId');
              if (typeof gid === 'string') targetGroups.add(gid);
            }
            if (targetGroups.size === 0) return;
            for (const slideMap of slidesMap.values()) {
              const gid = slideMap.get('groupId');
              if (typeof gid === 'string' && targetGroups.has(gid)) slideMap.delete('groupId');
            }
            root.set('updatedAt', Date.now());
          });
          return;
        }
        set((state) => {
          const { slides } = state.presentation;
          const targetGroups = new Set<string>();
          for (const sid of slideIds) {
            const gid = slides[sid]?.groupId;
            if (gid) targetGroups.add(gid);
          }
          if (targetGroups.size === 0) return state;
          const newSlides: Record<string, Slide> = {};
          for (const [sid, slide] of Object.entries(slides)) {
            if (slide.groupId && targetGroups.has(slide.groupId)) {
              const { groupId: _gid, ...rest } = slide;
              newSlides[sid] = rest as Slide;
            } else {
              newSlides[sid] = slide;
            }
          }
          return {
            presentation: { ...state.presentation, slides: newSlides, updatedAt: Date.now() },
          };
        });
      },

      updateSlideAutoAdvanceDelay: (slideId, delay) => {
        const doc = getActiveDoc();
        if (doc) {
          runInTxn(() => {
            const slideMap = getYSlide(doc, slideId);
            if (!slideMap) return;
            slideMap.set('autoAdvanceDelay', delay);
            getYRoot(doc).set('updatedAt', Date.now());
          });
          return;
        }
        set((state) => {
          const slide = state.presentation.slides[slideId];
          if (!slide) return state;
          return {
            presentation: {
              ...state.presentation,
              slides: {
                ...state.presentation.slides,
                [slideId]: { ...slide, autoAdvanceDelay: delay },
              },
              updatedAt: Date.now(),
            },
          };
        });
      },

      addElement: (slideId, element) => {
        slideId = beforeMutation(slideId);
        // Inherit the user's last-picked easings (applicable ones only).
        // Anything explicitly set on `element` wins.
        element = applyStickyDefaults(element);
        const doc = getActiveDoc();
        if (doc) {
          runInTxn(() => {
            const slideMap = getYSlide(doc, slideId);
            if (!slideMap) return;
            const elements = slideMap.get('elements') as Y.Map<unknown> | undefined;
            const elementOrder = slideMap.get('elementOrder') as Y.Array<string> | undefined;
            if (!elements || !elementOrder) return;
            elements.set(element.id, elementToYMap(element));
            elementOrder.push([element.id]);

            // Register in global objects map (same logic as the Zustand path).
            const objects = getYRoot(doc).get('objects') as Y.Map<unknown> | undefined;
            if (objects && !objects.has(element.id)) {
              const objSnapshot = Object.fromEntries(
                [...objects.entries()].map(([k, v]) => [k, (v as Y.Map<unknown>).toJSON()]),
              ) as Record<string, ObjectMeta>;
              const meta: ObjectMeta = {
                id: element.id,
                name: generateObjectName(objectSubtypeForElement(element), objSnapshot),
                type: objectTypeForElement(element),
              };
              objects.set(element.id, mkScalarMap(meta));
            }
            getYRoot(doc).set('updatedAt', Date.now());
          });
          return;
        }
        set((state) => {
          const slide = state.presentation.slides[slideId];
          if (!slide) return state;

          // Register in global objects if not already present
          const objects = { ...state.presentation.objects };
          if (!objects[element.id]) {
            objects[element.id] = {
              id: element.id,
              name: generateObjectName(objectSubtypeForElement(element), objects),
              type: objectTypeForElement(element),
            };
          }

          return {
            presentation: {
              ...state.presentation,
              objects,
              slides: {
                ...state.presentation.slides,
                [slideId]: {
                  ...slide,
                  elements: { ...slide.elements, [element.id]: element },
                  elementOrder: [...slide.elementOrder, element.id],
                },
              },
              updatedAt: Date.now(),
            },
          };
        });
      },

      addElements: (slideId, elements) => {
        slideId = beforeMutation(slideId);
        elements = elements.map(applyStickyDefaults);
        const doc = getActiveDoc();
        if (doc) {
          if (elements.length === 0) return;
          runInTxn(() => {
            const slideMap = getYSlide(doc, slideId);
            if (!slideMap) return;
            const elMap = slideMap.get('elements') as Y.Map<unknown> | undefined;
            const order = slideMap.get('elementOrder') as Y.Array<string> | undefined;
            if (!elMap || !order) return;
            const objects = getYRoot(doc).get('objects') as Y.Map<unknown> | undefined;
            const objSnapshot = objects
              ? Object.fromEntries(
                  [...objects.entries()].map(([k, v]) => [k, (v as Y.Map<unknown>).toJSON()]),
                ) as Record<string, ObjectMeta>
              : {};
            for (const el of elements) {
              elMap.set(el.id, elementToYMap(el));
              order.push([el.id]);
              if (objects && !objects.has(el.id)) {
                const meta: ObjectMeta = {
                  id: el.id,
                  name: generateObjectName(objectSubtypeForElement(el), objSnapshot),
                  type: objectTypeForElement(el),
                };
                objSnapshot[el.id] = meta;
                objects.set(el.id, mkScalarMap(meta));
              }
            }
            getYRoot(doc).set('updatedAt', Date.now());
          });
          return;
        }
        set((state) => {
          const slide = state.presentation.slides[slideId];
          if (!slide || elements.length === 0) return state;

          // Register all elements in global objects
          const objects = { ...state.presentation.objects };
          const newElements: Record<string, SlideElement> = { ...slide.elements };
          const newOrder = [...slide.elementOrder];

          for (const element of elements) {
            if (!objects[element.id]) {
              objects[element.id] = {
                id: element.id,
                name: generateObjectName(objectSubtypeForElement(element), objects),
                type: objectTypeForElement(element),
              };
            }
            newElements[element.id] = element;
            newOrder.push(element.id);
          }

          return {
            presentation: {
              ...state.presentation,
              objects,
              slides: {
                ...state.presentation.slides,
                [slideId]: {
                  ...slide,
                  elements: newElements,
                  elementOrder: newOrder,
                },
              },
              updatedAt: Date.now(),
            },
          };
        });
      },

      updateElement: (slideId, elementId, changes) => {
        slideId = beforeMutation(slideId);
        const __mirrors = mirrorTargets(slideId);
        withMirroring(() => {
          for (const mid of __mirrors) {
            usePresentationStore.getState().updateElement(mid, elementId, changes);
          }
        });
        const doc = getActiveDoc();
        if (doc) {
          runInTxn(() => {
            const elMap = getYElement(doc, slideId, elementId);
            if (!elMap) return;
            const beforeSlide = yDocToJsonSlideOnly(doc, slideId);
            applyChangesToYElement(elMap, changes as Record<string, unknown>);
            getYRoot(doc).set('updatedAt', Date.now());

            // Sync dependent geometry (connector rebinds + bound-text
            // follows) after the move. Snapshot the slide *after* applying
            // our change so dependents see the new geometry, then write the
            // recomputed patches back through Y. Mirrors the Zustand
            // fallback below — both paths must agree or peers diverge.
            const moved =
              changes.x !== undefined || changes.y !== undefined ||
              changes.width !== undefined || changes.height !== undefined ||
              changes.rotation !== undefined ||
              ((changes as { points?: number[] }).points !== undefined || 'startBinding' in changes || 'endBinding' in changes);
            if (!moved) return;
            const slide = yDocToJsonSlideOnly(doc, slideId);
            if (!slide) return;
            for (const dep of syncDependentsAfterMutation(slide.elements, slide.elementOrder, new Set([elementId]), undefined, false, beforeSlide?.elements)) {
              const depMap = getYElement(doc, slideId, dep.elementId);
              if (depMap) applyChangesToYElement(depMap, dep.changes as Record<string, unknown>);
            }
          });
          return;
        }
        set((state) => {
          const slide = state.presentation.slides[slideId];
          if (!slide || !slide.elements[elementId]) return state;

          const updatedElements = {
            ...slide.elements,
            [elementId]: { ...slide.elements[elementId], ...changes } as SlideElement,
          };

          // If an element's geometry changed (move / resize / rotate / vertex
          // edit), sync dependents: connectors bound to it, its own edge-mode
          // bindings on a vertex edit, and any bound-text labels.
          if (changes.x !== undefined || changes.y !== undefined || changes.width !== undefined || changes.height !== undefined || changes.rotation !== undefined || ((changes as { points?: number[] }).points !== undefined || 'startBinding' in changes || 'endBinding' in changes)) {
            for (const dep of syncDependentsAfterMutation(updatedElements, slide.elementOrder, new Set([elementId]), undefined, false, slide.elements)) {
              updatedElements[dep.elementId] = { ...updatedElements[dep.elementId], ...dep.changes } as SlideElement;
            }
          }

          return {
            presentation: {
              ...state.presentation,
              slides: {
                ...state.presentation.slides,
                [slideId]: {
                  ...slide,
                  elements: updatedElements,
                },
              },
              updatedAt: Date.now(),
            },
          };
        });
      },

      updateElements: (slideId, updates, measuredFit = false) => {
        slideId = beforeMutation(slideId);
        const __mirrors = mirrorTargets(slideId);
        withMirroring(() => {
          for (const mid of __mirrors) {
            usePresentationStore.getState().updateElements(mid, updates, measuredFit);
          }
        });
        const doc = getActiveDoc();
        if (doc) {
          runInTxn(() => {
            const beforeSlide = yDocToJsonSlideOnly(doc, slideId);
            for (const { elementId, changes } of updates) {
              const elMap = getYElement(doc, slideId, elementId);
              if (!elMap) continue;
              applyChangesToYElement(elMap, changes as Record<string, unknown>);
            }
            getYRoot(doc).set('updatedAt', Date.now());

            // Sync dependents after the batch, exactly like the JSON
            // fallback below: snapshot the slide POST-change, run the shared
            // sync pass (connector rebinds + bound-text follows) over every
            // element that moved, and write the recomputed geometry back
            // through Y. Both paths must agree or peers diverge.
            const movedElementIds = new Set(
              updates
                .filter(u => u.changes.x !== undefined || u.changes.y !== undefined ||
                            u.changes.width !== undefined || u.changes.height !== undefined ||
                            u.changes.rotation !== undefined ||
                            ((u.changes as { points?: number[] }).points !== undefined || 'startBinding' in u.changes || 'endBinding' in u.changes))
                .map(u => u.elementId)
            );
            if (movedElementIds.size === 0) return;
            const slide = yDocToJsonSlideOnly(doc, slideId);
            if (!slide) return;
            for (const dep of syncDependentsAfterMutation(slide.elements, slide.elementOrder, movedElementIds, beforeSlide?.elements, measuredFit)) {
              const depMap = getYElement(doc, slideId, dep.elementId);
              if (depMap) applyChangesToYElement(depMap, dep.changes as Record<string, unknown>);
            }
          });
          return;
        }
        set((state) => {
          const slide = state.presentation.slides[slideId];
          if (!slide) return state;

          const updatedElements = { ...slide.elements };

          // Apply all updates
          for (const { elementId, changes } of updates) {
            if (!updatedElements[elementId]) continue;
            updatedElements[elementId] = { ...updatedElements[elementId], ...changes } as SlideElement;
          }

          // Sync dependents (connector rebinds + bound-text follows) for all
          // moved elements
          const movedElementIds = new Set(
            updates
              .filter(u => u.changes.x !== undefined || u.changes.y !== undefined ||
                          u.changes.width !== undefined || u.changes.height !== undefined ||
                          u.changes.rotation !== undefined ||
                            ((u.changes as { points?: number[] }).points !== undefined || 'startBinding' in u.changes || 'endBinding' in u.changes))
              .map(u => u.elementId)
          );

          for (const dep of syncDependentsAfterMutation(updatedElements, slide.elementOrder, movedElementIds, slide.elements, measuredFit)) {
            updatedElements[dep.elementId] = { ...updatedElements[dep.elementId], ...dep.changes } as SlideElement;
          }

          return {
            presentation: {
              ...state.presentation,
              slides: {
                ...state.presentation.slides,
                [slideId]: {
                  ...slide,
                  elements: updatedElements,
                },
              },
              updatedAt: Date.now(),
            },
          };
        });
      },

      deleteElements: (slideId, elementIds) => {
        slideId = beforeMutation(slideId);
        const __mirrors = mirrorTargets(slideId);
        withMirroring(() => {
          for (const mid of __mirrors) {
            usePresentationStore.getState().deleteElements(mid, elementIds);
          }
        });
        const doc = getActiveDoc();
        if (doc) {
          runInTxn(() => {
            const root = getYRoot(doc);
            // Cascade: deleting a container also deletes its bound labels
            // (expansion computed from this slide's snapshot, same as the
            // JSON fallback below).
            const slideJson = yDocToJsonSlideOnly(doc, slideId);
            const targetIds = slideJson
              ? expandWithBoundTexts(slideJson.elements, slideJson.elementOrder, elementIds)
              : elementIds;
            for (const elementId of targetIds) {
              const elMap = getYElement(doc, slideId, elementId);
              if (!elMap) continue;
              elMap.set('visible', false);
              propagateInY(doc, slideId, elementId, { visible: false });

              // If the element is invisible everywhere now, drop it from the
              // object registry, the per-slide elements maps, and free its
              // resource if nothing else references it. Orphaned bound
              // labels purged by the cascade leave the registry too.
              if (!objectVisibleAnywhereInY(doc, elementId)) {
                const objects = root.get('objects') as Y.Map<unknown> | undefined;
                objects?.delete(elementId);
                const { purgedBoundTextIds } = purgeObjectInY(doc, elementId);
                for (const labelId of purgedBoundTextIds) objects?.delete(labelId);
              }
            }
            root.set('updatedAt', Date.now());
          });
          return;
        }
        set((state) => {
          const slide = state.presentation.slides[slideId];
          if (!slide) return state;

          // hideElement behavior: set visible: false on this slide + subsequent
          let slides = { ...state.presentation.slides };
          const { slideOrder } = state.presentation;
          let objects = { ...state.presentation.objects };
          let resources = { ...state.presentation.resources };

          // Cascade: deleting a container also deletes its bound labels.
          const targetIds = expandWithBoundTexts(slide.elements, slide.elementOrder, elementIds);

          for (const elementId of targetIds) {
            if (!slides[slideId].elements[elementId]) continue;
            // Set visible: false on this slide
            const currentSlide = slides[slideId];
            slides[slideId] = {
              ...currentSlide,
              elements: {
                ...currentSlide.elements,
                [elementId]: { ...currentSlide.elements[elementId], visible: false } as SlideElement,
              },
            };
            // Propagate to subsequent slides
            slides = propagateToSubsequentSlides(slides, slideOrder, slideId, elementId, { visible: false });

            // Check if object is now invisible in all slides - if so, remove it
            if (!isObjectVisibleAnywhere(slides, elementId)) {
              const { [elementId]: _removedObject, ...remainingObjects } = objects;
              objects = remainingObjects;

              const purged = purgeObjectFromSlides(slides, elementId);
              slides = purged.slides;
              for (const labelId of purged.purgedBoundTextIds) {
                const { [labelId]: _removedLabel, ...restObjects } = objects;
                objects = restObjects;
              }
              if (purged.resourceIdToRemove) {
                const { [purged.resourceIdToRemove]: _removedResource, ...remainingResources } = resources;
                resources = remainingResources;
              }
            }
          }

          return {
            presentation: {
              ...state.presentation,
              slides,
              objects,
              resources,
              updatedAt: Date.now(),
            },
          };
        });
      },

      moveElementForward: (slideId, elementId) => moveElement(set, slideId, elementId, +1),

      moveElementBackward: (slideId, elementId) => moveElement(set, slideId, elementId, -1),

      moveElementToFront: (slideId, elementId) => moveElement(set, slideId, elementId, 'front'),

      moveElementToBack: (slideId, elementId) => moveElement(set, slideId, elementId, 'back'),

      addResource: (resource: Resource) => {
        const doc = getActiveDoc();
        if (doc) {
          runInTxn(() => {
            const resources = getYRoot(doc).get('resources') as Y.Map<unknown> | undefined;
            if (!resources) return;
            resources.set(resource.id, mkScalarMap(resource));
            getYRoot(doc).set('updatedAt', Date.now());
          });
          return;
        }
        set((state) => ({
          presentation: {
            ...state.presentation,
            resources: { ...state.presentation.resources, [resource.id]: resource },
            updatedAt: Date.now(),
          },
        }));
      },

      hideElement: (slideId: string, elementId: string) => {
        slideId = beforeMutation(slideId);
        const __mirrors = mirrorTargets(slideId);
        withMirroring(() => {
          for (const mid of __mirrors) {
            usePresentationStore.getState().hideElement(mid, elementId);
          }
        });
        const doc = getActiveDoc();
        if (doc) {
          runInTxn(() => {
            const root = getYRoot(doc);
            // Cascade: hiding a container hides its bound labels too.
            // Same guard as the JSON fallback: no-op when the element isn't
            // on this slide.
            const slideJson = yDocToJsonSlideOnly(doc, slideId);
            if (!slideJson || !slideJson.elements[elementId]) return;
            const targetIds = expandWithBoundTexts(slideJson.elements, slideJson.elementOrder, [elementId]);
            let touched = false;
            for (const id of targetIds) {
              const elMap = getYElement(doc, slideId, id);
              if (!elMap) continue;
              touched = true;
              elMap.set('visible', false);
              // hideElement (per its existing contract) hides only this slide.
              // We don't propagate; deleteElements is the action that cascades.
              if (!objectVisibleAnywhereInY(doc, id)) {
                const objects = root.get('objects') as Y.Map<unknown> | undefined;
                objects?.delete(id);
                const { purgedBoundTextIds } = purgeObjectInY(doc, id);
                for (const labelId of purgedBoundTextIds) objects?.delete(labelId);
              }
            }
            if (touched) root.set('updatedAt', Date.now());
          });
          return;
        }
        set((state) => {
          const slide = state.presentation.slides[slideId];
          if (!slide || !slide.elements[elementId]) return state;

          // Cascade: hiding a container hides its bound labels too.
          const targetIds = expandWithBoundTexts(slide.elements, slide.elementOrder, [elementId]);

          let slides = { ...state.presentation.slides };
          let objects = state.presentation.objects;
          let resources = state.presentation.resources;

          for (const id of targetIds) {
            const cur = slides[slideId];
            if (!cur?.elements[id]) continue;
            slides = {
              ...slides,
              [slideId]: {
                ...cur,
                elements: {
                  ...cur.elements,
                  [id]: { ...cur.elements[id], visible: false } as SlideElement,
                },
              },
            };

            // Check if object is now invisible in all slides - if so, remove it
            if (!isObjectVisibleAnywhere(slides, id)) {
              const { [id]: _removedObject, ...remainingObjects } = objects;
              objects = remainingObjects;

              const purged = purgeObjectFromSlides(slides, id);
              slides = purged.slides;
              for (const labelId of purged.purgedBoundTextIds) {
                const { [labelId]: _removedLabel, ...restObjects } = objects;
                objects = restObjects;
              }
              if (purged.resourceIdToRemove) {
                const { [purged.resourceIdToRemove]: _removedResource, ...remainingResources } = resources;
                resources = remainingResources;
              }
            }
          }

          return {
            presentation: { ...state.presentation, slides, objects, resources, updatedAt: Date.now() },
          };
        });
      },

      unhideElement: (slideId: string, elementId: string, position?: { x: number; y: number }) => {
        slideId = beforeMutation(slideId);
        const __mirrors = mirrorTargets(slideId);
        withMirroring(() => {
          for (const mid of __mirrors) {
            usePresentationStore.getState().unhideElement(mid, elementId, position);
          }
        });
        const doc = getActiveDoc();
        if (doc) {
          runInTxn(() => {
            const slideMap = getYSlide(doc, slideId);
            if (!slideMap) return;

            const order = (getYRoot(doc).get('slideOrder') as Y.Array<string>).toArray();

            // Unhide one element on this slide (present → set visible, absent
            // → copy from the nearest slide) and propagate visible:true
            // forward. Shared by the container and its bound-label cascade.
            const unhideOne = (id: string, pos?: { x: number; y: number }, boundTo?: string): boolean => {
              const elMap = getYElement(doc, slideId, id);
              if (elMap) {
                // A label detached on this keyframe must not be resurrected
                // because it still belongs to this container on another.
                if (boundTo && elMap.get('containerId') !== boundTo) return false;
                elMap.set('visible', true);
                if (pos) {
                  elMap.set('x', pos.x);
                  elMap.set('y', pos.y);
                }
              } else {
                // Element not on this slide — copy from the nearest slide that has it.
                const here = order.indexOf(slideId);
                let sourceJson: SlideElement | null = null;
                for (let i = here - 1; i >= 0 && !sourceJson; i--) {
                  const src = getYElement(doc, order[i], id);
                  if (src && (!boundTo || src.get('containerId') === boundTo)) sourceJson = src.toJSON() as SlideElement;
                }
                for (let i = here + 1; i < order.length && !sourceJson; i++) {
                  const src = getYElement(doc, order[i], id);
                  if (src && (!boundTo || src.get('containerId') === boundTo)) sourceJson = src.toJSON() as SlideElement;
                }
                if (!sourceJson) return false;
                const fresh = {
                  ...JSON.parse(JSON.stringify(sourceJson)),
                  visible: true,
                  ...(pos ? { x: pos.x, y: pos.y } : {}),
                } as SlideElement;
                const elements = slideMap.get('elements') as Y.Map<unknown> | undefined;
                const elementOrder = slideMap.get('elementOrder') as Y.Array<string> | undefined;
                if (!elements || !elementOrder) return false;
                elements.set(id, elementToYMap(fresh));
                elementOrder.push([id]);
              }
              // Propagate visible:true to subsequent slides where the element exists.
              propagateInY(doc, slideId, id, { visible: true }, boundTo);
              return true;
            };

            if (!unhideOne(elementId, position)) return;
            // Cascade visibility to the container's bound labels (found
            // anywhere in the deck — the label keyframe may be missing here).
            for (const labelId of collectBoundTextIdsInY(doc, elementId)) {
              unhideOne(labelId, undefined, elementId);
            }

            // Dropped at a new position → run the shared dependent sync so
            // bound labels / connectors track the container (mirrors the
            // JSON fallback below).
            if (position) {
              const snap = yDocToJsonSlideOnly(doc, slideId);
              if (snap) {
                for (const dep of syncDependentsAfterMutation(snap.elements, snap.elementOrder, new Set([elementId]))) {
                  const depMap = getYElement(doc, slideId, dep.elementId);
                  if (depMap) applyChangesToYElement(depMap, dep.changes as Record<string, unknown>);
                }
              }
            }
            getYRoot(doc).set('updatedAt', Date.now());
          });
          return;
        }
        set((state) => {
          const slide = state.presentation.slides[slideId];
          if (!slide) return state;

          const { slideOrder } = state.presentation;
          let updatedSlides = { ...state.presentation.slides };

          const unhideOne = (id: string, pos?: { x: number; y: number }, boundTo?: string): boolean => {
            const cur = updatedSlides[slideId];
            if (cur.elements[id]) {
              if (boundTo && (cur.elements[id] as TextElement).containerId !== boundTo) return false;
              // Element exists on this slide — just unhide it
              const changes: Partial<SlideElement> = { visible: true };
              if (pos) {
                changes.x = pos.x;
                changes.y = pos.y;
              }
              updatedSlides[slideId] = {
                ...cur,
                elements: {
                  ...cur.elements,
                  [id]: { ...cur.elements[id], ...changes } as SlideElement,
                },
              };
            } else {
              // Element not on this slide — copy from nearest slide that has it
              let sourceEl: SlideElement | null = null;
              // Search backwards first, then forwards
              const slideIdx = slideOrder.indexOf(slideId);
              for (let i = slideIdx - 1; i >= 0; i--) {
                const s = updatedSlides[slideOrder[i]];
                if (s?.elements[id] && (!boundTo || (s.elements[id] as TextElement).containerId === boundTo)) {
                  sourceEl = s.elements[id];
                  break;
                }
              }
              if (!sourceEl) {
                for (let i = slideIdx + 1; i < slideOrder.length; i++) {
                  const s = updatedSlides[slideOrder[i]];
                  if (s?.elements[id] && (!boundTo || (s.elements[id] as TextElement).containerId === boundTo)) {
                    sourceEl = s.elements[id];
                    break;
                  }
                }
              }
              if (!sourceEl) return false;

              const newEl = {
                ...JSON.parse(JSON.stringify(sourceEl)),
                visible: true,
                ...(pos ? { x: pos.x, y: pos.y } : {}),
              } as SlideElement;

              updatedSlides[slideId] = {
                ...cur,
                elements: { ...cur.elements, [id]: newEl },
                elementOrder: [...cur.elementOrder, id],
              };
            }

            // Propagate visible: true to subsequent slides
            updatedSlides = propagateToSubsequentSlides(
              updatedSlides,
              slideOrder,
              slideId,
              id,
              { visible: true },
              boundTo,
            );
            return true;
          };

          if (!unhideOne(elementId, position)) return state;

          // Cascade visibility to the container's bound labels (found
          // anywhere in the deck, deterministic slideOrder × elementOrder).
          const labelIds: string[] = [];
          const seenLabels = new Set<string>();
          for (const sid of slideOrder) {
            const s = updatedSlides[sid];
            if (!s) continue;
            for (const elId of s.elementOrder) {
              const el = s.elements[elId];
              if (
                el?.type === 'text' &&
                (el as TextElement).containerId === elementId &&
                !seenLabels.has(elId)
              ) {
                seenLabels.add(elId);
                labelIds.push(elId);
              }
            }
          }
          for (const labelId of labelIds) unhideOne(labelId, undefined, elementId);

          // Dropped at a new position → dependent sync (labels/connectors).
          if (position) {
            const target = updatedSlides[slideId];
            const deps = syncDependentsAfterMutation(target.elements, target.elementOrder, new Set([elementId]));
            if (deps.length > 0) {
              const elements = { ...target.elements };
              for (const dep of deps) {
                elements[dep.elementId] = { ...elements[dep.elementId], ...dep.changes } as SlideElement;
              }
              updatedSlides[slideId] = { ...target, elements };
            }
          }

          return {
            presentation: { ...state.presentation, slides: updatedSlides, updatedAt: Date.now() },
          };
        });
      },

      resetElementToKeyframe: (slideId: string, elementId: string) => {
        const doc = getActiveDoc();
        if (doc) {
          runInTxn(() => {
            const root = getYRoot(doc);
            const order = (root.get('slideOrder') as Y.Array<string>).toArray();
            const idx = order.indexOf(slideId);
            if (idx <= 0) return;
            const prevSrc = getYElement(doc, order[idx - 1], elementId);
            const here = getYSlide(doc, slideId)?.get('elements') as Y.Map<unknown> | undefined;
            if (!prevSrc || !here?.has(elementId)) return;
            here.set(elementId, elementToYMap(prevSrc.toJSON() as SlideElement));
            root.set('updatedAt', Date.now());
          });
          return;
        }
        set((state) => {
          const { slideOrder, slides } = state.presentation;
          const slideIdx = slideOrder.indexOf(slideId);
          if (slideIdx <= 0) return state;
          const prevSlide = slides[slideOrder[slideIdx - 1]];
          if (!prevSlide?.elements[elementId]) return state;
          const slide = slides[slideId];
          if (!slide?.elements[elementId]) return state;

          const prevEl = prevSlide.elements[elementId];
          return {
            presentation: {
              ...state.presentation,
              slides: {
                ...slides,
                [slideId]: {
                  ...slide,
                  elements: {
                    ...slide.elements,
                    [elementId]: JSON.parse(JSON.stringify(prevEl)),
                  },
                },
              },
              updatedAt: Date.now(),
            },
          };
        });
      },

      resetElementToNextKeyframe: (slideId: string, elementId: string) => {
        const doc = getActiveDoc();
        if (doc) {
          runInTxn(() => {
            const root = getYRoot(doc);
            const order = (root.get('slideOrder') as Y.Array<string>).toArray();
            const idx = order.indexOf(slideId);
            if (idx < 0 || idx >= order.length - 1) return;
            const nextSrc = getYElement(doc, order[idx + 1], elementId);
            const here = getYSlide(doc, slideId)?.get('elements') as Y.Map<unknown> | undefined;
            if (!nextSrc || !here?.has(elementId)) return;
            here.set(elementId, elementToYMap(nextSrc.toJSON() as SlideElement));
            root.set('updatedAt', Date.now());
          });
          return;
        }
        set((state) => {
          const { slideOrder, slides } = state.presentation;
          const slideIdx = slideOrder.indexOf(slideId);
          if (slideIdx >= slideOrder.length - 1) return state;
          const nextSlide = slides[slideOrder[slideIdx + 1]];
          if (!nextSlide?.elements[elementId]) return state;
          const slide = slides[slideId];
          if (!slide?.elements[elementId]) return state;

          const nextEl = nextSlide.elements[elementId];
          return {
            presentation: {
              ...state.presentation,
              slides: {
                ...slides,
                [slideId]: {
                  ...slide,
                  elements: {
                    ...slide.elements,
                    [elementId]: JSON.parse(JSON.stringify(nextEl)),
                  },
                },
              },
              updatedAt: Date.now(),
            },
          };
        });
      },

      renameObject: (objectId: string, name: string) => {
        const doc = getActiveDoc();
        if (doc) {
          runInTxn(() => {
            const objects = getYRoot(doc).get('objects') as Y.Map<unknown> | undefined;
            const yObj = objects?.get(objectId) as Y.Map<unknown> | undefined;
            if (!yObj) return;
            yObj.set('name', name);
            getYRoot(doc).set('updatedAt', Date.now());
          });
          return;
        }
        set((state) => {
          if (!state.presentation.objects[objectId]) return state;
          return {
            presentation: {
              ...state.presentation,
              objects: {
                ...state.presentation.objects,
                [objectId]: { ...state.presentation.objects[objectId], name },
              },
              updatedAt: Date.now(),
            },
          };
        });
      },

      removeObject: (objectId: string) => {
        const doc = getActiveDoc();
        if (doc) {
          runInTxn(() => {
            const root = getYRoot(doc);
            const objects = root.get('objects') as Y.Map<unknown> | undefined;
            if (!objects?.has(objectId)) return;
            objects.delete(objectId);
            const { purgedBoundTextIds } = purgeObjectInY(doc, objectId);
            for (const labelId of purgedBoundTextIds) objects.delete(labelId);
            root.set('updatedAt', Date.now());
          });
          return;
        }
        set((state) => {
          // Remove from objects registry
          const { [objectId]: removedObject, ...remainingObjects } = state.presentation.objects;
          if (!removedObject) return state;

          // Remove from all slides, dropping a now-unreferenced image resource
          // and cascading to orphaned bound-text labels.
          const purged = purgeObjectFromSlides(state.presentation.slides, objectId);
          let objects: Record<string, ObjectMeta> = remainingObjects;
          for (const labelId of purged.purgedBoundTextIds) {
            const { [labelId]: _removedLabel, ...restObjects } = objects;
            objects = restObjects;
          }
          let resources = state.presentation.resources;
          if (purged.resourceIdToRemove) {
            const { [purged.resourceIdToRemove]: _removedResource, ...remainingResources } = resources;
            resources = remainingResources;
          }

          return {
            presentation: {
              ...state.presentation,
              objects,
              slides: purged.slides,
              resources,
              updatedAt: Date.now(),
            },
          };
        });
      },

      mergeObjects: (targetId: string, sourceId: string) => {
        const doc = getActiveDoc();
        if (doc) {
          const result = { merged: false, droppedOnSlides: [] as string[] };
          runInTxn(() => {
            const root = getYRoot(doc);
            const order = (root.get('slideOrder') as Y.Array<string> | undefined)?.toArray();
            if (!order) return;

            // Snapshot every slide as plain JSON for the guard and the
            // per-slide merge decisions (same inputs the JSON path sees).
            const slidesJson: Record<string, Slide> = {};
            for (const sid of order) {
              const snap = yDocToJsonSlideOnly(doc, sid);
              if (snap) slidesJson[sid] = snap;
            }
            if (!canMergeObjects(slidesJson, targetId, sourceId)) return;

            const merged = mergeObjectInSlides(slidesJson, targetId, sourceId, order);
            // Y transactions do not roll back on exceptions. Build EVERY
            // replacement before touching any slide, registry or reference.
            const plans = order.flatMap(sid => {
              const before = slidesJson[sid], after = merged.slides[sid];
              if (!before || before === after) return [];
              const slideMap = getYSlide(doc, sid)!;
              const elements = slideMap.get('elements') as Y.Map<Y.Map<unknown>>;
              const elementOrder = slideMap.get('elementOrder') as Y.Array<string>;
              const replacements = Object.entries(after.elements)
                .filter(([id, el]) => id === targetId && el !== before.elements[id])
                .map(([id, el]) => [id, elementToYMap(el)] as const);
              const updates = Object.entries(after.elements)
                .filter(([id, el]) => id !== targetId && el !== before.elements[id])
                .map(([id, el]) => {
                  const old = before.elements[id];
                  const changes: Record<string, unknown> = {};
                  for (const key of ['visible', 'containerId', 'startBinding', 'endBinding'] as const) {
                    const next = (el as unknown as Record<string, unknown>)[key];
                    if (next !== (old as unknown as Record<string, unknown>)?.[key]) changes[key] = next;
                  }
                  return { id, changes };
                });
              return [{ elements, elementOrder, after, replacements, updates }];
            });
            for (const plan of plans) {
              if (!plan.after.elements[sourceId]) plan.elements.delete(sourceId);
              for (const [id, map] of plan.replacements) plan.elements.set(id, map);
              for (const { id, changes } of plan.updates) {
                const map = plan.elements.get(id);
                if (map) {
                  if (Object.prototype.hasOwnProperty.call(changes, 'containerId') && changes.containerId === undefined) map.delete('containerId');
                  applyChangesToYElement(map, changes);
                }
              }
              yArrayReplaceAll(plan.elementOrder, plan.after.elementOrder);
            }
            result.droppedOnSlides = merged.droppedOnSlides;

            // Registry: the source's entry goes; the target keeps its
            // id/name/ObjectMeta.type untouched.
            (root.get('objects') as Y.Map<unknown> | undefined)?.delete(sourceId);
            root.set('updatedAt', Date.now());
            result.merged = true;
          });
          return result;
        }
        const result = { merged: false, droppedOnSlides: [] as string[] };
        set((state) => {
          const { slides, slideOrder, objects } = state.presentation;
          if (!canMergeObjects(slides, targetId, sourceId)) return state;
          const res = mergeObjectInSlides(slides, targetId, sourceId, slideOrder);
          const { [sourceId]: _removedMeta, ...remainingObjects } = objects;
          result.merged = true;
          result.droppedOnSlides = res.droppedOnSlides;
          return {
            presentation: {
              ...state.presentation,
              slides: res.slides,
              objects: remainingObjects,
              updatedAt: Date.now(),
            },
          };
        });
        return result;
      },

      syncElementToSlides: (sourceSlideId: string, elementId: string, targetSlideIds: string[], properties: (keyof SlideElement)[]) => {
        const doc = getActiveDoc();
        if (doc) {
          runInTxn(() => {
            const srcEl = getYElement(doc, sourceSlideId, elementId);
            if (!srcEl) return;
            const changes: Record<string, unknown> = {};
            for (const p of properties) {
              const v = srcEl.get(p as string) ?? (String(p) === 'fillStyle' && srcEl.get('type') === 'shape' ? 'solid' : undefined);
              if (v !== undefined) changes[p as string] = v instanceof Y.Text ? v.toString() : v;
            }
            for (const targetId of targetSlideIds) {
              if (targetId === sourceSlideId) continue;
              const tgt = getYElement(doc, targetId, elementId);
              if (!tgt) continue;
              applyChangesToYElement(tgt, changes);
            }
            getYRoot(doc).set('updatedAt', Date.now());
          });
          return;
        }
        set((state) => {
          const sourceSlide = state.presentation.slides[sourceSlideId];
          if (!sourceSlide) return state;

          const sourceElement = sourceSlide.elements[elementId];
          if (!sourceElement) return state;

          // Build the changes object from the source element
          const changes: Partial<SlideElement> = {};
          for (const prop of properties) {
            (changes as Record<string, unknown>)[prop] = sourceElement[prop]
              ?? (String(prop) === 'fillStyle' && sourceElement.type === 'shape' ? 'solid' : undefined);
          }

          // Apply to all target slides
          const updatedSlides = { ...state.presentation.slides };
          for (const targetSlideId of targetSlideIds) {
            if (targetSlideId === sourceSlideId) continue;
            const targetSlide = updatedSlides[targetSlideId];
            if (!targetSlide || !targetSlide.elements[elementId]) continue;

            updatedSlides[targetSlideId] = {
              ...targetSlide,
              elements: {
                ...targetSlide.elements,
                [elementId]: { ...targetSlide.elements[elementId], ...changes } as SlideElement,
              },
            };
          }

          return {
            presentation: {
              ...state.presentation,
              slides: updatedSlides,
              updatedAt: Date.now(),
            },
          };
        });
      },

      saveAsTemplate: (slideId: string, name: string) => {
        const doc = getActiveDoc();
        if (doc) {
          let templateId = '';
          runInTxn(() => {
            const root = getYRoot(doc);
            const templates = root.get('templates') as Y.Map<unknown> | undefined;
            const slide = yDocToJsonSlideOnly(doc, slideId);
            if (!templates || !slide) return;
            templateId = generateId();
            const tpl: SlideTemplate = {
              id: templateId,
              name,
              elements: JSON.parse(JSON.stringify(slide.elements)),
              elementOrder: [...slide.elementOrder],
              background: JSON.parse(JSON.stringify(slide.background)),
            };
            templates.set(tpl.id, templateToYMap(tpl));
            root.set('updatedAt', Date.now());
          });
          return templateId;
        }
        let templateId = '';
        set((state) => {
          const slide = state.presentation.slides[slideId];
          if (!slide) return state;

          templateId = generateId();
          const template: SlideTemplate = {
            id: templateId,
            name,
            elements: JSON.parse(JSON.stringify(slide.elements)),
            elementOrder: [...slide.elementOrder],
            background: JSON.parse(JSON.stringify(slide.background)),
          };

          return {
            presentation: {
              ...state.presentation,
              templates: { ...state.presentation.templates, [templateId]: template },
              updatedAt: Date.now(),
            },
          };
        });
        return templateId;
      },

      addSlideFromTemplate: (templateId: string, index?: number) => {
        const doc = getActiveDoc();
        if (doc) {
          let newSlideId = '';
          runInTxn(() => {
            const root = getYRoot(doc);
            const templates = root.get('templates') as Y.Map<unknown> | undefined;
            const slides = root.get('slides') as Y.Map<unknown> | undefined;
            const order = root.get('slideOrder') as Y.Array<string> | undefined;
            if (!templates || !slides || !order) return;
            const yTpl = templates.get(templateId) as Y.Map<unknown> | undefined;
            if (!yTpl) return;
            const template = yTpl.toJSON() as SlideTemplate;

            const newSlide = createSlide();
            const elements: Record<string, SlideElement> = {};
            for (const elId of template.elementOrder) {
              const el = template.elements[elId];
              if (el) elements[elId] = JSON.parse(JSON.stringify(el));
            }
            newSlide.elements = elements;
            newSlide.elementOrder = [...template.elementOrder];
            newSlide.background = JSON.parse(JSON.stringify(template.background));

            slides.set(newSlide.id, slideToYMap(newSlide));
            const insertIndex = index !== undefined ? index : order.length;
            order.insert(insertIndex, [newSlide.id]);

            const objects = root.get('objects') as Y.Map<unknown> | undefined;
            if (objects) {
              const objSnapshot = Object.fromEntries(
                [...objects.entries()].map(([k, v]) => [k, (v as Y.Map<unknown>).toJSON()]),
              ) as Record<string, ObjectMeta>;
              for (const elId of template.elementOrder) {
                const el = elements[elId];
                if (!el || objects.has(elId)) continue;
                const meta: ObjectMeta = {
                  id: elId,
                  name: generateObjectName(objectSubtypeForElement(el), objSnapshot),
                  type: objectTypeForElement(el),
                };
                objSnapshot[elId] = meta;
                objects.set(elId, mkScalarMap(meta));
              }
            }
            root.set('updatedAt', Date.now());
            newSlideId = newSlide.id;
          });
          return newSlideId;
        }
        let newSlideId = '';
        set((state) => {
          const template = state.presentation.templates[templateId];
          if (!template) return state;

          const newSlide = createSlide();
          newSlideId = newSlide.id;

          // Deep-copy elements from template, preserving original IDs and lock state
          const elements: Record<string, SlideElement> = {};
          for (const elId of template.elementOrder) {
            const el = template.elements[elId];
            if (el) {
              elements[elId] = JSON.parse(JSON.stringify(el));
            }
          }
          newSlide.elements = elements;
          newSlide.elementOrder = [...template.elementOrder];
          newSlide.background = JSON.parse(JSON.stringify(template.background));

          // Register objects if not already present
          const objects = { ...state.presentation.objects };
          for (const elId of template.elementOrder) {
            const el = elements[elId];
            if (el && !objects[elId]) {
              objects[elId] = {
                id: elId,
                name: generateObjectName(objectSubtypeForElement(el), objects),
                type: objectTypeForElement(el),
              };
            }
          }

          const { slideOrder, slides } = state.presentation;
          const insertIndex = index !== undefined ? index : slideOrder.length;
          const newOrder = [...slideOrder];
          newOrder.splice(insertIndex, 0, newSlide.id);

          return {
            presentation: {
              ...state.presentation,
              slides: { ...slides, [newSlide.id]: newSlide },
              slideOrder: newOrder,
              objects,
              updatedAt: Date.now(),
            },
          };
        });
        return newSlideId;
      },

      deleteTemplate: (templateId: string) => {
        const doc = getActiveDoc();
        if (doc) {
          runInTxn(() => {
            const templates = getYRoot(doc).get('templates') as Y.Map<unknown> | undefined;
            templates?.delete(templateId);
            getYRoot(doc).set('updatedAt', Date.now());
          });
          return;
        }
        set((state) => {
          const { [templateId]: _removed, ...remaining } = state.presentation.templates;
          return {
            presentation: {
              ...state.presentation,
              templates: remaining,
              updatedAt: Date.now(),
            },
          };
        });
      },

      updateTitle: (title) => {
        const doc = getActiveDoc();
        if (doc) {
          runInTxn(() => {
            const root = getYRoot(doc);
            const yText = root.get('title');
            if (yText instanceof Y.Text) {
              yText.delete(0, yText.length);
              yText.insert(0, title);
            } else {
              root.set('title', title);
            }
            root.set('updatedAt', Date.now());
          });
          return;
        }
        set((state) => ({
          presentation: { ...state.presentation, title, updatedAt: Date.now() },
        }));
      },

      loadPresentation: (presentation) => {
        set({ presentation: repairPresentation(assertPresentation(presentation)) });
      },

      resetPresentation: () => {
        set({ presentation: createPresentation() });
      },
    }),
    {
      limit: 50,
      equality: (pastState, currentState) =>
        pastState.presentation === currentState.presentation,
    }
  )
);

// Also cover programmatic history calls, not only keyboard/useHistory callers.
for (const key of ['undo', 'redo'] as const) {
  const original = usePresentationStore.temporal.getState()[key];
  usePresentationStore.temporal.setState({ [key]: (...args: Parameters<typeof original>) => {
    beforeLocalMutation();
    return original(...args);
  } });
}
