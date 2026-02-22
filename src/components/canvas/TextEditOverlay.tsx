import React, { useRef, useEffect, useCallback, useState } from 'react';
import { useEditorStore } from '../../store/editorStore';
import { usePresentationStore } from '../../store/presentationStore';
import { computeGuides, type Guide } from '../../hooks/useAlignmentGuides';
import { getMarginLayout, getMarginBounds } from '../../utils/marginLayouts';
import type { TextElement } from '../../types/presentation';
import { CANVAS_PADDING } from '../../utils/constants';

interface Props {
  stageRef: React.RefObject<HTMLDivElement | null>;
  zoom: number;
  onGuides?: (guides: Guide[]) => void;
}

/**
 * Calculate the cursor position (character index) from a click position within a text element.
 */
function calculateCursorPosition(element: TextElement, clickPos: { x: number; y: number }): number {
  const { text, width, style } = element;
  const { fontSize, fontFamily, fontWeight, lineHeight, align, verticalAlign } = style;
  const padding = 4;

  if (!text) return 0;

  // Create a canvas to measure text
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) return 0;

  ctx.font = `${fontWeight === 'bold' ? 'bold ' : ''}${fontSize}px ${fontFamily}`;

  const lines = text.split('\n');
  const lineHeightPx = fontSize * (lineHeight || 1.2);
  const totalTextHeight = lines.length * lineHeightPx;
  const contentWidth = width - padding * 2;
  const contentHeight = element.height - padding * 2;

  // Calculate vertical offset based on verticalAlign
  let textStartY = padding;
  if (verticalAlign === 'middle') {
    textStartY = padding + (contentHeight - totalTextHeight) / 2;
  } else if (verticalAlign === 'bottom') {
    textStartY = padding + contentHeight - totalTextHeight;
  }

  // Find which line was clicked
  const clickY = clickPos.y - textStartY;
  let lineIndex = Math.floor(clickY / lineHeightPx);
  lineIndex = Math.max(0, Math.min(lines.length - 1, lineIndex));

  // Calculate horizontal offset for this line based on align
  const line = lines[lineIndex];
  const lineWidth = ctx.measureText(line).width;

  let lineStartX = padding;
  if (align === 'center') {
    lineStartX = padding + (contentWidth - lineWidth) / 2;
  } else if (align === 'right') {
    lineStartX = padding + contentWidth - lineWidth;
  }

  // Find which character was clicked
  const clickX = clickPos.x - lineStartX;
  let charIndex = 0;
  let accumulatedWidth = 0;

  for (let i = 0; i < line.length; i++) {
    const charWidth = ctx.measureText(line[i]).width;
    if (accumulatedWidth + charWidth / 2 > clickX) {
      break;
    }
    accumulatedWidth += charWidth;
    charIndex++;
  }

  // Convert to absolute position in the full text
  let absolutePos = 0;
  for (let i = 0; i < lineIndex; i++) {
    absolutePos += lines[i].length + 1; // +1 for newline
  }
  absolutePos += charIndex;

  return Math.min(absolutePos, text.length);
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

      // If we have a click position, calculate cursor position; otherwise select all (e.g., for new text)
      if (textEditClickPosition && element.text) {
        const cursorPos = calculateCursorPosition(element, textEditClickPosition);
        textareaRef.current.selectionStart = cursorPos;
        textareaRef.current.selectionEnd = cursorPos;
      } else {
        textareaRef.current.select();
      }
    }
  }, [element, textEditClickPosition]);

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

      <textarea
        ref={textareaRef}
        style={{
          position: 'absolute',
          left: `${left}px`,
          top: `${top}px`,
          width: `${width}px`,
          height: `${height}px`,
          padding: `${4 * zoom}px`,
          boxSizing: 'border-box',
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
