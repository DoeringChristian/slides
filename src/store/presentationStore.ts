import { create } from 'zustand';
import { temporal } from 'zundo';
import type { Presentation, Slide, SlideElement, ShapeElement, ObjectMeta, SlideTemplate, Resource } from '../types/presentation';
import { generateId } from '../utils/idGenerator';
import { createPresentation, createSlide, copySlideAsKeyframe, generateObjectName } from '../utils/slideFactory';
import { resolveBindingPoint } from '../utils/connectorUtils';

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
  updateElement: (slideId: string, elementId: string, changes: Partial<SlideElement>) => void;
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
        set((state) => ({
          presentation: { ...state.presentation, slideOrder, updatedAt: Date.now() },
        }));
      },

      updateSlideBackground: (slideId, background) => {
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
                  rotation: (elA.rotation + elB.rotation) / 2,
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

      updateElement: (slideId, elementId, changes) => {
        set((state) => {
          const slide = state.presentation.slides[slideId];
          if (!slide || !slide.elements[elementId]) return state;

          const updatedElements = {
            ...slide.elements,
            [elementId]: { ...slide.elements[elementId], ...changes } as SlideElement,
          };

          // If a non-connector element moved or rotated, update any connectors bound to it
          if (changes.x !== undefined || changes.y !== undefined || changes.width !== undefined || changes.height !== undefined || changes.rotation !== undefined) {
            for (const elId of slide.elementOrder) {
              if (elId === elementId) continue;
              const el = updatedElements[elId];
              if (el.type !== 'shape') continue;
              const shape = el as ShapeElement;
              if (shape.shapeType !== 'line' && shape.shapeType !== 'arrow') continue;

              let needsUpdate = false;
              const pts = shape.points ?? [0, 0, shape.width, 0];
              let newX = shape.x;
              let newY = shape.y;
              let newPts = [...pts];

              if (shape.startBinding?.elementId === elementId) {
                const pt = resolveBindingPoint(shape.startBinding, updatedElements);
                if (pt) {
                  const endAbsX = shape.x + pts[2];
                  const endAbsY = shape.y + pts[3];
                  newX = pt.x;
                  newY = pt.y;
                  newPts = [0, 0, endAbsX - pt.x, endAbsY - pt.y];
                  needsUpdate = true;
                }
              }

              if (shape.endBinding?.elementId === elementId) {
                const pt = resolveBindingPoint(shape.endBinding, updatedElements);
                if (pt) {
                  newPts = [newPts[0], newPts[1], pt.x - newX, pt.y - newY];
                  needsUpdate = true;
                }
              }

              if (needsUpdate) {
                updatedElements[elId] = {
                  ...shape,
                  x: newX,
                  y: newY,
                  points: newPts,
                  width: Math.abs(newPts[2] - newPts[0]),
                  height: Math.abs(newPts[3] - newPts[1]),
                } as SlideElement;
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

              // Remove from all slides
              let resourceIdToRemove: string | null = null;
              for (const [sid, s] of Object.entries(slides)) {
                const element = s.elements[elementId];
                if (element) {
                  if (element.type === 'image' && 'resourceId' in element && element.resourceId) {
                    resourceIdToRemove = element.resourceId;
                  }
                  const { [elementId]: _removed, ...remainingElements } = s.elements;
                  slides[sid] = {
                    ...s,
                    elements: remainingElements,
                    elementOrder: s.elementOrder.filter((id) => id !== elementId),
                  };
                }
              }

              if (resourceIdToRemove) {
                const { [resourceIdToRemove]: _removedResource, ...remainingResources } = resources;
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
        set((state) => ({
          presentation: {
            ...state.presentation,
            resources: { ...state.presentation.resources, [resource.id]: resource },
            updatedAt: Date.now(),
          },
        }));
      },

      removeResource: (resourceId: string) => {
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
            let resourceIdToRemove: string | null = null;

            for (const [sid, s] of Object.entries(slides)) {
              const element = s.elements[elementId];
              if (element) {
                if (element.type === 'image' && 'resourceId' in element && element.resourceId) {
                  resourceIdToRemove = element.resourceId;
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

            let resources = state.presentation.resources;
            if (resourceIdToRemove) {
              const { [resourceIdToRemove]: _removedResource, ...remainingResources } = resources;
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
        set((state) => {
          // Remove from objects registry
          const { [objectId]: removedObject, ...remainingObjects } = state.presentation.objects;
          if (!removedObject) return state;

          // Remove from all slides
          const updatedSlides: Record<string, Slide> = {};
          let resourceIdToRemove: string | null = null;

          for (const [slideId, slide] of Object.entries(state.presentation.slides)) {
            const element = slide.elements[objectId];
            if (element) {
              // Track resource ID if this is an image element
              if (element.type === 'image' && 'resourceId' in element && element.resourceId) {
                resourceIdToRemove = element.resourceId;
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

          // Remove associated resource if it's an image
          let resources = state.presentation.resources;
          if (resourceIdToRemove) {
            const { [resourceIdToRemove]: _removedResource, ...remainingResources } = resources;
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
        set((state) => ({
          presentation: { ...state.presentation, title, updatedAt: Date.now() },
        }));
      },

      updateTheme: (theme) => {
        set((state) => ({
          presentation: { ...state.presentation, theme, updatedAt: Date.now() },
        }));
      },

      loadPresentation: (presentation) => {
        set({ presentation });
      },

      resetPresentation: () => {
        set({ presentation: createPresentation() });
      },
    }),
    {
      limit: 50,
      equality: (pastState, currentState) =>
        JSON.stringify(pastState.presentation) === JSON.stringify(currentState.presentation),
    }
  )
);
