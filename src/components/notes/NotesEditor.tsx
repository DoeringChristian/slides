import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useEditorStore } from '../../store/editorStore';
import { usePresentationStore } from '../../store/presentationStore';
import { useActiveSlide } from '../../store/selectors';
import { ChevronDown, ChevronUp } from 'lucide-react';

const MIN_HEIGHT = 64;
const DEFAULT_HEIGHT = 96;
const MAX_HEIGHT = 400;

export const NotesEditor: React.FC = () => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [height, setHeight] = useState(DEFAULT_HEIGHT);
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

  // Drag-to-resize handle (drag upward to grow)
  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    const startY = e.clientY;
    const startHeight = height;

    const onMove = (ev: PointerEvent) => {
      const delta = startY - ev.clientY;
      setHeight(Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, startHeight + delta)));
    };
    const onUp = () => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
    };
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
  }, [height]);

  if (!slide) return null;

  return (
    <div className="border-t border-gray-200 bg-white shrink-0">
      {isExpanded && (
        <div
          onPointerDown={handlePointerDown}
          className="h-1.5 cursor-ns-resize hover:bg-blue-100 active:bg-blue-200 transition-colors"
        />
      )}
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
          className="w-full px-4 py-2 text-sm text-gray-700 resize-none outline-none border-none"
          style={{ height }}
        />
      )}
    </div>
  );
};
