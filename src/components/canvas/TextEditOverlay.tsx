import React, { useRef, useEffect, useCallback, useState } from 'react';
import { useEditorStore } from '../../store/editorStore';
import { usePresentationStore } from '../../store/presentationStore';
import { computeGuides, type Guide } from '../../hooks/useAlignmentGuides';
import { getMarginLayout, getMarginBounds } from '../../utils/marginLayouts';
import { MarkdownEditor } from './MarkdownEditor';
import type { TextElement } from '../../types/presentation';
import { CANVAS_PADDING } from '../../utils/constants';

interface Props {
  stageRef: React.RefObject<HTMLDivElement | null>;
  zoom: number;
  onGuides?: (guides: Guide[]) => void;
}

export const TextEditOverlay: React.FC<Props> = ({ stageRef, zoom, onGuides }) => {
  const editingTextId = useEditorStore((s) => s.editingTextId);
  const activeSlideId = useEditorStore((s) => s.activeSlideId);
  const setEditingTextId = useEditorStore((s) => s.setEditingTextId);
  const snapToGrid = useEditorStore((s) => s.snapToGrid);
  const marginLayoutId = useEditorStore((s) => s.marginLayoutId);
  const textEditClickPosition = useEditorStore((s) => s.textEditClickPosition);
  const updateElement = usePresentationStore((s) => s.updateElement);
  const slide = usePresentationStore((s) => s.presentation.slides[activeSlideId]);

  const dragStartRef = useRef<{ x: number; y: number; elemX: number; elemY: number } | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const element = editingTextId && slide ? slide.elements[editingTextId] as TextElement | undefined : undefined;

  const handleTextChange = useCallback((newText: string) => {
    if (editingTextId && activeSlideId) {
      updateElement(activeSlideId, editingTextId, { text: newText });
    }
    setEditingTextId(null);
  }, [editingTextId, activeSlideId, updateElement, setEditingTextId]);

  const handleEscape = useCallback(() => {
    setEditingTextId(null);
  }, [setEditingTextId]);

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
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (!dragStartRef.current || !activeSlideId || !editingTextId || !element) return;
      const dx = (e.clientX - dragStartRef.current.x) / zoom;
      const dy = (e.clientY - dragStartRef.current.y) / zoom;

      let newX = dragStartRef.current.elemX + dx;
      let newY = dragStartRef.current.elemY + dy;

      // Apply snapping if enabled
      if (snapToGrid && slide) {
        // Get other elements (excluding the current one)
        const others = Object.values(slide.elements)
          .filter((el) => el.id !== editingTextId && el.visible)
          .map((el) => ({ x: el.x, y: el.y, width: el.width, height: el.height }));

        // Get margin bounds
        const marginLayout = getMarginLayout(marginLayoutId);
        const marginBounds = marginLayout ? getMarginBounds(marginLayout) : null;

        // Create bounds for the dragged element at its tentative new position
        const draggedBounds = {
          x: newX,
          y: newY,
          width: element.width,
          height: element.height,
        };

        // Compute snapping
        const snapResult = computeGuides(draggedBounds, others, 5, marginBounds);

        // Apply snapped positions
        if (snapResult.snapX !== null) {
          newX = snapResult.snapX;
        }
        if (snapResult.snapY !== null) {
          newY = snapResult.snapY;
        }

        // Notify parent about guides
        onGuides?.(snapResult.guides);
      }

      updateElement(activeSlideId, editingTextId, {
        x: newX,
        y: newY,
      });
    };

    const handleMouseUp = () => {
      setIsDragging(false);
      dragStartRef.current = null;
      // Clear guides when drag ends
      onGuides?.([]);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, activeSlideId, editingTextId, updateElement, zoom, snapToGrid, marginLayoutId, element, slide, onGuides]);

  if (!element || !stageRef.current) return null;

  // Position text relative to the container with canvas padding
  const left = (element.x + CANVAS_PADDING) * zoom;
  const top = (element.y + CANVAS_PADDING) * zoom;
  const width = element.width * zoom;
  const height = element.height * zoom;

  // Drag handle dimensions - keep them narrow and inset to not block transformer resize handles
  const dragHandleThickness = 6;
  const cornerInset = 12; // Leave space for corner resize handles

  return (
    <div className="text-edit-overlay absolute" style={{ left: 0, top: 0, width: '100%', height: '100%', pointerEvents: 'none' }}>
      {/* Border drag handles - positioned around the textarea, inset from corners */}
      {/* Top border */}
      <div
        style={{
          position: 'absolute',
          left: `${left + cornerInset}px`,
          top: `${top - dragHandleThickness}px`,
          width: `${Math.max(0, width - cornerInset * 2)}px`,
          height: `${dragHandleThickness}px`,
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
          left: `${left + cornerInset}px`,
          top: `${top + height}px`,
          width: `${Math.max(0, width - cornerInset * 2)}px`,
          height: `${dragHandleThickness}px`,
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
          left: `${left - dragHandleThickness}px`,
          top: `${top + cornerInset}px`,
          width: `${dragHandleThickness}px`,
          height: `${Math.max(0, height - cornerInset * 2)}px`,
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
          top: `${top + cornerInset}px`,
          width: `${dragHandleThickness}px`,
          height: `${Math.max(0, height - cornerInset * 2)}px`,
          cursor: 'move',
          pointerEvents: 'auto',
          zIndex: 1001,
        }}
        onMouseDown={handleDragStart}
      />

      <div
        style={{
          position: 'absolute',
          left: `${left + width / 2}px`,
          top: `${top + height / 2}px`,
          width: `${width}px`,
          height: `${height}px`,
          transform: `translate(-50%, -50%) rotate(${element.rotation}deg)`,
          transformOrigin: 'center',
          pointerEvents: 'auto',
          zIndex: 1000,
        }}
      >
        <MarkdownEditor
          element={element}
          zoom={zoom}
          onBlur={handleTextChange}
          onEscape={handleEscape}
          clickPosition={textEditClickPosition}
        />
      </div>
    </div>
  );
};
