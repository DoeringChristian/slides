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
  // changes, which is way too coarse for "show my edit immediately"). The
  // ref mirror lets ref-only callbacks read the latest value without
  // capturing a stale closure.
  const [liveText, setLiveText] = useState('');
  const liveTextRef = useRef('');
  liveTextRef.current = liveText;

  activeSlideIdRef.current = activeSlideId;

  // Save text back to the store whenever editingTextId changes away.
  useEffect(() => {
    editingTextIdRef.current = editingTextId;
    return () => {
      const prevId = editingTextIdRef.current;
      const slideId = activeSlideIdRef.current;
      if (prevId && slideId) {
        usePresentationStore.getState().updateElement(slideId, prevId, { text: liveTextRef.current });
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

  // (container, domOffset) → absolute source offset.
  const domToSourceOffset = useCallback((container: Node, domOffset: number): number => {
    const editor = editorRef.current;
    if (!editor) return 0;
    const divs = Array.from(editor.querySelectorAll('div[data-line]'));
    const offs = computeLineStartOffsets(liveTextRef.current);
    for (let i = 0; i < divs.length; i++) {
      if (divs[i].contains(container)) return (offs[i] ?? 0) + domOffset;
    }
    return 0;
  }, []);

  // Selection start/end as source offsets (sorted ascending).
  const getSelectionRange = useCallback((): [number, number] => {
    const editor = editorRef.current;
    const sel = window.getSelection();
    if (!editor || !sel || sel.rangeCount === 0) return [0, 0];
    const range = sel.getRangeAt(0);
    if (!editor.contains(range.startContainer)) return [0, 0];
    const a = domToSourceOffset(range.startContainer, range.startOffset);
    const b = domToSourceOffset(range.endContainer, range.endOffset);
    return a <= b ? [a, b] : [b, a];
  }, [domToSourceOffset]);

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

  // Mount: seed liveText, currentText, raw-line set, cursor. Resolves the
  // initial cursor position from the click that entered edit mode by asking
  // the SVG layout where the click landed (cache hit if the element was
  // rendered before this turn — which it always is, since the click was on
  // its rendered glyphs).
  const prevEditingIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (editingTextId === prevEditingIdRef.current) return;
    prevEditingIdRef.current = editingTextId;
    if (!editingTextId || !textElement || !editorRef.current) return;

    const text = textElement.text || '';
    setLiveText(text);
    mountTimeRef.current = Date.now();

    const clickPos = useEditorStore.getState().textEditClickPosition;
    let cancelled = false;
    const placeCursor = (initialCursor: number) => {
      if (cancelled) return;
      setRawLines(new Set([text.slice(0, initialCursor).split('\n').length - 1]));
      requestAnimationFrame(() => {
        if (cancelled || !editorRef.current) return;
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
      });
    };

    if (clickPos) {
      calculateCursorFromClick(textElement, clickPos).then(
        (cur) => placeCursor(cur ?? text.length),
        () => placeCursor(text.length),
      );
    } else {
      placeCursor(text.length);
    }
    return () => { cancelled = true; };
  }, [editingTextId, textElement, setCursorPosition]);

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
      setRawLines(next);
    };
    document.addEventListener('selectionchange', handle);
    return () => document.removeEventListener('selectionchange', handle);
  }, [editingTextId]);

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

  // Plain typing path: browser already mutated the text node inside one of
  // our line divs (single-line, structure unchanged) — just snapshot the
  // result into state so the SVG re-lays out.
  const handleInput = useCallback(() => {
    if (!editorRef.current || !textElement) return;
    setLiveText(getTextFromEditor());
  }, [getTextFromEditor, textElement]);

  // Replace liveText with newText and place the caret at newCursor on the
  // next frame (so React's commit of the new line divs has run).
  const replaceText = useCallback((newText: string, newCursor: number) => {
    setLiveText(newText);
    requestAnimationFrame(() => setCursorPosition(newCursor));
  }, [setCursorPosition]);

  // Apply an Enter at [selStart, selEnd], with bullet / numbered list
  // continuation: Enter at the end of `- ` or `1. ` autostarts the next item;
  // Enter on an empty list item clears the prefix.
  const applyEnter = useCallback((selStart: number, selEnd: number) => {
    const text = liveTextRef.current;
    const lineStart = text.slice(0, selStart).lastIndexOf('\n') + 1;
    const line = text.slice(lineStart, selStart);
    const bulletMatch = line.match(/^([-*])\s/);
    const numberedMatch = line.match(/^(\d+)\.\s/);

    const isEmptyBullet = bulletMatch && line.slice(2).trim() === '';
    const isEmptyNumbered = numberedMatch && line.slice(numberedMatch[0].length).trim() === '';
    if (selStart === selEnd && (isEmptyBullet || isEmptyNumbered)) {
      replaceText(text.slice(0, lineStart) + text.slice(selEnd), lineStart);
      return;
    }

    const insert = bulletMatch
      ? `\n${bulletMatch[1]} `
      : numberedMatch
        ? `\n${parseInt(numberedMatch[1], 10) + 1}. `
        : '\n';
    replaceText(
      text.slice(0, selStart) + insert + text.slice(selEnd),
      selStart + insert.length,
    );
  }, [replaceText]);

  // Browser-driven mutations route through this BEFORE the DOM is touched.
  // We intercept anything that would change line structure (Enter, line-
  // crossing deletes, multi-line selection replacement, cut, paste, drop)
  // and apply it through state instead; React stays in charge of the line-
  // div structure so its vDOM never falls out of sync with the DOM.
  //
  // Plain typing and char-level deletes within a line are left to the
  // browser — they only mutate a text node, not the line-div structure,
  // and handleInput picks up the result without React reconciling anything
  // structural.
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor || !editingTextId) return;
    const handler = (e: InputEvent) => {
      const inputType = e.inputType;
      const [selStart, selEnd] = getSelectionRange();
      const text = liveTextRef.current;
      const crossesLine = selStart !== selEnd && text.slice(selStart, selEnd).includes('\n');

      switch (inputType) {
        case 'insertParagraph':
        case 'insertLineBreak':
          e.preventDefault();
          applyEnter(selStart, selEnd);
          return;

        case 'deleteContentBackward':
          if (selStart === selEnd) {
            // At line start? Browser would merge divs — intercept.
            if (selStart > 0 && text[selStart - 1] === '\n') {
              e.preventDefault();
              replaceText(text.slice(0, selStart - 1) + text.slice(selStart), selStart - 1);
            }
          } else if (crossesLine) {
            e.preventDefault();
            replaceText(text.slice(0, selStart) + text.slice(selEnd), selStart);
          }
          return;

        case 'deleteContentForward':
          if (selStart === selEnd) {
            if (selStart < text.length && text[selStart] === '\n') {
              e.preventDefault();
              replaceText(text.slice(0, selStart) + text.slice(selStart + 1), selStart);
            }
          } else if (crossesLine) {
            e.preventDefault();
            replaceText(text.slice(0, selStart) + text.slice(selEnd), selStart);
          }
          return;

        case 'deleteByCut':
          if (crossesLine) {
            e.preventDefault();
            navigator.clipboard?.writeText(text.slice(selStart, selEnd)).catch(() => {});
            replaceText(text.slice(0, selStart) + text.slice(selEnd), selStart);
          }
          return;

        case 'insertText':
          if (crossesLine) {
            e.preventDefault();
            const data = e.data ?? '';
            replaceText(text.slice(0, selStart) + data + text.slice(selEnd), selStart + data.length);
          }
          return;

        case 'insertFromPaste':
        case 'insertFromDrop':
          // handlePaste (React onPaste) preventDefaults the paste path; this
          // catch is for drops, which we conservatively block to avoid HTML
          // payloads building rich nodes inside our contentEditable.
          if (inputType === 'insertFromDrop') {
            e.preventDefault();
            const data = e.data ?? '';
            if (data) replaceText(text.slice(0, selStart) + data + text.slice(selEnd), selStart + data.length);
          }
          return;

        default:
          // Any other inputType that targets a multi-line selection would
          // also wreck our structure; bail to a plain delete.
          if (crossesLine) {
            e.preventDefault();
            replaceText(text.slice(0, selStart) + text.slice(selEnd), selStart);
          }
      }
    };
    editor.addEventListener('beforeinput', handler);
    return () => editor.removeEventListener('beforeinput', handler);
  }, [editingTextId, getSelectionRange, applyEnter, replaceText]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      if (activeSlideId && editingTextId) {
        updateElement(activeSlideId, editingTextId, { text: liveTextRef.current });
      }
      setEditingTextId(null);
      return;
    }
    // Stop canvas-level hotkeys (e.g. Backspace deleting the selected
    // element) from firing while we're editing.
    e.stopPropagation();
  }, [activeSlideId, editingTextId, updateElement, setEditingTextId]);

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
    const [selStart, selEnd] = getSelectionRange();
    const text = liveTextRef.current;
    replaceText(
      text.slice(0, selStart) + pastedText + text.slice(selEnd),
      selStart + pastedText.length,
    );
  }, [getSelectionRange, replaceText]);

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
