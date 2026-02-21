import React from 'react';
import { usePresentationStore } from '../../store/presentationStore';
import { useEditorStore } from '../../store/editorStore';

export const SpeakerNotes: React.FC = () => {
  const presentingSlideIndex = useEditorStore((s) => s.presentingSlideIndex);
  const slideOrder = usePresentationStore((s) => s.presentation.slideOrder);
  const slides = usePresentationStore((s) => s.presentation.slides);

  const slideId = slideOrder[presentingSlideIndex];
  const slide = slideId ? slides[slideId] : null;

  if (!slide || !slide.notes) return null;

  return (
    <div className="p-4 text-gray-700 text-sm whitespace-pre-wrap">
      {slide.notes}
    </div>
  );
};
