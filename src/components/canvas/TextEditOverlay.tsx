import React, { useRef, useEffect, useCallback, useState } from 'react';
import 'katex/dist/katex.min.css';
import { useEditorStore } from '../../store/editorStore';
import { usePresentationStore } from '../../store/presentationStore';
import { useActiveSlide } from '../../store/selectors';
import { TEXT_BOX_PADDING, CANVAS_PADDING } from '../../utils/constants';
import { calculateCursorFromClick } from '../../utils/textHitTest';
import { injectInterFontFace } from '../../utils/glyphPaths';
import { renderLatex } from '../../utils/latexUtils';
import { preloadMathJax, isMathJaxReady, texFragmentToSvgSync } from '../../services/latexToSvg';
import { parseInlineSegments } from './CustomMarkdownRenderer';
import type { TextElement } from '../../types/presentation';

// Match the steady SVG render: that path uses Inter regardless of the
// element's chosen font (Phase 2 unification). Wire the same TTFs into a
// @font-face so HTML edit mode can render them too, then force fontFamily =
// 'InterEdit' on the editor div so glyph metrics align across modes.
injectInterFontFace();
// Start MathJax loading right away so edit-mode math can render synchronously
// (matching the steady SVG render exactly) by the time the user enters an
// element. Fall back to KaTeX while it's still loading.
preloadMathJax();

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
  const editingTextIdRef = useRef<string | null>(null);
  const activeSlideIdRef = useRef<string>(activeSlideId);
  // Set of line indices that should render RAW (markup characters visible).
  // The cursor's line is always in this set; if the selection extends across
  // multiple lines, every covered line is added. Empty = nothing being edited.
  const rawLinesRef = useRef<Set<number>>(new Set());
  // Stays in sync via setRawLinesState for the few effects that close over a
  // snapshot value rather than the ref.
  const [, setRawLinesState] = useState<Set<number>>(new Set());
  const setRawLines = (next: Set<number>) => {
    rawLinesRef.current = next;
    setRawLinesState(next);
  };
  // Used by getTextFromEditor: per-line cursor-or-selection check.
  // We expose `isRawLine` rather than the set directly for clarity.
  const isRawLine = (i: number) => rawLinesRef.current.has(i) || rawLinesRef.current.size === 0;

  // True once MathJax has finished its async setup. Flipping this true
  // invalidates the line render cache so the visible math swaps from KaTeX
  // (the initial fallback) to MathJax to exactly match the steady SVG render.
  const [mathReady, setMathReady] = useState<boolean>(isMathJaxReady());
  useEffect(() => {
    if (mathReady) return;
    let cancelled = false;
    preloadMathJax().then(() => { if (!cancelled) setMathReady(true); });
    return () => { cancelled = true; };
  }, [mathReady]);

  // Keep activeSlideId ref in sync
  activeSlideIdRef.current = activeSlideId;

  // Save text whenever editingTextId changes away from a value.
  // This fires before the component unmounts or re-renders with a new ID,
  // so currentTextRef and editingTextIdRef still hold the previous values.
  useEffect(() => {
    // Update the ref to the current editing ID
    editingTextIdRef.current = editingTextId;

    return () => {
      // Cleanup: save text for the element we were editing
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

  // Map an absolute character offset within the multi-line source text to its
  // line index. Used at mount time and for the cursor-after-Enter path.
  const lineFromOffset = useCallback((text: string, offset: number): number => {
    const upto = text.slice(0, offset);
    return upto.split('\n').length - 1;
  }, []);

  // Determine the cursor line from the source text at the current DOM
  // selection offset. Used at mount-time before the editor is wired up — we
  // can't call getCursorPosition() until the DOM is constructed.
  const getCursorPositionInText = useCallback((text: string): number => {
    // First-mount fallback: cursor at end of text unless click position is
    // available (handled by the focus effect below).
    return text.length;
  }, []);

  // ─── Per-line render cache ────────────────────────────────────────────────
  // Maps `(line source, fontSize, color, lineHeight, mathReady)` → rendered
  // HTML. Re-render only when a line's own source/style/font-availability
  // changes; sibling-line edits never invalidate cached entries. Cleared
  // when MathJax flips from "still loading" to "ready" so old KaTeX-rendered
  // math is replaced with MathJax-rendered math.
  const lineCacheRef = useRef<Map<string, string>>(new Map());
  useEffect(() => {
    // Wipe the cache when MathJax becomes ready so cached KaTeX HTML for
    // math segments is replaced. Subsequent renders use MathJax SVG.
    if (mathReady) lineCacheRef.current = new Map();
  }, [mathReady]);
  const buildCacheKey = (line: string, multiplier: number, style: TextElement['style']): string =>
    `${line}${multiplier}${style.fontSize}${style.color}${style.lineHeight ?? 1.2}${mathReady ? 'mj' : 'kx'}`;

  // Read source text from the editor. The cursor line is always rendered raw
  // (textContent == source), so reading its textContent picks up any chars
  // the user just typed. Non-cursor lines have markup chars stripped from
  // their visible DOM, so we read their `data-source` attribute — which
  // holds the raw markdown that was put in when they were last rendered.
  const getTextFromEditor = useCallback((): string => {
    if (!editorRef.current) return '';

    const divs = editorRef.current.querySelectorAll('div[data-line]');
    if (divs.length === 0) {
      return editorRef.current.textContent || '';
    }

    const lines: string[] = [];
    divs.forEach((div, i) => {
      if (isRawLine(i)) {
        // Raw line: textContent is the source (and reflects fresh keystrokes).
        if (div.querySelector('br') && div.childNodes.length === 1) {
          lines.push('');
        } else {
          lines.push(div.textContent || '');
        }
      } else {
        // Formatted line: source lives in data-source; visible DOM has the
        // markup chars stripped, so don't trust textContent.
        const raw = div.getAttribute('data-source');
        lines.push(raw ?? div.textContent ?? '');
      }
    });
    return lines.join('\n');
  }, []);

  const escapeHtml = (s: string): string =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  // Render one inline segment of a non-cursor (formatted) line as HTML. Bold,
  // italic, strikethrough, underline get their styled span. LaTeX stays raw
  // per the user's spec ("not regarding the latex formula"). Links render as
  // their display text with link colour but no underline (so the visible
  // result matches the steady SVG render).
  const renderFormattedSegment = useCallback((content: string): string => {
    const segs = parseInlineSegments(content, 0);
    return segs.map((s) => {
      if (s.type === 'formatted') {
        const styleParts: string[] = [];
        if (s.bold) styleParts.push('font-weight:bold');
        if (s.italic) styleParts.push('font-style:italic');
        if (s.underline && s.strikethrough) styleParts.push('text-decoration:underline line-through');
        else if (s.underline) styleParts.push('text-decoration:underline');
        else if (s.strikethrough) styleParts.push('text-decoration:line-through');
        return `<span style="${styleParts.join(';')}">${escapeHtml(s.displayContent)}</span>`;
      }
      if (s.type === 'link') {
        return `<span style="color:#2563eb">${escapeHtml(s.displayContent)}</span>`;
      }
      if (s.type === 'latex') {
        // Use MathJax for exact parity with the steady SVG render. Fall back
        // to KaTeX HTML while MathJax is still finishing its async setup.
        const mj = texFragmentToSvgSync(s.displayContent, s.isBlock);
        return mj ?? renderLatex(s.displayContent, s.isBlock);
      }
      return escapeHtml(s.displayContent);
    }).join('');
  }, []);

  // Render text as HTML. Lines in `rawLines` (cursor + selection coverage)
  // render raw — markup characters visible — so the user can edit them
  // directly. Other lines go through parseInlineSegments + KaTeX/MathJax for
  // a result that visually matches the steady SVG render. Per-line cache
  // means a change on line N doesn't re-render lines M ≠ N.
  //
  // Line height uses 0.8 + 0.4 * style.lineHeight (the SVG renderer's
  // ascender + descender breakdown) so the edit overlay's line spacing
  // matches the steady frame's line spacing.
  const renderText = useCallback((plainText: string, style: TextElement['style'], rawLines: Set<number>) => {
    if (!editorRef.current) return;

    const baseFontSize = style.fontSize * zoom;
    const lines = plainText.split('\n');
    const styleLineHeight = style.lineHeight ?? 1.2;
    // SVG renderer total line height is (0.8 + 0.4*lineHeight) * fontSize,
    // with baseline at 0.8 * fontSize from the top of the line. Setting CSS
    // line-height to 1 keeps the baseline near the font's intrinsic position
    // (Inter ≈ 0.8 * fontSize) and we add the extra below-baseline space as
    // bottom padding instead — that way the baselines align with the SVG
    // render line for line.
    const extraBelow = Math.max(0, (0.8 + 0.4 * styleLineHeight - 1)) ;
    const allRaw = rawLines.size === 0;

    const html = lines.map((line, index) => {
      const info = parseLine(line);
      const fontSize = baseFontSize * info.fontSizeMultiplier;
      const isHeading = info.type.startsWith('h');
      const fontWeight = isHeading ? 'bold' : 'inherit';
      const padBottom = fontSize * extraBelow;
      const sourceAttr = ` data-source="${escapeHtml(line)}"`;
      const styleAttr = `margin:0;padding:0 0 ${padBottom}px 0;font-size:${fontSize}px;font-weight:${fontWeight};line-height:1;min-height:${fontSize}px;`;

      if (allRaw || rawLines.has(index)) {
        const escaped = escapeHtml(line);
        return `<div data-line="${index}"${sourceAttr} style="${styleAttr}">${escaped || '<br>'}</div>`;
      }

      // Cached formatted render for this line.
      const cacheKey = buildCacheKey(line, info.fontSizeMultiplier, style);
      let formatted = lineCacheRef.current.get(cacheKey);
      if (formatted === undefined) {
        // Headings have their prefix stripped from the rendered output;
        // font-size handles the visual size jump.
        let body = line;
        if (isHeading) body = body.slice(info.type === 'h1' ? 2 : info.type === 'h2' ? 3 : 4);
        formatted = renderFormattedSegment(body) || '<br>';
        lineCacheRef.current.set(cacheKey, formatted);
      }
      return `<div data-line="${index}"${sourceAttr} style="${styleAttr}">${formatted}</div>`;
    }).join('');

    editorRef.current.innerHTML = html;
  }, [zoom, parseLine, renderFormattedSegment, buildCacheKey]);

  // Translate the DOM selection to a SOURCE-text offset.
  //
  // For the line that contains the cursor, the range's startOffset is the
  // truth — it reflects fresh typing immediately, even before our state has
  // caught up. (Clamping against data-source was a bug: data-source holds
  // the value at the LAST render, so clamping rewinds the cursor every time
  // you type past the old length.)
  //
  // For lines that DON'T contain the cursor, count source-length: formatted
  // lines have markup chars stripped from textContent, so we read
  // data-source which preserves them.
  const getCursorPosition = useCallback((): number => {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0 || !editorRef.current) return 0;

    const range = selection.getRangeAt(0);
    let offset = 0;
    const divs = Array.from(editorRef.current.querySelectorAll('div[data-line]'));

    for (let i = 0; i < divs.length; i++) {
      const div = divs[i];
      if (div.contains(range.startContainer)) {
        offset += range.startOffset;
        return offset;
      }
      const sourceLen = (div.getAttribute('data-source') ?? div.textContent ?? '').length;
      offset += sourceLen;
      if (i < divs.length - 1) offset += 1;
    }
    return offset;
  }, []);

  // Inverse of getCursorPosition. Counts source lengths between lines, then
  // clamps within the target line (which after a re-render is the cursor
  // line, rendered raw → textContent == source).
  const setCursorPosition = useCallback((offset: number) => {
    if (!editorRef.current) return;
    const selection = window.getSelection();
    if (!selection) return;

    let currentOffset = 0;
    const divs = Array.from(editorRef.current.querySelectorAll('div[data-line]'));

    for (let i = 0; i < divs.length; i++) {
      const div = divs[i];
      const sourceLen = (div.getAttribute('data-source') ?? div.textContent ?? '').length;
      if (currentOffset + sourceLen >= offset) {
        const lineOffset = offset - currentOffset;
        const textNode = Array.from(div.childNodes).find(n => n.nodeType === Node.TEXT_NODE);
        const range = document.createRange();
        if (textNode) {
          const nodeLen = textNode.textContent?.length ?? 0;
          range.setStart(textNode, Math.min(lineOffset, nodeLen));
        } else {
          range.setStart(div, 0);
        }
        range.collapse(true);
        selection.removeAllRanges();
        selection.addRange(range);
        return;
      }
      currentOffset += sourceLen;
      if (i < divs.length - 1) currentOffset += 1;
    }

    // Fallback: end of last div.
    if (divs.length > 0) {
      const lastDiv = divs[divs.length - 1];
      const textNode = Array.from(lastDiv.childNodes).find(n => n.nodeType === Node.TEXT_NODE);
      const range = document.createRange();
      if (textNode) range.setStart(textNode, textNode.textContent?.length ?? 0);
      else range.setStart(lastDiv, 0);
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

    // Use the click position (if any) to decide which line should be raw at
    // mount. Without this, we render the last line raw by default, and then
    // when setCursorPosition fires it's already too late — the user briefly
    // sees the wrong line as the edit target.
    const clickPosForInit = useEditorStore.getState().textEditClickPosition;
    const initialCursor = clickPosForInit && textElement
      ? (calculateCursorFromClick(textElement, clickPosForInit) ?? text.length)
      : text.length;
    const initialLine = lineFromOffset(text, initialCursor);
    const initialRaw = new Set<number>([initialLine]);
    setRawLines(initialRaw);
    renderText(text, textElement.style, initialRaw);

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
    renderText(currentTextRef.current, textElement.style, rawLinesRef.current);
    setCursorPosition(cursorPos);
  }, [zoom, editingTextId, textElement, renderText, getCursorPosition, setCursorPosition]);

  // Raw-line tracking. Lines that should render raw are: the line containing
  // the cursor + every line covered by a non-collapsed selection. When this
  // set changes between events we re-render so the formatting swap matches
  // the new state.
  //
  // Line detection comes from the DOM (which div contains the range
  // endpoints) — never from currentTextRef + offset, because the ref can be
  // stale between a keystroke and the next handleInput snapshot, and a wrong
  // line index here would wipe the just-typed character on re-render.
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

      // Diff against the previous raw-line set — if identical, no re-render.
      const prev = rawLinesRef.current;
      if (prev.size === next.size) {
        let same = true;
        for (const v of next) if (!prev.has(v)) { same = false; break; }
        if (same) return;
      }

      // Snapshot the current DOM (with whatever the user just typed) before
      // we replace it, so the typed character survives the re-render.
      const offset = getCursorPosition();
      const currentText = getTextFromEditor();
      currentTextRef.current = currentText;
      setRawLines(next);
      if (textElement) {
        renderText(currentText, textElement.style, next);
        setCursorPosition(offset);
      }
    };
    document.addEventListener('selectionchange', handle);
    return () => document.removeEventListener('selectionchange', handle);
  }, [editingTextId, getCursorPosition, getTextFromEditor, renderText, setCursorPosition, textElement]);

  // Virtual keyboard avoidance: when the keyboard appears on mobile, the
  // visual viewport shrinks. If the editor ends up beneath it, scroll it back
  // into view. window.visualViewport is the only reliable signal here — the
  // window's outerHeight stays the same while the keyboard is up.
  useEffect(() => {
    if (!editingTextId) return;
    if (typeof window === 'undefined' || !window.visualViewport) return;
    const vv = window.visualViewport;
    const handle = () => {
      const el = editorRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      // visualViewport.height drops to the keyboard-uncovered region. If our
      // editor's bottom is below it (rect.bottom > vv.height + vv.offsetTop),
      // scroll the editor into the middle of the visible region.
      if (rect.bottom > vv.offsetTop + vv.height || rect.top < vv.offsetTop) {
        el.scrollIntoView({ block: 'center', behavior: 'smooth' });
      }
    };
    // Fire once on entry to account for an already-up keyboard.
    handle();
    vv.addEventListener('resize', handle);
    return () => vv.removeEventListener('resize', handle);
  }, [editingTextId]);

  // Handle input. We deliberately DON'T re-render on every keystroke — that
  // races with selectionchange and stomps fresh-typed characters with stale
  // text. The native contentEditable already shows what the user typed; we
  // just snapshot it into our source-of-truth. The selectionchange handler
  // re-renders only when the cursor moves to a different line (which is
  // when the formatting swap actually matters).
  const handleInput = useCallback(() => {
    if (!editorRef.current || !textElement) return;
    currentTextRef.current = getTextFromEditor();
  }, [getTextFromEditor, textElement]);

  // Click on a FORMATTED line: the browser would land the caret in/around
  // the rendered SVG (which can't host a caret), so we'd never get into
  // edit position. Intercept mousedown, switch the clicked line to raw
  // BEFORE the browser places the caret, then put the caret at the click
  // point via caretRangeFromPoint / caretPositionFromPoint.
  const handleEditorMouseDown = useCallback((e: React.MouseEvent) => {
    const editor = editorRef.current;
    if (!editor || !textElement) return;
    // Walk up to find the data-line ancestor.
    let target = e.target as HTMLElement | null;
    while (target && target !== editor && !target.hasAttribute?.('data-line')) {
      target = target.parentElement;
    }
    if (!target || target === editor || !target.hasAttribute('data-line')) return;
    const idx = parseInt(target.getAttribute('data-line') || '-1', 10);
    if (idx < 0) return;
    if (rawLinesRef.current.has(idx)) return; // already raw, browser handles it natively

    e.preventDefault();
    const next = new Set<number>([idx]);
    setRawLines(next);
    renderText(currentTextRef.current, textElement.style, next);

    requestAnimationFrame(() => {
      const sel = window.getSelection();
      if (!sel) return;
      // Prefer caretRangeFromPoint (WebKit) → fall back to
      // caretPositionFromPoint (Firefox) → fall back to end-of-line.
      type DocWithCaret = Document & {
        caretRangeFromPoint?: (x: number, y: number) => Range | null;
        caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
      };
      const docCaret = document as DocWithCaret;
      let placed = false;
      if (docCaret.caretRangeFromPoint) {
        const r = docCaret.caretRangeFromPoint(e.clientX, e.clientY);
        if (r) {
          sel.removeAllRanges();
          sel.addRange(r);
          placed = true;
        }
      }
      if (!placed && docCaret.caretPositionFromPoint) {
        const p = docCaret.caretPositionFromPoint(e.clientX, e.clientY);
        if (p) {
          const range = document.createRange();
          range.setStart(p.offsetNode, p.offset);
          range.collapse(true);
          sel.removeAllRanges();
          sel.addRange(range);
          placed = true;
        }
      }
      if (!placed) {
        const newLineDiv = editor.querySelector(`div[data-line="${idx}"]`) as HTMLElement | null;
        const textNode = newLineDiv?.firstChild as Node | null;
        if (textNode) {
          const range = document.createRange();
          const len = (textNode.textContent || '').length;
          range.setStart(textNode, len);
          range.collapse(true);
          sel.removeAllRanges();
          sel.addRange(range);
        }
      }
    });
  }, [textElement, renderText]);

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
          if (textElement) renderText(newText, textElement.style, rawLinesRef.current);
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
          if (textElement) renderText(newText, textElement.style, rawLinesRef.current);
          setCursorPosition(currentLineStart);
          return;
        }

        insertText = `\n${currentNum + 1}. `;
        newCursorOffset = insertText.length;
      }

      const newText = currentText.slice(0, cursorPos) + insertText + currentText.slice(cursorPos);
      currentTextRef.current = newText;

      if (textElement) renderText(newText, textElement.style, rawLinesRef.current);
      setCursorPosition(cursorPos + newCursorOffset);
      return;
    }

    e.stopPropagation();
  }, [activeSlideId, editingTextId, updateElement, setEditingTextId, getCursorPosition, renderText, setCursorPosition, textElement]);

  // Handle paste — insert plain text only; let images/files bubble to global handler
  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    // Check if clipboard has files (images, PDFs, videos) — let the global handler deal with those
    const items = e.clipboardData?.items;
    if (items) {
      for (const item of Array.from(items)) {
        if (item.kind === 'file') return;
      }
    }

    e.preventDefault();
    const pastedText = e.clipboardData.getData('text/plain');
    if (!pastedText || !textElement) return;

    const cursorPos = getCursorPosition();
    const currentText = currentTextRef.current;
    const newText = currentText.slice(0, cursorPos) + pastedText + currentText.slice(cursorPos);
    currentTextRef.current = newText;
    renderText(newText, textElement.style, rawLinesRef.current);
    setCursorPosition(cursorPos + pastedText.length);
  }, [getCursorPosition, renderText, setCursorPosition, textElement]);

  // Handle blur — use refs to avoid stale closure when editingTextId is cleared before blur fires
  const handleBlur = useCallback(() => {
    // Ignore blur within 200ms of mount
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
        onMouseDown={handleEditorMouseDown}
        onInput={handleInput}
        onBlur={handleBlur}
        onKeyDown={handleKeyDown}
        onPaste={handlePaste}
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
          // Force Inter to match the steady SVG render (which always uses
          // Inter regardless of style.fontFamily). Falls back gracefully to
          // the user's chosen font if the @font-face hasn't loaded yet.
          fontFamily: `'InterEdit', ${style.fontFamily}`,
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
          overflow: 'visible',
          cursor: 'text',
          // Enable pointer events on the contentEditable (parent has pointerEvents: none)
          pointerEvents: 'auto',
        }}
      />
    </div>
  );
};
