import { create } from 'zustand';
import { temporal } from 'zundo';
import * as Y from 'yjs';
import type { Presentation, Slide, SlideElement, ShapeElement, ImageElement, ObjectMeta, SlideTemplate, Resource } from '../types/presentation';
import { generateId } from '../utils/idGenerator';
import { createPresentation, createSlide, copySlideAsKeyframe, generateObjectName } from '../utils/slideFactory';
import { migratePresentation } from '../utils/migrations';
import { rebindPathToMovedAnchor } from '../utils/connectorUtils';
import { getActiveDoc, runInTxn } from '../collab/yDocAdapter';
import {
  elementToYMap,
  slideToYMap,
  getYRoot,
  getYSlide,
  getYElement,
  yDocToJsonSlideOnly,
  yArrayReplaceAll,
  applyChangesToYElement,
} from '../collab/ySchema';

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
function propagateInY(doc: Y.Doc, fromSlideId: string, elementId: string, changes: Record<string, unknown>) {
  const order = (getYRoot(doc).get('slideOrder') as Y.Array<string>).toArray();
  const fromIdx = order.indexOf(fromSlideId);
  if (fromIdx === -1) return;
  for (let i = fromIdx + 1; i < order.length; i++) {
    const elMap = getYElement(doc, order[i], elementId);
    if (!elMap) continue;
    applyChangesToYElement(elMap, changes);
  }
}

/** True iff `elementId` appears as visible on at least one slide. Used for
 *  the "object completely gone" cleanup branch in hideElement / deleteElements. */
function objectVisibleAnywhereInY(doc: Y.Doc, elementId: string): boolean {
  const order = (getYRoot(doc).get('slideOrder') as Y.Array<string>).toArray();
  for (const slideId of order) {
    const elMap = getYElement(doc, slideId, elementId);
    if (elMap && elMap.get('visible') === true) return true;
  }
  return false;
}

/** True iff `resourceId` is referenced by at least one image element on any
 *  slide. Used to know whether removeResource should actually drop the entry. */
function resourceReferencedInY(doc: Y.Doc, resourceId: string): boolean {
  const order = (getYRoot(doc).get('slideOrder') as Y.Array<string>).toArray();
  for (const slideId of order) {
    const slide = getYSlide(doc, slideId);
    const elements = slide?.get('elements') as Y.Map<Y.Map<unknown>> | undefined;
    if (!elements) continue;
    for (const el of elements.values()) {
      if (el.get('type') === 'image' && el.get('resourceId') === resourceId) return true;
    }
  }
  return false;
}

