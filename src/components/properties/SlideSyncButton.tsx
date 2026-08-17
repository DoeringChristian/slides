import React, { useMemo } from 'react';
import { Copy } from 'lucide-react';
import { useEditorStore } from '../../store/editorStore';
import { usePresentationStore } from '../../store/presentationStore';
import type { SlideElement } from '../../types/presentation';
import { getNested, setNestedPartial, defaultEquals } from './Property';

interface Props {
  elementId: string;
  fields: string[]; // Supports dot notation like 'style.fontSize'
}

export const SlideSyncButton: React.FC<Props> = ({ elementId, fields }) => {
  const activeSlideId = useEditorStore((s) => s.activeSlideId);
  const selectedSlideIds = useEditorStore((s) => s.selectedSlideIds);
  const slides = usePresentationStore((s) => s.presentation.slides);
  const syncElementToSlides = usePresentationStore((s) => s.syncElementToSlides);
  const updateElement = usePresentationStore((s) => s.updateElement);

  const hasDifference = useMemo(() => {
    if (selectedSlideIds.length <= 1) return false;

    const activeElement = slides[activeSlideId]?.elements[elementId];
    if (!activeElement) return false;

    for (const slideId of selectedSlideIds) {
      if (slideId === activeSlideId) continue;
      const slide = slides[slideId];
      if (!slide) continue;
      const element = slide.elements[elementId];

      // Element missing on this slide counts as a difference
      if (!element) return true;

      for (const field of fields) {
        if (!defaultEquals(getNested(activeElement, field), getNested(element, field))) return true;
      }
    }
    return false;
  }, [selectedSlideIds, activeSlideId, slides, elementId, fields]);

  if (!hasDifference) return null;

  const handleSync = () => {
    const hasNestedFields = fields.some((f) => f.includes('.'));

    if (!hasNestedFields) {
      // Use existing syncElementToSlides for top-level fields
      syncElementToSlides(activeSlideId, elementId, selectedSlideIds, fields as (keyof SlideElement)[]);
    } else {
      // Handle nested fields manually
      const sourceElement = slides[activeSlideId]?.elements[elementId];
      if (!sourceElement) return;

      let changes: Partial<SlideElement> = {};
      for (const field of fields) {
        changes = { ...changes, ...setNestedPartial(sourceElement, field, getNested(sourceElement, field)) };
      }
      for (const slideId of selectedSlideIds) {
        if (slideId === activeSlideId) continue;
        if (!slides[slideId]?.elements[elementId]) continue;
        updateElement(slideId, elementId, changes);
      }
    }
  };

  return (
    <button
      onClick={handleSync}
      className="p-0.5 rounded hover:bg-blue-100 text-blue-500 hover:text-blue-600"
      title="Sync to all selected slides"
    >
      <Copy size={12} />
    </button>
  );
};
