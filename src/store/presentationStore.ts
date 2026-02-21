import { create } from 'zustand';
import { temporal } from 'zundo';
import type { Presentation, Slide, SlideElement, ShapeElement } from '../types/presentation';
import { createPresentation, createSlide, duplicateElement } from '../utils/slideFactory';
import { resolveBindingPoint } from '../utils/connectorUtils';

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

  // Element actions
  addElement: (slideId: string, element: SlideElement) => void;
  updateElement: (slideId: string, elementId: string, changes: Partial<SlideElement>) => void;
  deleteElements: (slideId: string, elementIds: string[]) => void;
  reorderElements: (slideId: string, elementOrder: string[]) => void;
  moveElementForward: (slideId: string, elementId: string) => void;
  moveElementBackward: (slideId: string, elementId: string) => void;
  moveElementToFront: (slideId: string, elementId: string) => void;
  moveElementToBack: (slideId: string, elementId: string) => void;

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
        const newSlide = createSlide();
        set((state) => {
          const slideOrder = [...state.presentation.slideOrder];
          const insertIndex = index !== undefined ? index : slideOrder.length;
          slideOrder.splice(insertIndex, 0, newSlide.id);
          return {
            presentation: {
              ...state.presentation,
              slides: { ...state.presentation.slides, [newSlide.id]: newSlide },
              slideOrder,
              updatedAt: Date.now(),
            },
          };
        });
        return newSlide.id;
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

          const newElements: Record<string, SlideElement> = {};
          const newElementOrder: string[] = [];

          for (const elId of sourceSlide.elementOrder) {
            const el = sourceSlide.elements[elId];
            if (el) {
              const dup = duplicateElement(el);
              dup.x = el.x;
              dup.y = el.y;
              newElements[dup.id] = dup;
              newElementOrder.push(dup.id);
            }
          }

          const dupSlideBase = createSlide();
          const newSlide: Slide = {
            ...dupSlideBase,
            elements: newElements,
            elementOrder: newElementOrder,
            background: JSON.parse(JSON.stringify(sourceSlide.background)),
            transition: { ...sourceSlide.transition },
            notes: sourceSlide.notes,
          };
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

      addElement: (slideId, element) => {
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

          // If a non-connector element moved, update any connectors bound to it
          const movedEl = updatedElements[elementId];
          if (changes.x !== undefined || changes.y !== undefined || changes.width !== undefined || changes.height !== undefined) {
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
          const elements = { ...slide.elements };

          // Clear bindings that reference deleted elements
          const deletedSet = new Set(elementIds);
          for (const elId of slide.elementOrder) {
            if (deletedSet.has(elId)) continue;
            const el = elements[elId];
            if (el.type !== 'shape') continue;
            const shape = el as ShapeElement;
            if (shape.shapeType !== 'line' && shape.shapeType !== 'arrow') continue;
            let changed = false;
            let newStart = shape.startBinding;
            let newEnd = shape.endBinding;
            if (newStart && deletedSet.has(newStart.elementId)) {
              newStart = null;
              changed = true;
            }
            if (newEnd && deletedSet.has(newEnd.elementId)) {
              newEnd = null;
              changed = true;
            }
            if (changed) {
              elements[elId] = { ...shape, startBinding: newStart, endBinding: newEnd } as SlideElement;
            }
          }

          for (const id of elementIds) delete elements[id];
          return {
            presentation: {
              ...state.presentation,
              slides: {
                ...state.presentation.slides,
                [slideId]: {
                  ...slide,
                  elements,
                  elementOrder: slide.elementOrder.filter((id) => !elementIds.includes(id)),
                },
              },
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
