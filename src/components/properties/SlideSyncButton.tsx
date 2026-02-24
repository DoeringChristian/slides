import React, { useMemo } from 'react';
import { Copy } from 'lucide-react';
import { useEditorStore } from '../../store/editorStore';
import { usePresentationStore } from '../../store/presentationStore';
import type { SlideElement, TextElement } from '../../types/presentation';

// Get a possibly nested value from an element using a dot-separated path
function getNestedValue(element: SlideElement, path: string): unknown {
  const parts = path.split('.');
  let val: unknown = element;
  for (const p of parts) {
    if (val == null || typeof val !== 'object') return undefined;
    val = (val as Record<string, unknown>)[p];
  }
  return val;
}

// Set a possibly nested value on an element, returning partial update
function buildNestedUpdate(element: SlideElement, paths: string[]): Partial<SlideElement> {
  const changes: Record<string, unknown> = {};

  for (const path of paths) {
    const parts = path.split('.');
    if (parts.length === 1) {
      changes[parts[0]] = (element as unknown as Record<string, unknown>)[parts[0]];
    } else if (parts.length === 2 && parts[0] === 'style') {
      // Merge into existing style changes
      const textEl = element as TextElement;
      if (!changes.style) {
        changes.style = { ...textEl.style };
      }
      (changes.style as Record<string, unknown>)[parts[1]] = textEl.style[parts[1] as keyof TextElement['style']];
    }
  }

  return changes as Partial<SlideElement>;
}

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
        const activeVal = getNestedValue(activeElement, field);
        const otherVal = getNestedValue(element, field);
        if (typeof activeVal === 'number' && typeof otherVal === 'number') {
          if (Math.round(activeVal * 100) !== Math.round(otherVal * 100)) return true;
        } else if (activeVal !== otherVal) {
          return true;
        }
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

      const changes = buildNestedUpdate(sourceElement, fields);
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
