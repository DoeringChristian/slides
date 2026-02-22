import React, { useRef, useEffect, useCallback } from 'react';
import type { TextElement } from '../../types/presentation';
import { calculateCursorFromClick as calculateCursorFromClickUtil } from '../../utils/textHitTest';

interface Props {
  element: TextElement;
  zoom: number;
  onBlur: (text: string) => void;
  onEscape: () => void;
  clickPosition?: { x: number; y: number } | null;
}

interface LineInfo {
  text: string;
  type: 'h1' | 'h2' | 'h3' | 'bullet' | 'numbered' | 'normal';
  fontSizeMultiplier: number;
}

function parseLine(line: string): LineInfo {
  if (line.startsWith('### ')) {
    return { text: line, type: 'h3', fontSizeMultiplier: 1.25 };
  }
  if (line.startsWith('## ')) {
    return { text: line, type: 'h2', fontSizeMultiplier: 1.5 };
  }
  if (line.startsWith('# ')) {
    return { text: line, type: 'h1', fontSizeMultiplier: 2 };
  }
  if (line.match(/^[\-\*]\s/)) {
    return { text: line, type: 'bullet', fontSizeMultiplier: 1 };
  }
  if (line.match(/^\d+\.\s/)) {
    return { text: line, type: 'numbered', fontSizeMultiplier: 1 };
  }
  return { text: line, type: 'normal', fontSizeMultiplier: 1 };
}

export const MarkdownEditor: React.FC<Props> = ({
  element,
  zoom,
  onBlur,
  onEscape,
  clickPosition,
}) => {
  const { text, style } = element;
  const editorRef = useRef<HTMLDivElement>(null);
  const isInitializedRef = useRef(false);
  const currentTextRef = useRef(text);

  const baseFontSize = style.fontSize * zoom;
  const padding = 4 * zoom;

  // Get the current text from the editor
  const getTextFromEditor = useCallback((): string => {
    if (!editorRef.current) return '';

    const lines: string[] = [];
    const divs = editorRef.current.querySelectorAll('div[data-line]');

    if (divs.length === 0) {
      // Fallback for empty or simple content
      return editorRef.current.textContent || '';
    }

    divs.forEach((div) => {
      // Check for BR which means empty line
      if (div.querySelector('br') && div.childNodes.length === 1) {
        lines.push('');
      } else {
        lines.push(div.textContent || '');
      }
    });

    return lines.join('\n');
  }, []);

  // Render the text as formatted HTML
  const renderText = useCallback((plainText: string) => {
    if (!editorRef.current) return;

    const lines = plainText.split('\n');
    const html = lines.map((line, index) => {
      const lineInfo = parseLine(line);
      const fontSize = baseFontSize * lineInfo.fontSizeMultiplier;
      const fontWeight = lineInfo.type.startsWith('h') ? 'bold' : 'inherit';

      const escapedLine = line
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');

      return `<div data-line="${index}" style="font-size: ${fontSize}px; font-weight: ${fontWeight}; min-height: ${fontSize * (style.lineHeight || 1.2)}px;">${escapedLine || '<br>'}</div>`;
    }).join('');

    editorRef.current.innerHTML = html;
  }, [baseFontSize, style.lineHeight]);

  // Set cursor to a specific character offset
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
        // Empty line (contains only <br>)
        // If offset matches current position, place cursor here
        if (currentOffset === offset) {
          const range = document.createRange();
          range.setStart(div, 0);
          range.collapse(true);
          selection.removeAllRanges();
          selection.addRange(range);
          return;
        }
      }

      // Account for newline after this line (except for last line)
      if (i < divs.length - 1) {
        currentOffset += 1;
      }
    }

    // Fallback: put cursor at end of last div
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

  // Get current cursor position as character offset
  const getCursorPosition = useCallback((): number => {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0 || !editorRef.current) return 0;

    const range = selection.getRangeAt(0);
    let offset = 0;
    const divs = Array.from(editorRef.current.querySelectorAll('div[data-line]'));

    for (let i = 0; i < divs.length; i++) {
      const div = divs[i];
      if (div.contains(range.startContainer)) {
        // Found the line containing cursor
        const textNode = Array.from(div.childNodes).find(n => n.nodeType === Node.TEXT_NODE);
        if (textNode && textNode === range.startContainer) {
          offset += range.startOffset;
        } else if (range.startContainer === div || range.startContainer.nodeName === 'BR') {
          // Cursor is at div level or at BR (empty line)
          offset += 0;
        }
        break;
      }
      // Add length of this line
      const textContent = div.textContent || '';
      offset += textContent.length;
      // Add newline (except after last line)
      if (i < divs.length - 1) {
        offset += 1;
      }
    }

    return offset;
  }, []);

  // Initialize editor
  useEffect(() => {
    if (editorRef.current && !isInitializedRef.current) {
      currentTextRef.current = text;
      renderText(text);
      editorRef.current.focus();

      if (clickPosition && text) {
        // Use the external calculateCursorFromClick which handles rendered vs source mapping
        const cursorPos = calculateCursorFromClickUtil(element, clickPosition);
        setCursorPosition(cursorPos);
      } else {
        // Select all for new/empty text
        const selection = window.getSelection();
        const range = document.createRange();
        range.selectNodeContents(editorRef.current);
        selection?.removeAllRanges();
        selection?.addRange(range);
      }

      isInitializedRef.current = true;
    }
  }, [text, element, renderText, clickPosition, setCursorPosition]);

  const handleInput = useCallback(() => {
    if (!editorRef.current) return;

    // Save cursor position
    const cursorPos = getCursorPosition();

    // Get and save current text
    const newText = getTextFromEditor();
    currentTextRef.current = newText;

    // Re-render with formatting
    renderText(newText);

    // Restore cursor
    setCursorPosition(cursorPos);
  }, [getTextFromEditor, renderText, getCursorPosition, setCursorPosition]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onEscape();
      return;
    }

    if (e.key === 'Enter') {
      e.preventDefault();

      // Get current cursor position
      const cursorPos = getCursorPosition();
      const currentText = currentTextRef.current;

      // Insert newline at cursor position
      const newText = currentText.slice(0, cursorPos) + '\n' + currentText.slice(cursorPos);
      currentTextRef.current = newText;

      // Re-render
      renderText(newText);

      // Place cursor after the newline
      setCursorPosition(cursorPos + 1);
      return;
    }

    e.stopPropagation();
  }, [onEscape, getCursorPosition, renderText, setCursorPosition]);

  const handleBlur = useCallback(() => {
    if (editorRef.current) {
      const finalText = getTextFromEditor();
      onBlur(finalText);
    }
  }, [getTextFromEditor, onBlur]);

  return (
    <div
      ref={editorRef}
      contentEditable
      suppressContentEditableWarning
      onInput={handleInput}
      onBlur={handleBlur}
      onKeyDown={handleKeyDown}
      style={{
        width: '100%',
        height: '100%',
        padding: `${padding}px`,
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
      }}
    />
  );
};
