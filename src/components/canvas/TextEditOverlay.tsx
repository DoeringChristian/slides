import React, { useRef, useEffect, useCallback, useState, useMemo } from 'react';
import { useEditorStore } from '../../store/editorStore';
import { usePresentationStore } from '../../store/presentationStore';
import { useActiveSlide } from '../../store/selectors';
import { TEXT_BOX_PADDING, CANVAS_PADDING } from '../../utils/constants';
import { calculateCursorFromClick } from '../../utils/textHitTest';
import { layoutSvgText, type SvgTextDoc } from '../../utils/textLayout';
import { SVGTextPaths } from '../svg/SVGTextPaths';
import { injectInterFontFace } from '../../utils/glyphPaths';
import type { TextElement } from '../../types/presentation';

// Inject the InterEdit @font-face so the contentEditable uses the SAME font
// the SVG renderer reads via opentype.js. The browser shapes characters with
// it (advance widths from font tables) → caret X lines up with SVG glyphs.
injectInterFontFace();

interface Props {
  stageRef: React.RefObject<HTMLDivElement | null>;
  zoom: number;
}

/**
 * Edit-mode overlay that uses the EXACT same renderer as the steady frame
 * (SVGTextPaths) for EVERY line, formatted or not. A fully-transparent
 * contentEditable underneath holds the editable raw text and the caret.
 *
 *   SVG layer (on top, pointer-events: none): SVGTextPaths with
 *     `rawLineIndices = rawLines` — cursor / selected lines are laid out as
 *     raw source (markdown delimiters visible) so the user can edit them.
 *     Every line uses the same font, weight, baseline, and line metrics.
 *   contentEditable (below): one <div data-line="N"> per source line, sized
 *     from doc.lines so the browser's text layout places the caret over the
 *     SVG glyphs. The text is always color: transparent; the SVG is the
 *     only thing the user sees. Kerning is disabled to match opentype.js.
 *
 * The old per-line markdown-to-HTML rendering, KaTeX/MathJax fallback, and
 * per-line cache are gone — the production renderer is the only renderer.
 */
