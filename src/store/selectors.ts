import { useMemo } from 'react';
import { usePresentationStore } from './presentationStore';
import { useEditorStore } from './editorStore';
import type { Slide, SlideElement, ObjectMeta, Resource } from '../types/presentation';

export function useActiveSlide(): Slide | undefined {
  const activeSlideId = useEditorStore((s) => s.activeSlideId);
  return usePresentationStore((s) => s.presentation.slides[activeSlideId]);
}

export function useOrderedSlides(): Slide[] {
  const slides = usePresentationStore((s) => s.presentation.slides);
  const order = usePresentationStore((s) => s.presentation.slideOrder);
  return order.map((id) => slides[id]).filter(Boolean);
}

export function useSelectedElements(): SlideElement[] {
  const activeSlideId = useEditorStore((s) => s.activeSlideId);
  const selectedIds = useEditorStore((s) => s.selectedElementIds);
  const slide = usePresentationStore((s) => s.presentation.slides[activeSlideId]);
  if (!slide) return [];
  return selectedIds.map((id) => slide.elements[id]).filter(Boolean);
}

export function useSlideElements(slideId: string): SlideElement[] {
  const slide = usePresentationStore((s) => s.presentation.slides[slideId]);
  if (!slide) return [];
  return slide.elementOrder.map((id) => slide.elements[id]).filter(Boolean);
}

export function usePreviousSlideElement(elementId: string): SlideElement | undefined {
  const activeSlideId = useEditorStore((s) => s.activeSlideId);
  const slideOrder = usePresentationStore((s) => s.presentation.slideOrder);
  const slides = usePresentationStore((s) => s.presentation.slides);
  const idx = slideOrder.indexOf(activeSlideId);
  if (idx <= 0) return undefined;
  const prevSlide = slides[slideOrder[idx - 1]];
  return prevSlide?.elements[elementId];
}

/** Find the element on the nearest previous slide where it's visible. */
export function usePrevKeyframeElement(elementId: string): SlideElement | undefined {
  const activeSlideId = useEditorStore((s) => s.activeSlideId);
  const slideOrder = usePresentationStore((s) => s.presentation.slideOrder);
  const slides = usePresentationStore((s) => s.presentation.slides);
  return useMemo(() => {
    if (!elementId) return undefined;
    const idx = slideOrder.indexOf(activeSlideId);
    for (let i = idx - 1; i >= 0; i--) {
      const el = slides[slideOrder[i]]?.elements[elementId];
      if (el?.visible) return el;
    }
    return undefined;
  }, [elementId, activeSlideId, slideOrder, slides]);
}

/** Find the element on the nearest next slide where it's visible. */
export function useNextKeyframeElement(elementId: string): SlideElement | undefined {
  const activeSlideId = useEditorStore((s) => s.activeSlideId);
  const slideOrder = usePresentationStore((s) => s.presentation.slideOrder);
  const slides = usePresentationStore((s) => s.presentation.slides);
  return useMemo(() => {
    if (!elementId) return undefined;
    const idx = slideOrder.indexOf(activeSlideId);
    for (let i = idx + 1; i < slideOrder.length; i++) {
      const el = slides[slideOrder[i]]?.elements[elementId];
      if (el?.visible) return el;
    }
    return undefined;
  }, [elementId, activeSlideId, slideOrder, slides]);
}

export function useAllObjects(): ObjectMeta[] {
  const objects = usePresentationStore((s) => s.presentation.objects);
  return Object.values(objects);
}

export function useObjectElements(): Record<string, SlideElement | undefined> {
  const activeSlideId = useEditorStore((s) => s.activeSlideId);
  const slides = usePresentationStore((s) => s.presentation.slides);
  const slideOrder = usePresentationStore((s) => s.presentation.slideOrder);
  const objects = usePresentationStore((s) => s.presentation.objects);
  return useMemo(() => {
    const result: Record<string, SlideElement | undefined> = {};
    const activeSlide = slides[activeSlideId];
    for (const objId of Object.keys(objects)) {
      if (activeSlide?.elements[objId]) {
        result[objId] = activeSlide.elements[objId];
        continue;
      }
      for (const sid of slideOrder) {
        const el = slides[sid]?.elements[objId];
        if (el) {
          result[objId] = el;
          break;
        }
      }
    }
    return result;
  }, [activeSlideId, slides, slideOrder, objects]);
}

export function useResource(resourceId: string | null | undefined): Resource | undefined {
  const resources = usePresentationStore((s) => s.presentation.resources);
  return resourceId ? resources[resourceId] : undefined;
}

export function useAllResources(): Resource[] {
  const resources = usePresentationStore((s) => s.presentation.resources);
  return useMemo(() => Object.values(resources), [resources]);
}
