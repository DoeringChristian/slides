import { transferIds } from '../../utils/model/groupTransfer';
import { SelectionPropertiesContext } from './SelectionPropertiesContext';
import React, { useMemo, useContext } from 'react';
import { Copy } from 'lucide-react';
import { useEditorStore } from '../../store/editorStore';
import { usePresentationStore } from '../../store/presentationStore';
import { getNested, defaultEquals } from './Property';

interface Props {
  elementId: string;
  fields: string[]; // Supports dot notation like 'style.fontSize'
}

export const SlideSyncButton: React.FC<Props> = ({ elementId, fields }) => {
  const batchIds = useContext(SelectionPropertiesContext);
  const activeSlideId = useEditorStore((s) => s.activeSlideId);
  const selectedSlideIds = useEditorStore((s) => s.selectedSlideIds);
  const slides = usePresentationStore((s) => s.presentation.slides);

  const hasDifference = useMemo(() => {
    if (selectedSlideIds.length <= 1) return false;

    const source = slides[activeSlideId];
    if (!source) return false;
    return transferIds(source, batchIds ?? [elementId]).some(elementId => {
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
    });
  }, [batchIds,selectedSlideIds, activeSlideId, slides, elementId, fields]);

  if (!hasDifference) return null;

  const handleSync = () => {
    usePresentationStore.getState().syncElementsToSlides(activeSlideId, batchIds ?? [elementId], selectedSlideIds, fields);
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