export const TextEditOverlay: React.FC<Props> = ({ stageRef, zoom }) => {
  const editingTextId = useEditorStore((s) => s.editingTextId);
  const setEditingTextId = useEditorStore((s) => s.setEditingTextId);
  const activeSlideId = useEditorStore((s) => s.activeSlideId);
  const updateElement = usePresentationStore((s) => s.updateElement);
  const slide = useActiveSlide();

  const editorRef = useRef<HTMLDivElement>(null);
  const currentTextRef = useRef('');
  const mountTimeRef = useRef(Date.now());
  const editingTextIdRef = useRef<string | null>(null);
  const activeSlideIdRef = useRef<string>(activeSlideId);
  const rawLinesRef = useRef<Set<number>>(new Set());
  const [rawLines, setRawLinesState] = useState<Set<number>>(new Set());
  const setRawLines = (next: Set<number>) => {
    rawLinesRef.current = next;
    setRawLinesState(next);
  };
  // Live local copy of the editable text. Drives the SVG re-layout on every
  // keystroke (the store is only written back when the line / element
  // changes, which is way too coarse for "show my edit immediately").
  const [liveText, setLiveText] = useState('');
  // Mirror for use inside ref-based callbacks (so they don't capture stale
  // closures of liveText across renders).
  const liveTextRef = useRef('');
  liveTextRef.current = liveText;

  activeSlideIdRef.current = activeSlideId;

  // Save text whenever editingTextId changes away from a value.
  useEffect(() => {
    editingTextIdRef.current = editingTextId;
    return () => {
      const prevId = editingTextIdRef.current;
      const slideId = activeSlideIdRef.current;
      if (prevId && slideId) {
        const text = currentTextRef.current;
        usePresentationStore.getState().updateElement(slideId, prevId, { text });
      }
    };
  }, [editingTextId]);

  // Get the editing element
  const element = editingTextId ? slide?.elements[editingTextId] : null;
  const textElement = element && element.type === 'text' ? (element as TextElement) : null;

  // Layout doc from the SVG renderer (cached per text + style + width + raw
  // line set). We pre-compute it from `liveText` so per-line yTop/yBottom
  // reflect the user's latest typing; SVGTextPaths' onLayout also publishes
  // the doc, but pulling it directly avoids a render lag.
  const [doc, setDoc] = useState<SvgTextDoc | null>(null);
  const layoutWidth = textElement
    ? Math.max(1, textElement.width - TEXT_BOX_PADDING * 2)
    : 1;
  const rawKeyForLayout = useMemo(
    () => Array.from(rawLines).sort((a, b) => a - b).join(','),
    [rawLines],
  );
  useEffect(() => {
    if (!textElement) return;
    let cancelled = false;
    layoutSvgText(liveText, textElement.style, layoutWidth, rawLines).then(
      (d) => { if (!cancelled) setDoc(d); },
      (err) => { if (!cancelled) console.warn('[TextEditOverlay] layout failed', err); },
    );
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveText, textElement?.style.fontSize, textElement?.style.fontWeight, textElement?.style.fontStyle, textElement?.style.color, textElement?.style.lineHeight, textElement?.style.align, layoutWidth, rawKeyForLayout]);

  // Build per-source-line start offsets from the latest text (read at call
  // time via the ref so we never use a stale snapshot from a previous render).
  const computeLineStartOffsets = (text: string): number[] => {
    const lines = text.split('\n');
    const offs: number[] = [];
    let acc = 0;
    for (const ln of lines) { offs.push(acc); acc += ln.length + 1; }
    return offs;
  };

  // Translate the DOM selection to a source-text offset.
  const getCursorPosition = useCallback((): number => {
    const editor = editorRef.current;
    const selection = window.getSelection();
    if (!editor || !selection || selection.rangeCount === 0) return 0;
    const range = selection.getRangeAt(0);
    const divs = Array.from(editor.querySelectorAll('div[data-line]'));
    const offs = computeLineStartOffsets(liveTextRef.current);
    for (let i = 0; i < divs.length; i++) {
      const div = divs[i];
      if (div.contains(range.startContainer)) {
        return (offs[i] ?? 0) + range.startOffset;
      }
    }
    return 0;
  }, []);

  const setCursorPosition = useCallback((offset: number) => {
    const editor = editorRef.current;
    if (!editor) return;
    const selection = window.getSelection();
    if (!selection) return;
    const divs = Array.from(editor.querySelectorAll('div[data-line]'));
    const offs = computeLineStartOffsets(liveTextRef.current);
    for (let i = 0; i < divs.length; i++) {
      const div = divs[i];
      const start = offs[i] ?? 0;
      const end = i + 1 < offs.length ? offs[i + 1] - 1 : start + (div.textContent || '').length;
      if (offset <= end) {
        const col = Math.max(0, offset - start);
        const textNode = Array.from(div.childNodes).find((n) => n.nodeType === Node.TEXT_NODE);
        const range = document.createRange();
        if (textNode) {
          const len = textNode.textContent?.length ?? 0;
          range.setStart(textNode, Math.min(col, len));
        } else {
          range.setStart(div, 0);
        }
        range.collapse(true);
        selection.removeAllRanges();
        selection.addRange(range);
        return;
      }
    }
  }, []);

  // Snapshot raw source by joining each line div's textContent.
  const getTextFromEditor = useCallback((): string => {
    const editor = editorRef.current;
    if (!editor) return '';
    const divs = editor.querySelectorAll('div[data-line]');
    if (divs.length === 0) return editor.textContent || '';
    const lines: string[] = [];
    divs.forEach((div) => {
      if (div.querySelector('br') && div.childNodes.length === 1) lines.push('');
      else lines.push(div.textContent || '');
    });
    return lines.join('\n');
  }, []);

  const lineFromOffset = useCallback((text: string, offset: number): number => {
    const upto = text.slice(0, offset);
    return upto.split('\n').length - 1;
  }, []);

  // Mount: seed liveText, currentText, raw-line set, cursor.
  const prevEditingIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (editingTextId === prevEditingIdRef.current) return;
    prevEditingIdRef.current = editingTextId;
    if (!editingTextId || !textElement || !editorRef.current) return;

    const text = textElement.text || '';
    currentTextRef.current = text;
    setLiveText(text);
    mountTimeRef.current = Date.now();

    const clickPos = useEditorStore.getState().textEditClickPosition;
    const initialCursor = clickPos
      ? (calculateCursorFromClick(textElement, clickPos) ?? text.length)
      : text.length;
    setRawLines(new Set([lineFromOffset(text, initialCursor)]));

    const timer = setTimeout(() => {
      if (!editorRef.current) return;
      editorRef.current.focus();
      if (text) setCursorPosition(initialCursor);
      else {
        const selection = window.getSelection();
        if (selection && editorRef.current) {
          const range = document.createRange();
          range.selectNodeContents(editorRef.current);
          selection.removeAllRanges();
          selection.addRange(range);
        }
      }
    }, 10);
    return () => clearTimeout(timer);
  }, [editingTextId, textElement, setCursorPosition, lineFromOffset]);

  // Track which lines are raw via the DOM (range start / end → line indices).
  useEffect(() => {
    if (!editingTextId) return;
    const handle = () => {
      if (!editorRef.current) return;
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0) return;
      if (!editorRef.current.contains(sel.anchorNode)) return;
      const range = sel.getRangeAt(0);
      const divs = Array.from(editorRef.current.querySelectorAll('div[data-line]'));
      let startLine = -1, endLine = -1;
      for (let i = 0; i < divs.length; i++) {
        if (divs[i].contains(range.startContainer)) startLine = i;
        if (divs[i].contains(range.endContainer)) endLine = i;
        if (startLine >= 0 && endLine >= 0) break;
      }
      if (startLine < 0) return;
      const next = new Set<number>();
      const lo = Math.min(startLine, endLine);
      const hi = Math.max(startLine, endLine);
      for (let i = lo; i <= hi; i++) next.add(i);
      const prev = rawLinesRef.current;
      if (prev.size === next.size) {
        let same = true;
        for (const v of next) if (!prev.has(v)) { same = false; break; }
        if (same) return;
      }
      currentTextRef.current = getTextFromEditor();
      setRawLines(next);
    };
    document.addEventListener('selectionchange', handle);
    return () => document.removeEventListener('selectionchange', handle);
  }, [editingTextId, getTextFromEditor]);

  useEffect(() => {
    if (!editingTextId) return;
    if (typeof window === 'undefined' || !window.visualViewport) return;
    const vv = window.visualViewport;
    const handle = () => {
      const el = editorRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      if (rect.bottom > vv.offsetTop + vv.height || rect.top < vv.offsetTop) {
        el.scrollIntoView({ block: 'center', behavior: 'smooth' });
      }
    };
    handle();
    vv.addEventListener('resize', handle);
    return () => vv.removeEventListener('resize', handle);
  }, [editingTextId]);

  const handleInput = useCallback(() => {
    if (!editorRef.current || !textElement) return;
    const text = getTextFromEditor();
    currentTextRef.current = text;
    // Push EVERY keystroke into liveText so the SVG layer re-lays out
    // immediately. Without this, the SVG stayed pinned to the store's text
    // (only written on line-change) and edits weren't visible until the user
    // moved off the line.
    setLiveText(text);
  }, [getTextFromEditor, textElement]);

  const handleEditorMouseDown = useCallback((e: React.MouseEvent) => {
    const editor = editorRef.current;
    if (!editor) return;
    let target = e.target as HTMLElement | null;
    while (target && target !== editor && !target.hasAttribute?.('data-line')) {
      target = target.parentElement;
    }
    if (!target || target === editor || !target.hasAttribute('data-line')) return;
    const idx = parseInt(target.getAttribute('data-line') || '-1', 10);
    if (idx < 0 || rawLinesRef.current.has(idx)) return;
    // Let the native click do the work — it'll land in the (transparent) text
    // node of the line div. selectionchange picks up the new line and adds it
    // to the raw set, which un-hides the text in the same render cycle.
  }, []);

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
      // Enter creates a new SOURCE line, which in our line-div model means a
      // new <div data-line="N+1"> from React. execCommand('insertText','\n')
      // would jam the \n into the current div instead; manage it ourselves.
      const cursorPos = getCursorPosition();
      const currentText = currentTextRef.current;
      const textBeforeCursor = currentText.slice(0, cursorPos);
      const lastNewlineIndex = textBeforeCursor.lastIndexOf('\n');
      const currentLineStart = lastNewlineIndex + 1;
      const currentLine = currentText.slice(currentLineStart, cursorPos);
      const bulletMatch = currentLine.match(/^([-*])\s/);
      const numberedMatch = currentLine.match(/^(\d+)\.\s/);
      let insertText = '\n';
      let newCursorOffset = 1;
      if (bulletMatch) {
        const after = currentLine.slice(2).trim();
        if (after === '') {
          const newText = currentText.slice(0, currentLineStart) + currentText.slice(cursorPos);
          currentTextRef.current = newText;
          setLiveText(newText);
          requestAnimationFrame(() => setCursorPosition(currentLineStart));
          return;
        }
        insertText = `\n${bulletMatch[1]} `;
        newCursorOffset = insertText.length;
      } else if (numberedMatch) {
        const after = currentLine.slice(numberedMatch[0].length).trim();
        if (after === '') {
          const newText = currentText.slice(0, currentLineStart) + currentText.slice(cursorPos);
          currentTextRef.current = newText;
          setLiveText(newText);
          requestAnimationFrame(() => setCursorPosition(currentLineStart));
          return;
        }
        const currentNum = parseInt(numberedMatch[1], 10);
        insertText = `\n${currentNum + 1}. `;
        newCursorOffset = insertText.length;
      }
      const newText = currentText.slice(0, cursorPos) + insertText + currentText.slice(cursorPos);
      currentTextRef.current = newText;
      setLiveText(newText);
      requestAnimationFrame(() => setCursorPosition(cursorPos + newCursorOffset));
      return;
    }
    e.stopPropagation();
  }, [activeSlideId, editingTextId, updateElement, setEditingTextId, getCursorPosition, setCursorPosition]);

  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (items) {
      for (const item of Array.from(items)) {
        if (item.kind === 'file') return;
      }
    }
    e.preventDefault();
    const pastedText = e.clipboardData.getData('text/plain');
    if (!pastedText) return;
    // Same reason as Enter: if the pasted text contains \n we want new
    // <div data-line=...> elements, not a literal \n inside one div.
    const cursorPos = getCursorPosition();
    const currentText = currentTextRef.current;
    const newText = currentText.slice(0, cursorPos) + pastedText + currentText.slice(cursorPos);
    currentTextRef.current = newText;
    setLiveText(newText);
    requestAnimationFrame(() => setCursorPosition(cursorPos + pastedText.length));
  }, [getCursorPosition, setCursorPosition]);

  const handleBlur = useCallback(() => {
    if (Date.now() - mountTimeRef.current < 200) return;
    const slideId = activeSlideIdRef.current;
    const textId = editingTextIdRef.current;
    if (slideId && textId) {
      const finalText = getTextFromEditor();
      updateElement(slideId, textId, { text: finalText });
    }
    setEditingTextId(null);
  }, [updateElement, setEditingTextId, getTextFromEditor]);

  if (!textElement || !stageRef.current) return null;

  const { style } = textElement;
  const padding = TEXT_BOX_PADDING * zoom;
  const offsetX = (textElement.x + CANVAS_PADDING) * zoom;
  const offsetY = (textElement.y + CANVAS_PADDING) * zoom;
  const widthPx = textElement.width * zoom;
  const heightPx = textElement.height * zoom;

  // Vertical alignment offset based on doc.height (if available) so it
  // matches the SVG render exactly. Falls back to 0 while layout pending.
  const contentAreaHeight = textElement.height - TEXT_BOX_PADDING * 2;
  const docHeight = doc?.height ?? 0;
  let verticalOffset = 0;
  if (style.verticalAlign === 'middle') {
    verticalOffset = Math.max(0, (contentAreaHeight - docHeight) / 2);
  } else if (style.verticalAlign === 'bottom') {
    verticalOffset = Math.max(0, contentAreaHeight - docHeight);
  }

  // Source of truth for the contentEditable's rendered content is liveText
  // (updated synchronously on every keystroke). doc.lines is used for line
  // div HEIGHTS only — it lags by one async layout cycle, but heights are
  // visual-only and don't affect cursor X.
  const sourceLines = liveText.split('\n');
  const defaultLineHeight = style.fontSize * (style.lineHeight ?? 1.2);

  // Element passed to SVGTextPaths uses (x:0, y:0) so its internal
  // translate(elementX+padding, elementY+padding+verticalOffset) places the
  // text at (padding, padding+verticalOffset) inside our local viewBox.
  // text:liveText drives the SVG re-layout on every keystroke.
  const localElement: TextElement = { ...textElement, text: liveText, x: 0, y: 0 };

  return (
    <div
      style={{
        position: 'absolute',
        left: offsetX,
        top: offsetY,
        width: widthPx,
        height: heightPx,
        transform: textElement.rotation ? `rotate(${textElement.rotation}deg)` : undefined,
        transformOrigin: 'center center',
        zIndex: 1000,
        pointerEvents: 'none',
      }}
    >
      {/* Rendered (SVG) layer — same renderer as the steady frame. */}
      <svg
        width={widthPx}
        height={heightPx}
        viewBox={`0 0 ${textElement.width} ${textElement.height}`}
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          pointerEvents: 'none',
          overflow: 'visible',
        }}
      >
        <SVGTextPaths
          element={localElement}
          rawLineIndices={rawLines}
          onLayout={setDoc}
        />
      </svg>

      {/* Input layer — contentEditable with one div per source line, sized to
          match the SVG layout. The text is ALWAYS transparent: the SVG above
          shows the rendered text (formatted on non-cursor lines, raw on
          cursor / selected lines). The contentEditable exists only to host
          the caret + keyboard input. */}
      <div
        ref={editorRef}
        contentEditable
        suppressContentEditableWarning
        onMouseDown={handleEditorMouseDown}
        onInput={handleInput}
        onBlur={handleBlur}
        onKeyDown={handleKeyDown}
        onPaste={handlePaste}
        style={{
          position: 'absolute',
          left: padding,
          top: padding + verticalOffset * zoom,
          width: widthPx - padding * 2,
          fontFamily: `'InterEdit', ${style.fontFamily}`,
          fontWeight: style.fontWeight,
          fontStyle: style.fontStyle,
          textAlign: style.align,
          background: 'transparent',
          border: 'none',
          outline: 'none',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          overflow: 'visible',
          cursor: 'text',
          caretColor: style.color,
          pointerEvents: 'auto',
          // Match the SVG renderer's text shaping: opentype.js emits glyph
          // advances without kerning, so disable browser kerning to keep the
          // caret X aligned with the SVG glyph positions.
          fontKerning: 'none',
          fontFeatureSettings: '"kern" 0',
          letterSpacing: 0,
        }}
      >
        {sourceLines.map((src, i) => {
          const ln = doc?.lines[i];
          // If liveText has more lines than doc.lines (new line just added,
          // layout not yet resolved), use a default body-line height. It'll
          // settle within one rAF.
          const heightForLine = ln
            ? (ln.yBottom - ln.yTop) * zoom
            : defaultLineHeight * zoom;
          const baseFontSize = style.fontSize * zoom;
          // Match the SVG renderer's heading multiplier so the line box and
          // the per-char advance widths line up; caret X is driven by browser
          // text layout in this font + size.
          const m =
            src.startsWith('### ') ? 1.25 :
            src.startsWith('## ') ? 1.5 :
            src.startsWith('# ') ? 2 : 1;
          const lineFontSize = baseFontSize * m;
          // IMPORTANT: render the div CHILDLESS at the React level. When the
          // user types into a contentEditable, the browser mutates the DOM
          // (e.g. replaces a <br> with a text node). If React's vDOM had a
          // <br> there, the next reconcile tries `removeChild(<br>)` on a
          // parent that no longer contains it, crashing. By rendering no
          // children and writing textContent imperatively via the ref, we
          // hand DOM ownership of each line div to the browser; React only
          // ever touches attributes/styles.
          return (
            <div
              key={i}
              data-line={i}
              ref={(el) => {
                if (!el) return;
                if (el.textContent !== src) el.textContent = src;
              }}
              style={{
                margin: 0,
                padding: 0,
                height: heightForLine,
                fontSize: lineFontSize,
                lineHeight: 1,
                color: 'transparent',
                fontWeight: m > 1 ? 'bold' : 'inherit',
              }}
            />
          );
        })}
      </div>
    </div>
  );
};
