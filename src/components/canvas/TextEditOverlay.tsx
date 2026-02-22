import React, { useRef, useEffect, useCallback, useState } from 'react';
import { useEditorStore } from '../../store/editorStore';
import { usePresentationStore } from '../../store/presentationStore';
import type { TextElement } from '../../types/presentation';
import { CANVAS_PADDING } from '../../utils/constants';

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
  const dragStartRef = useRef<{ x: number; y: number; elemX: number; elemY: number } | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const element = editingTextId && slide ? slide.elements[editingTextId] as TextElement | undefined : undefined;

  const handleBlur = useCallback(() => {
    if (textareaRef.current && editingTextId && activeSlideId) {
      updateElement(activeSlideId, editingTextId, { text: textareaRef.current.value });
    }
    setEditingTextId(null);
  }, [editingTextId, activeSlideId, updateElement, setEditingTextId]);

  const handleDragStart = useCallback((e: React.MouseEvent) => {
    if (!element) return;
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
    dragStartRef.current = {
      x: e.clientX,
      y: e.clientY,
      elemX: element.x,
      elemY: element.y,
    };
  }, [element]);

  useEffect(() => {
    if (element && textareaRef.current) {
      textareaRef.current.value = element.text;
      textareaRef.current.focus();
      textareaRef.current.select();
    }
  }, [element]);

  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (!dragStartRef.current || !activeSlideId || !editingTextId) return;
      const dx = (e.clientX - dragStartRef.current.x) / zoom;
      const dy = (e.clientY - dragStartRef.current.y) / zoom;
      updateElement(activeSlideId, editingTextId, {
        x: dragStartRef.current.elemX + dx,
        y: dragStartRef.current.elemY + dy,
      });
    };

    const handleMouseUp = () => {
      setIsDragging(false);
      dragStartRef.current = null;
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, activeSlideId, editingTextId, updateElement, zoom]);

  if (!element || !stageRef.current) return null;

  const containerRect = stageRef.current.getBoundingClientRect();
  const stageElement = stageRef.current.querySelector('.konvajs-content');
  if (!stageElement) return null;
  const stageRect = stageElement.getBoundingClientRect();

  const left = stageRect.left - containerRect.left + (element.x + CANVAS_PADDING) * zoom;
  const top = stageRect.top - containerRect.top + (element.y + CANVAS_PADDING) * zoom;
  const width = element.width * zoom;
  const height = element.height * zoom;

  const borderWidth = 8;

  return (
    <div className="text-edit-overlay absolute" style={{ left: 0, top: 0, width: '100%', height: '100%', pointerEvents: 'none' }}>
      {/* Border drag handles - positioned around the textarea */}
      {/* Top border */}
      <div
        style={{
          position: 'absolute',
          left: `${left}px`,
          top: `${top - borderWidth}px`,
          width: `${width}px`,
          height: `${borderWidth}px`,
          cursor: 'move',
          pointerEvents: 'auto',
          zIndex: 1001,
        }}
        onMouseDown={handleDragStart}
      />
      {/* Bottom border */}
      <div
        style={{
          position: 'absolute',
          left: `${left}px`,
          top: `${top + height}px`,
          width: `${width}px`,
          height: `${borderWidth}px`,
          cursor: 'move',
          pointerEvents: 'auto',
          zIndex: 1001,
        }}
        onMouseDown={handleDragStart}
      />
      {/* Left border */}
      <div
        style={{
          position: 'absolute',
          left: `${left - borderWidth}px`,
          top: `${top}px`,
          width: `${borderWidth}px`,
          height: `${height}px`,
          cursor: 'move',
          pointerEvents: 'auto',
          zIndex: 1001,
        }}
        onMouseDown={handleDragStart}
      />
      {/* Right border */}
      <div
        style={{
          position: 'absolute',
          left: `${left + width}px`,
          top: `${top}px`,
          width: `${borderWidth}px`,
          height: `${height}px`,
          cursor: 'move',
          pointerEvents: 'auto',
          zIndex: 1001,
        }}
        onMouseDown={handleDragStart}
      />

      {/* Selection border - matches transformer style */}
      <div
        style={{
          position: 'absolute',
          left: `${left}px`,
          top: `${top}px`,
          width: `${width}px`,
          height: `${height}px`,
          border: '2px solid #4285f4',
          borderRadius: '2px',
          transform: `rotate(${element.rotation}deg)`,
          transformOrigin: 'top left',
          pointerEvents: 'none',
          zIndex: 1002,
          boxSizing: 'border-box',
        }}
      />

      <textarea
        ref={textareaRef}
        style={{
          position: 'absolute',
          left: `${left}px`,
          top: `${top}px`,
          width: `${width}px`,
          height: `${height}px`,
          fontSize: `${element.style.fontSize * zoom}px`,
          fontFamily: element.style.fontFamily,
          fontWeight: element.style.fontWeight,
          fontStyle: element.style.fontStyle,
          color: element.style.color,
          textAlign: element.style.align,
          lineHeight: element.style.lineHeight,
          background: 'transparent',
          border: 'none',
          outline: 'none',
          resize: 'none',
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
