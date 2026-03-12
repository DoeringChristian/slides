import React, { useState, useEffect, useRef } from 'react';
import { useEditorStore } from '../../store/editorStore';
import { usePresentationStore } from '../../store/presentationStore';
import { useActiveSlide } from '../../store/selectors';
import { ChevronDown, ChevronUp } from 'lucide-react';

export const NotesEditor: React.FC = () => {
  const [isExpanded, setIsExpanded] = useState(false);
  const activeSlideId = useEditorStore((s) => s.activeSlideId);
  const updateSlideNotes = usePresentationStore((s) => s.updateSlideNotes);
  const slide = useActiveSlide();

  // Local state for the textarea to avoid updating the store on every keystroke
  const [localNotes, setLocalNotes] = useState(slide?.notes ?? '');
  const activeSlideIdRef = useRef(activeSlideId);
  const localNotesRef = useRef(localNotes);
  localNotesRef.current = localNotes;

  // Sync local state when the slide changes
  useEffect(() => {
    setLocalNotes(slide?.notes ?? '');
  }, [activeSlideId, slide?.notes]);

  // Save to store on slide change or unmount
  useEffect(() => {
    activeSlideIdRef.current = activeSlideId;
    return () => {
      const prevSlideId = activeSlideIdRef.current;
      if (prevSlideId) {
        usePresentationStore.getState().updateSlideNotes(prevSlideId, localNotesRef.current);
      }
    };
  }, [activeSlideId]);

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
          value={localNotes}
          onChange={(e) => setLocalNotes(e.target.value)}
          onBlur={() => updateSlideNotes(activeSlideId, localNotes)}
          placeholder="Click to add speaker notes..."
          className="w-full h-24 px-4 py-2 text-sm text-gray-700 resize-none outline-none border-none"
        />
      )}
    </div>
  );
};