// Helper: propagate partial changes to an element across all slides after fromSlideId
function propagateToSubsequentSlides(
  slides: Record<string, Slide>,
  slideOrder: string[],
  fromSlideId: string,
  elementId: string,
  changes: Partial<SlideElement>,
): Record<string, Slide> {
  const fromIdx = slideOrder.indexOf(fromSlideId);
  if (fromIdx === -1) return slides;
  const updated = { ...slides };
  for (let i = fromIdx + 1; i < slideOrder.length; i++) {
    const sid = slideOrder[i];
    const slide = updated[sid];
    if (slide && slide.elements[elementId]) {
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

function getObjectType(el: SlideElement): ObjectMeta['type'] {
  if (el.type === 'text') return 'text';
  if (el.type === 'image') return 'image';
  return 'shape';
}

function getObjectSubtype(el: SlideElement): string {
  if (el.type === 'shape') return (el as ShapeElement).shapeType;
  return el.type;
}

// Check if a resource is still referenced by any element in any slide
function isResourceReferencedInSlides(slides: Record<string, Slide>, resourceId: string): boolean {
  for (const slide of Object.values(slides)) {
    for (const element of Object.values(slide.elements)) {
      if (element.type === 'image' && 'resourceId' in element && (element as ImageElement).resourceId === resourceId) {
        return true;
      }
    }
  }
  return false;
}

// Check if an object is visible in any slide
function isObjectVisibleAnywhere(slides: Record<string, Slide>, objectId: string): boolean {
  for (const slide of Object.values(slides)) {
    if (slide.elements[objectId]?.visible) {
      return true;
    }
  }
  return false;
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
  updateSlideAutoAdvance: (slideId: string, autoAdvance: boolean, autoAdvanceDelay?: number) => void;
  updateSlideNotes: (slideId: string, notes: string) => void;
  addSlideWithMode: (afterIndex: number, mode: 'previous' | 'next' | 'interpolate') => string;
  addEmptySlide: (index?: number) => string;
  toggleSlideHidden: (slideId: string) => void;

  // Element actions
  addElement: (slideId: string, element: SlideElement) => void;
  addElements: (slideId: string, elements: SlideElement[]) => void;
  updateElement: (slideId: string, elementId: string, changes: Partial<SlideElement>) => void;
  updateElements: (slideId: string, updates: Array<{ elementId: string; changes: Partial<SlideElement> }>) => void;
  deleteElements: (slideId: string, elementIds: string[]) => void;
  reorderElements: (slideId: string, elementOrder: string[]) => void;
  moveElementForward: (slideId: string, elementId: string) => void;
  moveElementBackward: (slideId: string, elementId: string) => void;
  moveElementToFront: (slideId: string, elementId: string) => void;
  moveElementToBack: (slideId: string, elementId: string) => void;

  // Resource actions
  addResource: (resource: Resource) => void;
  removeResource: (resourceId: string) => void;

  // Keyframe actions
  hideElement: (slideId: string, elementId: string) => void;
  unhideElement: (slideId: string, elementId: string, position?: { x: number; y: number }) => void;
  resetElementToKeyframe: (slideId: string, elementId: string) => void;
  resetElementToNextKeyframe: (slideId: string, elementId: string) => void;
  renameObject: (objectId: string, name: string) => void;
  removeObject: (objectId: string) => void;

  // Multi-slide sync actions
  syncElementToSlides: (sourceSlideId: string, elementId: string, targetSlideIds: string[], properties: (keyof SlideElement)[]) => void;

  // Template actions
  saveAsTemplate: (slideId: string, name: string) => string;
  addSlideFromTemplate: (templateId: string, index?: number) => string;
  deleteTemplate: (templateId: string) => void;

  // Presentation actions
  updateTitle: (title: string) => void;
  updateTheme: (theme: Presentation['theme']) => void;
  loadPresentation: (presentation: Presentation) => void;
  resetPresentation: () => void;
}

export const usePresentationStore = create<PresentationStore>()(
  temporal(
    (set) => ({
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
            slides.delete(slideId);
            const idx = order.toArray().indexOf(slideId);
            if (idx !== -1) order.delete(idx, 1);
            root.set('updatedAt', Date.now());
          });
          return;
        }
        set((state) => {
          if (state.presentation.slideOrder.length <= 1) return state;
          const { [slideId]: _removed, ...remainingSlides } = state.presentation.slides;
          return {
            presentation: {
              ...state.presentation,
              slides: remainingSlides,
              slideOrder: state.presentation.slideOrder.filter((id) => id !== slideId),
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
            root.set('updatedAt', Date.now());
          });
          return;
        }
        set((state) => ({
          presentation: { ...state.presentation, slideOrder, updatedAt: Date.now() },
        }));
      },

      updateSlideBackground: (slideId, background) => {
        const doc = getActiveDoc();
        if (doc) {
          runInTxn(() => {
            const slideMap = getYSlide(doc, slideId);
            if (!slideMap) return;
            // Replace the whole background Y.Map — backgrounds are discriminated
            // unions; a partial overlay would leak stale fields from the
            // previous variant (e.g. gradient `from`/`to` lingering after
            // switching to a solid color).
            const bgMap = new Y.Map<unknown>();
            for (const [k, v] of Object.entries(background)) bgMap.set(k, v);
            slideMap.set('background', bgMap);
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

      updateSlideAutoAdvance: (slideId, autoAdvance, autoAdvanceDelay) => {
        const doc = getActiveDoc();
        if (doc) {
          runInTxn(() => {
            const slideMap = getYSlide(doc, slideId);
            if (!slideMap) return;
            slideMap.set('autoAdvance', autoAdvance);
            if (autoAdvanceDelay !== undefined) slideMap.set('autoAdvanceDelay', autoAdvanceDelay);
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
                [slideId]: {
                  ...slide,
                  autoAdvance,
                  autoAdvanceDelay: autoAdvanceDelay ?? slide.autoAdvanceDelay ?? 0,
                },
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
          // Slide using the same JS logic as the Zustand branch below, then
          // push it back into Y as a Y.Map subtree. Keeps the keyframe
          // interpolation centralized — no duplicated math.
          let newSlideId = '';
          runInTxn(() => {
            const root = getYRoot(doc);
            const slides = root.get('slides') as Y.Map<unknown> | undefined;
            const order = root.get('slideOrder') as Y.Array<string> | undefined;
            if (!slides || !order) return;
            const orderArr = order.toArray();
            const prevSlide = orderArr[afterIndex] ? yDocToJsonSlideOnly(doc, orderArr[afterIndex]) : null;
            const nextSlide = orderArr[afterIndex + 1] ? yDocToJsonSlideOnly(doc, orderArr[afterIndex + 1]) : null;

            let newSlide: Slide;
            if (mode === 'previous' && prevSlide) {
              newSlide = copySlideAsKeyframe(prevSlide);
            } else if (mode === 'next' && nextSlide) {
              newSlide = copySlideAsKeyframe(nextSlide);
            } else if (mode === 'interpolate' && prevSlide && nextSlide) {
              newSlide = copySlideAsKeyframe(prevSlide);
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
                    rotation: (() => {
                      let a = ((elA.rotation % 360) + 360) % 360;
                      const b = ((elB.rotation % 360) + 360) % 360;
                      let delta = b - a;
                      if (delta > 180) delta -= 360;
                      if (delta < -180) delta += 360;
                      return a + delta * 0.5;
                    })(),
                    opacity: (elA.opacity + elB.opacity) / 2,
                  } as SlideElement;
                }
              }
            } else if (prevSlide) {
              newSlide = copySlideAsKeyframe(prevSlide);
            } else if (nextSlide) {
              newSlide = copySlideAsKeyframe(nextSlide);
            } else {
              newSlide = createSlide();
            }

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
          const prevSlide = slides[slideOrder[afterIndex]];
          const nextSlide = slides[slideOrder[afterIndex + 1]];

          let newSlide: Slide;
          if (mode === 'previous' && prevSlide) {
            newSlide = copySlideAsKeyframe(prevSlide);
          } else if (mode === 'next' && nextSlide) {
            newSlide = copySlideAsKeyframe(nextSlide);
          } else if (mode === 'interpolate' && prevSlide && nextSlide) {
            // Start from previous, then lerp numeric properties toward next
            newSlide = copySlideAsKeyframe(prevSlide);
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
                  rotation: (() => {
                    let a = ((elA.rotation % 360) + 360) % 360;
                    let b = ((elB.rotation % 360) + 360) % 360;
                    let delta = b - a;
                    if (delta > 180) delta -= 360;
                    if (delta < -180) delta += 360;
                    return a + delta * 0.5;
                  })(),
                  opacity: (elA.opacity + elB.opacity) / 2,
                } as SlideElement;
              }
            }
          } else if (prevSlide) {
            newSlide = copySlideAsKeyframe(prevSlide);
          } else if (nextSlide) {
            newSlide = copySlideAsKeyframe(nextSlide);
          } else {
            newSlide = createSlide();
          }

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

      addElement: (slideId, element) => {
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
                name: generateObjectName(getObjectSubtype(element), objSnapshot),
                type: getObjectType(element),
              };
              const yMeta = new Y.Map<unknown>();
              yMeta.set('id', meta.id);
              yMeta.set('name', meta.name);
              yMeta.set('type', meta.type);
              objects.set(element.id, yMeta);
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
              name: generateObjectName(getObjectSubtype(element), objects),
              type: getObjectType(element),
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
                  name: generateObjectName(getObjectSubtype(el), objSnapshot),
                  type: getObjectType(el),
                };
                objSnapshot[el.id] = meta;
                const yMeta = new Y.Map<unknown>();
                yMeta.set('id', meta.id);
                yMeta.set('name', meta.name);
                yMeta.set('type', meta.type);
                objects.set(el.id, yMeta);
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
                name: generateObjectName(getObjectSubtype(element), objects),
                type: getObjectType(element),
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
        const doc = getActiveDoc();
        if (doc) {
          runInTxn(() => {
            const elMap = getYElement(doc, slideId, elementId);
            if (!elMap) return;
            applyChangesToYElement(elMap, changes as Record<string, unknown>);
            getYRoot(doc).set('updatedAt', Date.now());

            // Rebind any connectors whose start/end binds to the moved element.
            // Snapshot the slide *after* applying our change so the bound
            // anchor reflects the new geometry, then write back the recomputed
            // connector endpoints through Y. Mirrors the Zustand fallback
            // below — both paths must agree or peers diverge.
            const moved =
              changes.x !== undefined || changes.y !== undefined ||
              changes.width !== undefined || changes.height !== undefined ||
              changes.rotation !== undefined;
            if (!moved) return;
            const slide = yDocToJsonSlideOnly(doc, slideId);
            if (!slide) return;
            for (const elId of slide.elementOrder) {
              if (elId === elementId) continue;
              const el = slide.elements[elId];
              if (!el || el.type !== 'shape') continue;
              const rebound = rebindPathToMovedAnchor(el as ShapeElement, elementId, slide.elements);
              if (!rebound) continue;
              const connMap = getYElement(doc, slideId, elId);
              if (connMap) applyChangesToYElement(connMap, rebound);
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

          // If a non-connector element moved or rotated, update any
          // connectors bound to it.
          if (changes.x !== undefined || changes.y !== undefined || changes.width !== undefined || changes.height !== undefined || changes.rotation !== undefined) {
            for (const elId of slide.elementOrder) {
              if (elId === elementId) continue;
              const el = updatedElements[elId];
              if (el.type !== 'shape') continue;
              const rebound = rebindPathToMovedAnchor(el as ShapeElement, elementId, updatedElements);
              if (!rebound) continue;
              updatedElements[elId] = { ...(el as ShapeElement), ...rebound } as SlideElement;
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

      updateElements: (slideId, updates) => {
        const doc = getActiveDoc();
        if (doc) {
          runInTxn(() => {
            for (const { elementId, changes } of updates) {
              const elMap = getYElement(doc, slideId, elementId);
              if (!elMap) continue;
              applyChangesToYElement(elMap, changes as Record<string, unknown>);
            }
            getYRoot(doc).set('updatedAt', Date.now());
          });
          return;
        }
        set((state) => {
          const slide = state.presentation.slides[slideId];
          if (!slide) return state;

          let updatedElements = { ...slide.elements };

          // Apply all updates
          for (const { elementId, changes } of updates) {
            if (!updatedElements[elementId]) continue;
            updatedElements[elementId] = { ...updatedElements[elementId], ...changes } as SlideElement;
          }

          // Handle connector updates for all moved elements
          const movedElementIds = new Set(
            updates
              .filter(u => u.changes.x !== undefined || u.changes.y !== undefined ||
                          u.changes.width !== undefined || u.changes.height !== undefined ||
                          u.changes.rotation !== undefined)
              .map(u => u.elementId)
          );

          if (movedElementIds.size > 0) {
            for (const elId of slide.elementOrder) {
              if (movedElementIds.has(elId)) continue;
              const el = updatedElements[elId];
              if (el.type !== 'shape') continue;
              const shape = el as ShapeElement;
              // Check against every moved anchor. The helper bails on any
              // anchor it doesn't recognise, so iterating is cheap.
              for (const movedId of movedElementIds) {
                const rebound = rebindPathToMovedAnchor(shape, movedId, updatedElements);
                if (rebound) {
                  updatedElements[elId] = { ...shape, ...rebound } as SlideElement;
                  break;
                }
              }
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

      deleteElements: (slideId, elementIds) => {
        const doc = getActiveDoc();
        if (doc) {
          runInTxn(() => {
            const root = getYRoot(doc);
            for (const elementId of elementIds) {
              const elMap = getYElement(doc, slideId, elementId);
              if (!elMap) continue;
              elMap.set('visible', false);
              propagateInY(doc, slideId, elementId, { visible: false });

              // If the element is invisible everywhere now, drop it from the
              // object registry, the per-slide elements maps, and free its
              // resource if nothing else references it.
              if (!objectVisibleAnywhereInY(doc, elementId)) {
                const objects = root.get('objects') as Y.Map<unknown> | undefined;
                objects?.delete(elementId);
                let resourceIdToCheck: string | null = null;
                const order = (root.get('slideOrder') as Y.Array<string>).toArray();
                for (const sid of order) {
                  const slideEls = getYSlide(doc, sid)?.get('elements') as Y.Map<Y.Map<unknown>> | undefined;
                  const e = slideEls?.get(elementId);
                  if (e) {
                    if (e.get('type') === 'image') {
                      const rid = e.get('resourceId');
                      if (typeof rid === 'string') resourceIdToCheck = rid;
                    }
                    slideEls!.delete(elementId);
                    const elementOrder = getYSlide(doc, sid)?.get('elementOrder') as Y.Array<string> | undefined;
                    if (elementOrder) {
                      const idx = elementOrder.toArray().indexOf(elementId);
                      if (idx !== -1) elementOrder.delete(idx, 1);
                    }
                  }
                }
                if (resourceIdToCheck && !resourceReferencedInY(doc, resourceIdToCheck)) {
                  (root.get('resources') as Y.Map<unknown> | undefined)?.delete(resourceIdToCheck);
                }
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

          for (const elementId of elementIds) {
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

              // Track resource before removing element
              let resourceIdToCheck: string | null = null;
              // Remove from all slides
              for (const [sid, s] of Object.entries(slides)) {
                const element = s.elements[elementId];
                if (element) {
                  if (element.type === 'image' && 'resourceId' in element && element.resourceId) {
                    resourceIdToCheck = element.resourceId;
                  }
                  const { [elementId]: _removed, ...remainingElements } = s.elements;
                  slides[sid] = {
                    ...s,
                    elements: remainingElements,
                    elementOrder: s.elementOrder.filter((id) => id !== elementId),
                  };
                }
              }

              // Only remove resource if no other element still references it
              if (resourceIdToCheck && !isResourceReferencedInSlides(slides, resourceIdToCheck)) {
                const { [resourceIdToCheck]: _removedResource, ...remainingResources } = resources;
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

      reorderElements: (slideId, elementOrder) => {
        const doc = getActiveDoc();
        if (doc) {
          runInTxn(() => {
            const order = getYSlide(doc, slideId)?.get('elementOrder') as Y.Array<string> | undefined;
            if (!order) return;
            yArrayReplaceAll(order, elementOrder);
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
                [slideId]: { ...slide, elementOrder },
              },
              updatedAt: Date.now(),
            },
          };
        });
      },

      moveElementForward: (slideId, elementId) => {
        const doc = getActiveDoc();
        if (doc) {
          runInTxn(() => moveInYArray(doc, slideId, elementId, +1));
          return;
        }
        set((state) => {
          const slide = state.presentation.slides[slideId];
          if (!slide) return state;
          const order = [...slide.elementOrder];
          const idx = order.indexOf(elementId);
          if (idx < order.length - 1) {
            [order[idx], order[idx + 1]] = [order[idx + 1], order[idx]];
          }
          return {
            presentation: {
              ...state.presentation,
              slides: { ...state.presentation.slides, [slideId]: { ...slide, elementOrder: order } },
              updatedAt: Date.now(),
            },
          };
        });
      },

      moveElementBackward: (slideId, elementId) => {
        const doc = getActiveDoc();
        if (doc) {
          runInTxn(() => moveInYArray(doc, slideId, elementId, -1));
          return;
        }
        set((state) => {
          const slide = state.presentation.slides[slideId];
          if (!slide) return state;
          const order = [...slide.elementOrder];
          const idx = order.indexOf(elementId);
          if (idx > 0) {
            [order[idx], order[idx - 1]] = [order[idx - 1], order[idx]];
          }
          return {
            presentation: {
              ...state.presentation,
              slides: { ...state.presentation.slides, [slideId]: { ...slide, elementOrder: order } },
              updatedAt: Date.now(),
            },
          };
        });
      },

      moveElementToFront: (slideId, elementId) => {
        const doc = getActiveDoc();
        if (doc) {
          runInTxn(() => moveInYArray(doc, slideId, elementId, 'front'));
          return;
        }
        set((state) => {
          const slide = state.presentation.slides[slideId];
          if (!slide) return state;
          const order = slide.elementOrder.filter((id) => id !== elementId);
          order.push(elementId);
          return {
            presentation: {
              ...state.presentation,
              slides: { ...state.presentation.slides, [slideId]: { ...slide, elementOrder: order } },
              updatedAt: Date.now(),
            },
          };
        });
      },

      moveElementToBack: (slideId, elementId) => {
        const doc = getActiveDoc();
        if (doc) {
          runInTxn(() => moveInYArray(doc, slideId, elementId, 'back'));
          return;
        }
        set((state) => {
          const slide = state.presentation.slides[slideId];
          if (!slide) return state;
          const order = slide.elementOrder.filter((id) => id !== elementId);
          order.unshift(elementId);
          return {
            presentation: {
              ...state.presentation,
              slides: { ...state.presentation.slides, [slideId]: { ...slide, elementOrder: order } },
              updatedAt: Date.now(),
            },
          };
        });
      },

      addResource: (resource: Resource) => {
        const doc = getActiveDoc();
        if (doc) {
          runInTxn(() => {
            const resources = getYRoot(doc).get('resources') as Y.Map<unknown> | undefined;
            if (!resources) return;
            const yRes = new Y.Map<unknown>();
            for (const [k, v] of Object.entries(resource)) if (v !== undefined) yRes.set(k, v);
            resources.set(resource.id, yRes);
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

      removeResource: (resourceId: string) => {
        const doc = getActiveDoc();
        if (doc) {
          runInTxn(() => {
            // Only drop if no element still references it. This matches the
            // Zustand path's expectation that the action is callable from
            // anywhere without double-checking.
            if (resourceReferencedInY(doc, resourceId)) return;
            const resources = getYRoot(doc).get('resources') as Y.Map<unknown> | undefined;
            resources?.delete(resourceId);
            getYRoot(doc).set('updatedAt', Date.now());
          });
          return;
        }
        set((state) => {
          const { [resourceId]: _removed, ...remaining } = state.presentation.resources;
          return {
            presentation: {
              ...state.presentation,
              resources: remaining,
              updatedAt: Date.now(),
            },
          };
        });
      },

      hideElement: (slideId: string, elementId: string) => {
        const doc = getActiveDoc();
        if (doc) {
          runInTxn(() => {
            const root = getYRoot(doc);
            const elMap = getYElement(doc, slideId, elementId);
            if (!elMap) return;
            elMap.set('visible', false);
            // hideElement (per its existing contract) hides only this slide.
            // We don't propagate; deleteElements is the action that cascades.
            if (!objectVisibleAnywhereInY(doc, elementId)) {
              const objects = root.get('objects') as Y.Map<unknown> | undefined;
              objects?.delete(elementId);
            }
            root.set('updatedAt', Date.now());
          });
          return;
        }
        set((state) => {
          const slide = state.presentation.slides[slideId];
          if (!slide || !slide.elements[elementId]) return state;

          const slides = {
            ...state.presentation.slides,
            [slideId]: {
              ...slide,
              elements: {
                ...slide.elements,
                [elementId]: { ...slide.elements[elementId], visible: false } as SlideElement,
              },
            },
          };

          // Check if object is now invisible in all slides - if so, remove it
          if (!isObjectVisibleAnywhere(slides, elementId)) {
            // Remove object completely
            const { [elementId]: removedObject, ...remainingObjects } = state.presentation.objects;

            // Remove from all slides
            const cleanedSlides: Record<string, Slide> = {};
            let resourceIdToCheck: string | null = null;

            for (const [sid, s] of Object.entries(slides)) {
              const element = s.elements[elementId];
              if (element) {
                if (element.type === 'image' && 'resourceId' in element && element.resourceId) {
                  resourceIdToCheck = element.resourceId;
                }
                const { [elementId]: _removed, ...remainingElements } = s.elements;
                cleanedSlides[sid] = {
                  ...s,
                  elements: remainingElements,
                  elementOrder: s.elementOrder.filter((id) => id !== elementId),
                };
              } else {
                cleanedSlides[sid] = s;
              }
            }

            // Only remove resource if no other element still references it
            let resources = state.presentation.resources;
            if (resourceIdToCheck && !isResourceReferencedInSlides(cleanedSlides, resourceIdToCheck)) {
              const { [resourceIdToCheck]: _removedResource, ...remainingResources } = resources;
              resources = remainingResources;
            }

            return {
              presentation: {
                ...state.presentation,
                objects: remainingObjects,
                slides: cleanedSlides,
                resources,
                updatedAt: Date.now(),
              },
            };
          }

          return {
            presentation: { ...state.presentation, slides, updatedAt: Date.now() },
          };
        });
      },

      unhideElement: (slideId: string, elementId: string, position?: { x: number; y: number }) => {
        const doc = getActiveDoc();
        if (doc) {
          runInTxn(() => {
            const slideMap = getYSlide(doc, slideId);
            if (!slideMap) return;

            let elMap = getYElement(doc, slideId, elementId);
            if (elMap) {
              elMap.set('visible', true);
              if (position) {
                elMap.set('x', position.x);
                elMap.set('y', position.y);
              }
            } else {
              // Element not on this slide — copy from the nearest slide that has it.
              const order = (getYRoot(doc).get('slideOrder') as Y.Array<string>).toArray();
              const here = order.indexOf(slideId);
              let sourceJson: SlideElement | null = null;
              for (let i = here - 1; i >= 0 && !sourceJson; i--) {
                const src = getYElement(doc, order[i], elementId);
                if (src) sourceJson = src.toJSON() as SlideElement;
              }
              for (let i = here + 1; i < order.length && !sourceJson; i++) {
                const src = getYElement(doc, order[i], elementId);
                if (src) sourceJson = src.toJSON() as SlideElement;
              }
              if (!sourceJson) return;
              const fresh = {
                ...JSON.parse(JSON.stringify(sourceJson)),
                visible: true,
                ...(position ? { x: position.x, y: position.y } : {}),
              } as SlideElement;
              const elements = slideMap.get('elements') as Y.Map<unknown> | undefined;
              const elementOrder = slideMap.get('elementOrder') as Y.Array<string> | undefined;
              if (!elements || !elementOrder) return;
              elements.set(elementId, elementToYMap(fresh));
              elementOrder.push([elementId]);
            }

            // Propagate visible:true to subsequent slides where the element exists.
            propagateInY(doc, slideId, elementId, { visible: true });
            getYRoot(doc).set('updatedAt', Date.now());
          });
          return;
        }
        set((state) => {
          const slide = state.presentation.slides[slideId];
          if (!slide) return state;

          let updatedSlides = { ...state.presentation.slides };

          if (slide.elements[elementId]) {
            // Element exists on this slide — just unhide it
            const changes: Partial<SlideElement> = { visible: true };
            if (position) {
              changes.x = position.x;
              changes.y = position.y;
            }
            updatedSlides[slideId] = {
              ...slide,
              elements: {
                ...slide.elements,
                [elementId]: { ...slide.elements[elementId], ...changes } as SlideElement,
              },
            };
          } else {
            // Element not on this slide — copy from nearest slide that has it
            const { slideOrder } = state.presentation;
            let sourceEl: SlideElement | null = null;
            // Search backwards first, then forwards
            const slideIdx = slideOrder.indexOf(slideId);
            for (let i = slideIdx - 1; i >= 0; i--) {
              const s = updatedSlides[slideOrder[i]];
              if (s?.elements[elementId]) {
                sourceEl = s.elements[elementId];
                break;
              }
            }
            if (!sourceEl) {
              for (let i = slideIdx + 1; i < slideOrder.length; i++) {
                const s = updatedSlides[slideOrder[i]];
                if (s?.elements[elementId]) {
                  sourceEl = s.elements[elementId];
                  break;
                }
              }
            }
            if (!sourceEl) return state;

            const newEl = {
              ...JSON.parse(JSON.stringify(sourceEl)),
              visible: true,
              ...(position ? { x: position.x, y: position.y } : {}),
            } as SlideElement;

            updatedSlides[slideId] = {
              ...slide,
              elements: { ...slide.elements, [elementId]: newEl },
              elementOrder: [...slide.elementOrder, elementId],
            };
          }

          // Propagate visible: true to subsequent slides
          updatedSlides = propagateToSubsequentSlides(
            updatedSlides,
            state.presentation.slideOrder,
            slideId,
            elementId,
            { visible: true },
          );

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

            // Strip the element from every slide that has it, tracking a
            // resource for cleanup.
            const order = (root.get('slideOrder') as Y.Array<string>).toArray();
            let resourceIdToCheck: string | null = null;
            for (const sid of order) {
              const slide = getYSlide(doc, sid);
              const elements = slide?.get('elements') as Y.Map<Y.Map<unknown>> | undefined;
              const el = elements?.get(objectId);
              if (el) {
                if (el.get('type') === 'image') {
                  const rid = el.get('resourceId');
                  if (typeof rid === 'string') resourceIdToCheck = rid;
                }
                elements!.delete(objectId);
                const elementOrder = slide?.get('elementOrder') as Y.Array<string> | undefined;
                if (elementOrder) {
                  const idx = elementOrder.toArray().indexOf(objectId);
                  if (idx !== -1) elementOrder.delete(idx, 1);
                }
              }
            }

            if (resourceIdToCheck && !resourceReferencedInY(doc, resourceIdToCheck)) {
              (root.get('resources') as Y.Map<unknown> | undefined)?.delete(resourceIdToCheck);
            }
            root.set('updatedAt', Date.now());
          });
          return;
        }
        set((state) => {
          // Remove from objects registry
          const { [objectId]: removedObject, ...remainingObjects } = state.presentation.objects;
          if (!removedObject) return state;

          // Remove from all slides
          const updatedSlides: Record<string, Slide> = {};
          let resourceIdToCheck: string | null = null;

          for (const [slideId, slide] of Object.entries(state.presentation.slides)) {
            const element = slide.elements[objectId];
            if (element) {
              // Track resource ID if this is an image element
              if (element.type === 'image' && 'resourceId' in element && element.resourceId) {
                resourceIdToCheck = element.resourceId;
              }
              // Remove element from this slide
              const { [objectId]: _removed, ...remainingElements } = slide.elements;
              updatedSlides[slideId] = {
                ...slide,
                elements: remainingElements,
                elementOrder: slide.elementOrder.filter((id) => id !== objectId),
              };
            } else {
              updatedSlides[slideId] = slide;
            }
          }

          // Only remove resource if no other element still references it
          let resources = state.presentation.resources;
          if (resourceIdToCheck && !isResourceReferencedInSlides(updatedSlides, resourceIdToCheck)) {
            const { [resourceIdToCheck]: _removedResource, ...remainingResources } = resources;
            resources = remainingResources;
          }

          return {
            presentation: {
              ...state.presentation,
              objects: remainingObjects,
              slides: updatedSlides,
              resources,
              updatedAt: Date.now(),
            },
          };
        });
      },

      syncElementToSlides: (sourceSlideId: string, elementId: string, targetSlideIds: string[], properties: (keyof SlideElement)[]) => {
        const doc = getActiveDoc();
        if (doc) {
          runInTxn(() => {
            const srcEl = getYElement(doc, sourceSlideId, elementId);
            if (!srcEl) return;
            const changes: Record<string, unknown> = {};
            for (const p of properties) {
              const v = srcEl.get(p as string);
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
            (changes as any)[prop] = sourceElement[prop];
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
            // Build the template Y.Map by hand (slideToYMap is for slides;
            // SlideTemplate has the same shape minus the slide-only fields).
            const tplMap = new Y.Map<unknown>();
            tplMap.set('id', tpl.id);
            tplMap.set('name', tpl.name);
            const tplElements = new Y.Map<unknown>();
            for (const [eid, el] of Object.entries(tpl.elements)) {
              tplElements.set(eid, elementToYMap(el));
            }
            tplMap.set('elements', tplElements);
            const tplOrder = new Y.Array<string>();
            tplOrder.insert(0, tpl.elementOrder);
            tplMap.set('elementOrder', tplOrder);
            const tplBg = new Y.Map<unknown>();
            for (const [k, v] of Object.entries(tpl.background)) tplBg.set(k, v);
            tplMap.set('background', tplBg);
            templates.set(tpl.id, tplMap);
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
                  name: generateObjectName(getObjectSubtype(el), objSnapshot),
                  type: getObjectType(el),
                };
                objSnapshot[elId] = meta;
                const yMeta = new Y.Map<unknown>();
                yMeta.set('id', meta.id);
                yMeta.set('name', meta.name);
                yMeta.set('type', meta.type);
                objects.set(elId, yMeta);
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
                name: generateObjectName(getObjectSubtype(el), objects),
                type: getObjectType(el),
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

      updateTheme: (theme) => {
        const doc = getActiveDoc();
        if (doc) {
          runInTxn(() => {
            const themeMap = getYRoot(doc).get('theme') as Y.Map<unknown> | undefined;
            if (!themeMap) return;
            themeMap.set('name', theme.name);
            const colors = themeMap.get('colors') as Y.Map<unknown> | undefined;
            if (colors) for (const [k, v] of Object.entries(theme.colors)) colors.set(k, v);
            const fonts = themeMap.get('fonts') as Y.Map<unknown> | undefined;
            if (fonts) for (const [k, v] of Object.entries(theme.fonts)) fonts.set(k, v);
            getYRoot(doc).set('updatedAt', Date.now());
          });
          return;
        }
        set((state) => ({
          presentation: { ...state.presentation, theme, updatedAt: Date.now() },
        }));
      },

      loadPresentation: (presentation) => {
        set({ presentation: migratePresentation(presentation) });
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
