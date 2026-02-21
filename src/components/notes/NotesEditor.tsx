import React, { useState } from 'react';
import { useEditorStore } from '../../store/editorStore';
import { usePresentationStore } from '../../store/presentationStore';
import { useActiveSlide } from '../../store/selectors';
import { ChevronDown, ChevronUp } from 'lucide-react';

export const NotesEditor: React.FC = () => {
  const [isExpanded, setIsExpanded] = useState(false);
  const activeSlideId = useEditorStore((s) => s.activeSlideId);
  const updateSlideNotes = usePresentationStore((s) => s.updateSlideNotes);
  const slide = useActiveSlide();

  if (!slide) return null;

  return (
    <div className="border-t border-gray-200 bg-white shrink-0">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex items-center gap-2 w-full px-4 py-1.5 text-xs text-gray-500 hover:bg-gray-50"
      >
        {isExpanded ? <ChevronDown size={12} /> : <ChevronUp size={12} />}
        Speaker Notes
      </button>
      {isExpanded && (
        <textarea
          value={slide.notes}
          onChange={(e) => updateSlideNotes(activeSlideId, e.target.value)}
          placeholder="Click to add speaker notes..."
          className="w-full h-24 px-4 py-2 text-sm text-gray-700 resize-none outline-none border-none"
        />
      )}
    </div>
  );
};
