import React, { useRef, useEffect, useCallback } from 'react';
import { useEditorStore } from '../../store/editorStore';
import { usePresentationStore } from '../../store/presentationStore';
import type { TextElement } from '../../types/presentation';

interface Props {
  stageRef: React.RefObject<HTMLDivElement | null>;
  zoom: number;
}

export const TextEditOverlay: React.FC<Props> = ({ stageRef, zoom }) => {
  const editingTextId = useEditorStore((s) => s.editingTextId);
  const activeSlideId = useEditorStore((s) => s.activeSlideId);
  const setEditingTextId = useEditorStore((s) => s.setEditingTextId);
  const updateElement = usePresentationStore((s) => s.updateElement);
  const slide = usePresentationStore((s) => s.presentation.slides[activeSlideId]);

  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const element = editingTextId && slide ? slide.elements[editingTextId] as TextElement | undefined : undefined;

  const handleBlur = useCallback(() => {
    if (textareaRef.current && editingTextId && activeSlideId) {
      updateElement(activeSlideId, editingTextId, { text: textareaRef.current.value });
    }
    setEditingTextId(null);
  }, [editingTextId, activeSlideId, updateElement, setEditingTextId]);

  useEffect(() => {
    if (element && textareaRef.current) {
      textareaRef.current.value = element.text;
      textareaRef.current.focus();
      textareaRef.current.select();
    }
  }, [element]);

  if (!element || !stageRef.current) return null;

  const containerRect = stageRef.current.getBoundingClientRect();
  const stageElement = stageRef.current.querySelector('.konvajs-content');
  if (!stageElement) return null;
  const stageRect = stageElement.getBoundingClientRect();

  const left = stageRect.left - containerRect.left + element.x * zoom;
  const top = stageRect.top - containerRect.top + element.y * zoom;

  return (
    <div className="text-edit-overlay absolute" style={{ left: 0, top: 0, width: '100%', height: '100%', pointerEvents: 'none' }}>
      <textarea
        ref={textareaRef}
        style={{
          position: 'absolute',
          left: `${left}px`,
          top: `${top}px`,
          width: `${element.width * zoom}px`,
          height: `${element.height * zoom}px`,
          fontSize: `${element.style.fontSize * zoom}px`,
          fontFamily: element.style.fontFamily,
          fontWeight: element.style.fontWeight,
          fontStyle: element.style.fontStyle,
          color: element.style.color,
          textAlign: element.style.align,
          lineHeight: element.style.lineHeight,
          transform: `rotate(${element.rotation}deg)`,
          transformOrigin: 'top left',
          pointerEvents: 'auto',
          zIndex: 1000,
        }}
        onBlur={handleBlur}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            handleBlur();
          }
          e.stopPropagation();
        }}
      />
    </div>
  );
};
