import { usePresentationStore } from './presentationStore';
import { useEditorStore } from './editorStore';
import type { Slide, SlideElement } from '../types/presentation';

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
