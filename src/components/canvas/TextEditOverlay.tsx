import React, { useRef, useEffect, useCallback } from 'react';
import { useEditorStore } from '../../store/editorStore';
import { usePresentationStore } from '../../store/presentationStore';
import { useActiveSlide } from '../../store/selectors';
import { TEXT_BOX_PADDING, CANVAS_PADDING } from '../../utils/constants';
import { calculateCursorFromClick } from '../../utils/textHitTest';
import type { TextElement } from '../../types/presentation';

interface Props {
  stageRef: React.RefObject<HTMLDivElement | null>;
  zoom: number;
}

export const TextEditOverlay: React.FC<Props> = ({ stageRef, zoom }) => {
  const editingTextId = useEditorStore((s) => s.editingTextId);
  const setEditingTextId = useEditorStore((s) => s.setEditingTextId);
  const activeSlideId = useEditorStore((s) => s.activeSlideId);
  const updateElement = usePresentationStore((s) => s.updateElement);
  const slide = useActiveSlide();

  const editorRef = useRef<HTMLDivElement>(null);
  const currentTextRef = useRef('');
  const mountTimeRef = useRef(Date.now());

  // Get the editing element
  const element = editingTextId ? slide?.elements[editingTextId] : null;
  const textElement = element && element.type === 'text' ? (element as TextElement) : null;

  // Parse line for styling
  const parseLine = useCallback((line: string) => {
    if (line.startsWith('### ')) {
      return { text: line, type: 'h3', fontSizeMultiplier: 1.25 };
    }
    if (line.startsWith('## ')) {
      return { text: line, type: 'h2', fontSizeMultiplier: 1.5 };
    }
    if (line.startsWith('# ')) {
      return { text: line, type: 'h1', fontSizeMultiplier: 2 };
    }
    return { text: line, type: 'normal', fontSizeMultiplier: 1 };
  }, []);

  // Get text from editor
  const getTextFromEditor = useCallback((): string => {
    if (!editorRef.current) return '';

    const lines: string[] = [];
    const divs = editorRef.current.querySelectorAll('div[data-line]');

    if (divs.length === 0) {
      return editorRef.current.textContent || '';
    }

    divs.forEach((div) => {
      if (div.querySelector('br') && div.childNodes.length === 1) {
        lines.push('');
      } else {
        lines.push(div.textContent || '');
      }
    });

    return lines.join('\n');
  }, []);

  // Render text as formatted HTML
  const renderText = useCallback((plainText: string, style: TextElement['style']) => {
    if (!editorRef.current) return;

    const baseFontSize = style.fontSize * zoom;
    const lines = plainText.split('\n');
    const html = lines.map((line, index) => {
      const lineInfo = parseLine(line);
      const fontSize = baseFontSize * lineInfo.fontSizeMultiplier;
      const fontWeight = lineInfo.type.startsWith('h') ? 'bold' : 'inherit';

      const escapedLine = line
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');

      return `<div data-line="${index}" style="margin: 0; padding: 0; font-size: ${fontSize}px; font-weight: ${fontWeight}; line-height: ${style.lineHeight || 1.2}; min-height: ${fontSize * (style.lineHeight || 1.2)}px;">${escapedLine || '<br>'}</div>`;
    }).join('');

    editorRef.current.innerHTML = html;
  }, [zoom, parseLine]);

  // Get cursor position
  const getCursorPosition = useCallback((): number => {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0 || !editorRef.current) return 0;

    const range = selection.getRangeAt(0);
    let offset = 0;
    const divs = Array.from(editorRef.current.querySelectorAll('div[data-line]'));

    for (let i = 0; i < divs.length; i++) {
      const div = divs[i];
      if (div.contains(range.startContainer)) {
        const textNode = Array.from(div.childNodes).find(n => n.nodeType === Node.TEXT_NODE);
        if (textNode && textNode === range.startContainer) {
          offset += range.startOffset;
        }
        break;
      }
      offset += (div.textContent || '').length;
      if (i < divs.length - 1) {
        offset += 1; // newline
      }
    }

    return offset;
  }, []);

  // Set cursor position
  const setCursorPosition = useCallback((offset: number) => {
    if (!editorRef.current) return;

    const selection = window.getSelection();
    if (!selection) return;

    let currentOffset = 0;
    const divs = Array.from(editorRef.current.querySelectorAll('div[data-line]'));

    for (let i = 0; i < divs.length; i++) {
      const div = divs[i];
      const textNode = Array.from(div.childNodes).find(n => n.nodeType === Node.TEXT_NODE);

      if (textNode) {
        const nodeLength = textNode.textContent?.length || 0;
        if (currentOffset + nodeLength >= offset) {
          const range = document.createRange();
          range.setStart(textNode, offset - currentOffset);
          range.collapse(true);
          selection.removeAllRanges();
          selection.addRange(range);
          return;
        }
        currentOffset += nodeLength;
      } else {
        if (currentOffset === offset) {
          const range = document.createRange();
          range.setStart(div, 0);
          range.collapse(true);
          selection.removeAllRanges();
          selection.addRange(range);
          return;
        }
      }

      if (i < divs.length - 1) {
        currentOffset += 1;
      }
    }

    // Fallback: end of last div
    if (divs.length > 0) {
      const lastDiv = divs[divs.length - 1];
      const textNode = Array.from(lastDiv.childNodes).find(n => n.nodeType === Node.TEXT_NODE);
      const range = document.createRange();
      if (textNode) {
        range.setStart(textNode, textNode.textContent?.length || 0);
      } else {
        range.setStart(lastDiv, 0);
      }
      range.collapse(true);
      selection.removeAllRanges();
      selection.addRange(range);
    }
  }, []);

  // Initialize editor when entering edit mode
  const prevEditingIdRef = useRef<string | null>(null);
  useEffect(() => {
    // Only initialize when editingTextId changes to a new value (entering edit mode)
    if (editingTextId === prevEditingIdRef.current) return;
    prevEditingIdRef.current = editingTextId;

    if (!editingTextId || !textElement || !editorRef.current) return;

    const text = textElement.text || '';
    currentTextRef.current = text;
    mountTimeRef.current = Date.now();
    renderText(text, textElement.style);

    // Focus and set cursor - use setTimeout to ensure DOM is ready
    const timer = setTimeout(() => {
      if (!editorRef.current) return;
      editorRef.current.focus();

      // Re-read click position from store
      const clickPos = useEditorStore.getState().textEditClickPosition;
      const cursorPos = clickPos && textElement
        ? calculateCursorFromClick(textElement, clickPos)
        : null;

      if (cursorPos !== null && text) {
        // Place cursor at click position
        setCursorPosition(cursorPos);
      } else if (text) {
        // No click position (new element or programmatic edit) - select all
        // Use a small delay after focus to ensure selection works
        requestAnimationFrame(() => {
          if (!editorRef.current) return;
          const selection = window.getSelection();
          if (selection) {
            const range = document.createRange();
            range.selectNodeContents(editorRef.current);
            selection.removeAllRanges();
            selection.addRange(range);
          }
        });
      }
    }, 10);

    return () => clearTimeout(timer);
  }, [editingTextId, textElement, renderText, setCursorPosition]);

  // Re-render text when zoom changes during editing
  useEffect(() => {
    if (!editingTextId || !textElement || !editorRef.current) return;
    // Skip initial mount (handled by the editingTextId effect)
    if (editingTextId !== prevEditingIdRef.current) return;

    const cursorPos = getCursorPosition();
    renderText(currentTextRef.current, textElement.style);
    setCursorPosition(cursorPos);
  }, [zoom, editingTextId, textElement, renderText, getCursorPosition, setCursorPosition]);

  // Handle input
  const handleInput = useCallback(() => {
    if (!editorRef.current || !textElement) return;

    const cursorPos = getCursorPosition();
    const newText = getTextFromEditor();
    currentTextRef.current = newText;

    renderText(newText, textElement.style);
    setCursorPosition(cursorPos);
  }, [getTextFromEditor, renderText, getCursorPosition, setCursorPosition, textElement]);

  // Handle keydown
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      if (activeSlideId && editingTextId) {
        updateElement(activeSlideId, editingTextId, { text: currentTextRef.current });
      }
      setEditingTextId(null);
      return;
    }

    if (e.key === 'Enter') {
      e.preventDefault();

      const cursorPos = getCursorPosition();
      const currentText = currentTextRef.current;

      // Find current line
      const textBeforeCursor = currentText.slice(0, cursorPos);
      const lastNewlineIndex = textBeforeCursor.lastIndexOf('\n');
      const currentLineStart = lastNewlineIndex + 1;
      const currentLine = currentText.slice(currentLineStart, cursorPos);

      // Check for list items
      const bulletMatch = currentLine.match(/^([-*])\s/);
      const numberedMatch = currentLine.match(/^(\d+)\.\s/);

      let insertText = '\n';
      let newCursorOffset = 1;

      if (bulletMatch) {
        const bulletChar = bulletMatch[1];
        const contentAfterPrefix = currentLine.slice(2).trim();

        if (contentAfterPrefix === '') {
          const newText = currentText.slice(0, currentLineStart) + currentText.slice(cursorPos);
          currentTextRef.current = newText;
          if (textElement) renderText(newText, textElement.style);
          setCursorPosition(currentLineStart);
          return;
        }

        insertText = `\n${bulletChar} `;
        newCursorOffset = insertText.length;
      } else if (numberedMatch) {
        const currentNum = parseInt(numberedMatch[1], 10);
        const contentAfterPrefix = currentLine.slice(numberedMatch[0].length).trim();

        if (contentAfterPrefix === '') {
          const newText = currentText.slice(0, currentLineStart) + currentText.slice(cursorPos);
          currentTextRef.current = newText;
          if (textElement) renderText(newText, textElement.style);
          setCursorPosition(currentLineStart);
          return;
        }

        insertText = `\n${currentNum + 1}. `;
        newCursorOffset = insertText.length;
      }

      const newText = currentText.slice(0, cursorPos) + insertText + currentText.slice(cursorPos);
      currentTextRef.current = newText;

      if (textElement) renderText(newText, textElement.style);
      setCursorPosition(cursorPos + newCursorOffset);
      return;
    }

    e.stopPropagation();
  }, [activeSlideId, editingTextId, updateElement, setEditingTextId, getCursorPosition, renderText, setCursorPosition, textElement]);

  // Handle blur
  const handleBlur = useCallback(() => {
    // Ignore blur within 200ms of mount
    if (Date.now() - mountTimeRef.current < 200) return;

    if (activeSlideId && editingTextId) {
      const finalText = getTextFromEditor();
      updateElement(activeSlideId, editingTextId, { text: finalText });
    }
    setEditingTextId(null);
  }, [activeSlideId, editingTextId, updateElement, setEditingTextId, getTextFromEditor]);

  if (!textElement || !stageRef.current) return null;

  const { style } = textElement;
  const padding = TEXT_BOX_PADDING * zoom;

  // Calculate content height for vertical alignment
  const text = textElement.text || '';
  const lines = text.split('\n');
  let totalContentHeight = 0;
  for (const line of lines) {
    const lineInfo = parseLine(line);
    const fontSize = style.fontSize * zoom * lineInfo.fontSizeMultiplier;
    totalContentHeight += fontSize * (style.lineHeight || 1.2);
  }

  // Calculate vertical offset based on alignment
  const contentAreaHeight = textElement.height * zoom - padding * 2;
  let paddingTop = padding;
  if (style.verticalAlign === 'middle') {
    paddingTop = padding + Math.max(0, (contentAreaHeight - totalContentHeight) / 2);
  } else if (style.verticalAlign === 'bottom') {
    paddingTop = padding + Math.max(0, contentAreaHeight - totalContentHeight);
  }

  // Account for canvas padding - SVG viewBox starts at -CANVAS_PADDING
  // so element at SVG coordinate (0,0) appears at pixel (CANVAS_PADDING * zoom, CANVAS_PADDING * zoom)
  const offsetX = (textElement.x + CANVAS_PADDING) * zoom;
  const offsetY = (textElement.y + CANVAS_PADDING) * zoom;

  // Vertical alignment offset (beyond base padding)
  const verticalAlignOffset = paddingTop - padding;

  return (
    <div
      style={{
        position: 'absolute',
        left: offsetX,
        top: offsetY,
        width: textElement.width * zoom,
        height: textElement.height * zoom,
        transform: textElement.rotation ? `rotate(${textElement.rotation}deg)` : undefined,
        transformOrigin: 'center center',
        zIndex: 1000,
        // Let clicks on border pass through to SVG for dragging
        pointerEvents: 'none',
      }}
    >
      <div
        ref={editorRef}
        contentEditable
        suppressContentEditableWarning
        onInput={handleInput}
        onBlur={handleBlur}
        onKeyDown={handleKeyDown}
        style={{
          position: 'absolute',
          left: padding,
          top: padding,
          width: textElement.width * zoom - padding * 2,
          height: textElement.height * zoom - padding * 2,
          paddingTop: `${verticalAlignOffset}px`,
          paddingLeft: 0,
          paddingRight: 0,
          paddingBottom: 0,
          boxSizing: 'border-box',
          fontFamily: style.fontFamily,
          fontWeight: style.fontWeight,
          fontStyle: style.fontStyle,
          color: style.color,
          textAlign: style.align,
          lineHeight: style.lineHeight,
          background: 'transparent',
          border: 'none',
          outline: 'none',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          overflow: 'hidden',
          cursor: 'text',
          // Enable pointer events on the contentEditable (parent has pointerEvents: none)
          pointerEvents: 'auto',
        }}
      />
    </div>
  );
};
