import { SVGTextAutoFitHandle } from '../svg/SVGTextAutoFitHandle';
import { flushSync } from 'react-dom';
import { textEditorSourceOffset, textEditorCursorPoint } from '../../utils/textEditorSelection';
import React, { useRef, useEffect, useCallback, useState, useMemo } from 'react';
import { useEditorStore } from '../../store/editorStore';
import { useActiveSlide } from '../../store/selectors';
import { CANVAS_PADDING } from '../../utils/constants';
import { calculateCursorFromClick } from '../../utils/textHitTest';
import { layoutSvgText, textRowMetrics, type SvgTextDoc } from '../../utils/textLayout';
import { textInsets } from '../../utils/boundTextLayout';
import type { GesturePatch } from '../../utils/gestureProjection';
import { maxLabelWidthFor } from '../../utils/syncDependents';
import { SVGTextPaths } from '../svg/SVGTextPaths';
import { injectInterFontFace, nativeTextBaseline } from '../../utils/glyphPaths';
import { beginTextEditSession, getTextEditInitialText } from '../../store/textEditSession';
import { hasContentSizing, layoutUserText, measureUserText, textSizingWidth } from '../../utils/userTextSizing';
import type { TextElement } from '../../types/presentation';

// Inject the InterEdit @font-face so the contentEditable uses the SAME font
// the SVG renderer reads via opentype.js. The browser shapes characters with
// it (advance widths from font tables) → caret X lines up with SVG glyphs.
injectInterFontFace();

interface Props {
  stageRef: React.RefObject<HTMLDivElement | null>;
  zoom: number;
  onPreview: (preview: { slideId: string; label: TextElement; patches: GesturePatch[] } | null) => void;
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
export const TextEditOverlay: React.FC<Props> = ({ stageRef, zoom, onPreview }) => {
  const editingTextId = useEditorStore((s) => s.editingTextId);
  const setEditingTextId = useEditorStore((s) => s.setEditingTextId);
  const activeSlideId = useEditorStore((s) => s.activeSlideId);
  const slide = useActiveSlide();

  const editorRef = useRef<HTMLDivElement>(null);
  // Initial async hit-testing owns the caret only until the user's first
  // input/selection gesture. Structural edits restore synchronously below.
  const initialCaretClaimedRef = useRef(false);
  // eslint-disable-next-line react-hooks/purity -- captures the mount timestamp once; the useRef initializer only runs on mount
  const mountTimeRef = useRef(Date.now());
  const sessionRef = useRef<ReturnType<typeof beginTextEditSession> | null>(null);
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
  const [liveText, setLiveText] = useState(() => {
    const initial = editingTextId ? slide?.elements[editingTextId] : undefined;
    return initial?.type === 'text' ? getTextEditInitialText(activeSlideId, initial) : '';
  });
  const liveTextRef = useRef(liveText);
  // eslint-disable-next-line react-hooks/refs -- latest-value ref pattern: mirrors state for event handlers; read only outside render
  liveTextRef.current = liveText;

  // This component is keyed by slide + edit id. Cleanup captures that session,
  // never the current slide's same-ID keyframe. Defer StrictMode's probe cleanup.
  const mountedRef = useRef(false);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      const session = sessionRef.current;
      const text = liveTextRef.current;
      queueMicrotask(() => { if (!mountedRef.current) void session?.finish(text); });
      onPreview(null);
    };
  }, [onPreview]);

  // Get the editing element
  const element = editingTextId ? slide?.elements[editingTextId] : null;
  const textElement = element && element.type === 'text' ? (element as TextElement) : null;

  // Bound labels (Excalidraw model): the STORED element box hugs the laid-
  // out text, but while editing, text must WRAP at the container's inner
  // width — so the edit box is that wrap-max width, centered on the label's
  // own center (which sits on the container anchor). With align:center the
  // glyphs land in exactly the same place as the steady frame's hugged box,
  // and the contenteditable spans the wrap width so the caret behaves.
  // Free text boxes keep the element box unchanged.
  const labelContainer = textElement?.containerId
    ? slide?.elements[textElement.containerId] ?? null
    : null;
  const [liveSize, setLiveSize] = useState<{ width: number; height: number } | null>(null);
  const [boundPreview, setBoundPreview] = useState<TextElement | null>(null);
  const previewElement = boundPreview && textElement?.containerId ? { ...textElement, ...boundPreview } : textElement && liveSize ? { ...textElement, ...liveSize } : textElement;
  const editWidth = previewElement
    ? labelContainer
      ? Math.max(previewElement.width, maxLabelWidthFor(labelContainer, previewElement))
      : previewElement.width
    : 0;
  const editX = previewElement ? previewElement.x + (labelContainer ? (previewElement.width - editWidth) / 2 : 0) : 0;
  const inset = previewElement ? textInsets(previewElement) : 14;
  const editHeight = previewElement?.height ?? 0;

  // Layout doc from the SVG renderer (cached per text + style + width + raw
  // line set). We pre-compute it from `liveText` so per-line yTop/yBottom
  // reflect the user's latest typing; SVGTextPaths' onLayout also publishes
  // the doc, but pulling it directly avoids a render lag.
  const [doc, setDoc] = useState<SvgTextDoc | null>(null);
  const layoutWidth = textElement
    ? textElement.textSizing === 'auto-content' && !labelContainer ? textSizingWidth(textElement) : Math.max(1, editWidth - inset * 2)
    : 1;
  const rawKeyForLayout = useMemo(
    () => Array.from(rawLines).sort((a, b) => a - b).join(','),
    [rawLines],
  );
  useEffect(() => {
    if (!textElement) return;
    let cancelled = false;
    const layout = textElement.textSizing === 'auto-content' && !labelContainer
      ? layoutUserText({ ...textElement, text: liveText }, rawLines)
      : layoutSvgText(liveText, textElement.style, layoutWidth, rawLines);
    layout.then(
      (d) => { if (!cancelled) setDoc(d); },
      (err) => { if (!cancelled) console.warn('[TextEditOverlay] layout failed', err); },
    );
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveText, textElement?.style, layoutWidth, rawKeyForLayout]);

  useEffect(() => {
    if (!textElement || !hasContentSizing(textElement)) return;
    let cancelled = false;
    measureUserText({ ...textElement, text: liveText }, rawLines).then(size => {
      if (cancelled) return;
      setLiveSize(size);
      const label = { ...textElement, text: liveText, ...size };
      onPreview({ slideId: activeSlideId, label, patches: [{ elementId: label.id, changes: label }] });
    }, () => {});
    return () => { cancelled = true; };
  }, [textElement, liveText, rawLines, onPreview, activeSlideId]);

  useEffect(() => {
    if (!textElement?.containerId) return;
    let cancelled = false;
    // The mount effect below creates the session in this same effect turn.
    queueMicrotask(() => {
      if (cancelled) return;
      void sessionRef.current?.preview(liveText, rawLines).then(result => {
        if (cancelled || !result) return;
        setBoundPreview(result.label);
        onPreview(result);
      }, () => {});
    });
    return () => { cancelled = true; };
  }, [textElement, labelContainer, liveText, rawLines, onPreview]);

  const domToSourceOffset = useCallback((container: Node, domOffset: number): number => {
    const editor = editorRef.current;
    return editor ? textEditorSourceOffset(editor, container, domOffset) : 0;
  }, []);

  // Selection start/end as source offsets (sorted ascending).
  const getSelectionRange = useCallback((): [number, number] | null => {
    const editor = editorRef.current;
    const sel = window.getSelection();
    if (!editor || !sel || sel.rangeCount === 0) return null;
    const range = sel.getRangeAt(0);
    if (!editor.contains(range.startContainer) || !editor.contains(range.endContainer)) return null;
    const a = domToSourceOffset(range.startContainer, range.startOffset);
    const b = domToSourceOffset(range.endContainer, range.endOffset);
    return a <= b ? [a, b] : [b, a];
  }, [domToSourceOffset]);

  const setCursorPosition = useCallback((offset: number) => {
    const editor = editorRef.current;
    if (!editor) return;
    const selection = window.getSelection();
    if (!selection) return;
    const [node, column] = textEditorCursorPoint(editor, offset);
    const range = document.createRange();
    range.setStart(node, column);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
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
    if (!editingTextId) {
      prevEditingIdRef.current = null;
      return;
    }
    // Don't latch the id until the element is actually renderable — a label
    // created moments ago may reach the store one microtask later in collab
    // mode (Y → store sync), and latching early would skip the seed/focus.
    if (!textElement || !editorRef.current) return;

    if (!sessionRef.current) {
      sessionRef.current = beginTextEditSession(activeSlideId, textElement);
      liveTextRef.current = sessionRef.current.initialText;
      setLiveText(sessionRef.current.initialText);
    }
    const text = liveTextRef.current;
    mountTimeRef.current = Date.now();

    const clickPos = useEditorStore.getState().textEditClickPosition;
    let cancelled = false;
    const placeCursor = (initialCursor: number) => {
      if (cancelled || initialCaretClaimedRef.current) return;
      setRawLines(new Set([text.slice(0, initialCursor).split('\n').length - 1]));
      requestAnimationFrame(() => {
        if (cancelled || initialCaretClaimedRef.current || !editorRef.current) return;
        // Latch only once focus actually lands. A store write between the
        // effect and this frame (e.g. the bound-label height-grow right
        // after creation) re-runs the effect and cancels this attempt —
        // latching eagerly would make that re-run bail and leave the
        // overlay permanently unfocused.
        prevEditingIdRef.current = editingTextId;
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

    // Empty text has no glyphs to hit-test — calculateCursorFromClick would
    // wait on a layout that never resolves and the overlay would open
    // unfocused (freshly created bound labels hit this).
    if (clickPos && text) {
      calculateCursorFromClick({ ...textElement, text }, clickPos).then(
        (cur) => placeCursor(cur ?? text.length),
        () => placeCursor(text.length),
      );
    } else {
      placeCursor(text.length);
    }
    return () => { cancelled = true; };
  }, [editingTextId, activeSlideId, textElement, setCursorPosition]);

  // Keep the editable focused while a session is open. Store writes landing
  // right after a label is created (bound-text height-grow, dependent sync)
  // can remount parts of the overlay and silently drop the focus the seed
  // effect just placed. Only reclaim focus from <body> so a deliberate focus
  // target (color picker, panel input, another app) is never fought.
  useEffect(() => {
    if (!editingTextId || !textElement || !editorRef.current) return;
    if (document.activeElement === document.body) {
      editorRef.current.focus();
    }
  });

  // Track which lines are raw via the DOM (range start / end → line indices).
  useEffect(() => {
    if (!editingTextId) return;
    const handle = () => {
      if (!editorRef.current) return;
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0) return;
      if (!editorRef.current.contains(sel.anchorNode)) return;
      const range = sel.getRangeAt(0);
      if (!editorRef.current.contains(range.endContainer)) return;
      const startLine = liveTextRef.current.slice(0, domToSourceOffset(range.startContainer, range.startOffset)).split('\n').length - 1;
      const endLine = liveTextRef.current.slice(0, domToSourceOffset(range.endContainer, range.endOffset)).split('\n').length - 1;
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
  }, [editingTextId, domToSourceOffset]);

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

  // Native single-line input owns its DOM; cancelled beforeinput does not
  // produce input. Never suppress an unrelated subsequent native keystroke.
  const handleInput = useCallback(() => {
    if (!editorRef.current || !textElement) return;
    liveTextRef.current = getTextFromEditor();
    setLiveText(liveTextRef.current);
  }, [getTextFromEditor, textElement]);

  // Structural edits must commit their DOM and caret before the next native
  // event. A deferred frame can lose typing or steal a later user selection.
  const replaceText = useCallback((newText: string, newCursor: number) => {
    liveTextRef.current = newText;
    flushSync(() => setLiveText(newText));
    setCursorPosition(newCursor);
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
      initialCaretClaimedRef.current = true;
      const inputType = e.inputType;
      const selection = getSelectionRange();
      if (!selection) return;
      const [selStart, selEnd] = selection;
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

        case 'insertText': {
          const data = e.data ?? '';
          // Auto-pair $ delimiters for math.
          //   * next char is $  → skip past it (the user typed the closing $)
          //   * cursor is at $|$ (and not inside $$|$$ already) → expand to $$|$$
          //   * otherwise → insert $$ and place caret between them
          if (data === '$' && selStart === selEnd) {
            e.preventDefault();
            const prev = text[selStart - 1];
            const next = text[selStart];
            const prevPrev = text[selStart - 2];
            const nextNext = text[selStart + 1];
            //   $: empty                 → "$|$"   (insert pair)
            //   $: at $|$ (no $ left)    → "$$|$$" (expand inline to block)
            //   $: at $$|$$ (4 around)   → no-op  (so $$$ ends up at $$|$$)
            //   $: next is $             → skip past (closing existing $)
            if (prevPrev === '$' && prev === '$' && next === '$' && nextNext === '$') {
              return;
            }
            // Between the two CLOSING dollars of $$x$$ is not an empty
            // inline pair: consume the closer rather than expanding it.
            if (prev === '$' && next === '$' && prevPrev !== '$') {
              const lineStart = text.lastIndexOf('\n', selStart - 1) + 1;
              const beforePair = text.slice(lineStart, selStart - 1);
              const insideBlock = (beforePair.match(/\$\$/g)?.length ?? 0) % 2 === 1;
              if (!insideBlock) {
                replaceText(text.slice(0, selStart) + '$$' + text.slice(selStart), selStart + 1);
                return;
              }
            }
            if (next === '$') {
              setCursorPosition(selStart + 1);
              return;
            }
            replaceText(text.slice(0, selStart) + '$$' + text.slice(selStart), selStart + 1);
            return;
          }
          if (crossesLine || data.includes('\n')) {
            e.preventDefault();
            replaceText(text.slice(0, selStart) + data + text.slice(selEnd), selStart + data.length);
          }
          return;
        }

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
  // In Yjs creation the edit id can precede the element/DOM by one render.
  // Attach when that element arrives, not only when the id changes.
  }, [editingTextId, textElement, getSelectionRange, applyEnter, replaceText, setCursorPosition]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    initialCaretClaimedRef.current = true;
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      void sessionRef.current?.finish(liveTextRef.current);
      setEditingTextId(null);
      return;
    }
    // Stop canvas-level hotkeys (e.g. Backspace deleting the selected
    // element) from firing while we're editing.
    e.stopPropagation();
  }, [setEditingTextId]);

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
    const selection = getSelectionRange();
    if (!selection) return;
    const [selStart, selEnd] = selection;
    const text = liveTextRef.current;
    replaceText(
      text.slice(0, selStart) + pastedText + text.slice(selEnd),
      selStart + pastedText.length,
    );
  }, [getSelectionRange, replaceText]);

  const handleBlur = useCallback(() => {
    if (Date.now() - mountTimeRef.current < 200) return;
    void sessionRef.current?.finish(liveTextRef.current);
    setEditingTextId(null);
  }, [setEditingTextId]);

  // eslint-disable-next-line react-hooks/refs -- gate on the stage DOM node existing before portaling into it; the node is attached before text editing can start
  if (!textElement || !stageRef.current) return null;

  const { style } = textElement;
  const padding = inset * zoom;
  // editX/editWidth are the element box for free text and the wrap-width box
  // (centered on the label) for bound labels — see their derivation above.
  const offsetX = (editX + CANVAS_PADDING) * zoom;
  const offsetY = ((previewElement?.y ?? textElement.y) + CANVAS_PADDING) * zoom;
  const widthPx = editWidth * zoom;
  const heightPx = editHeight * zoom;

  // Vertical alignment offset based on doc.height (if available) so it
  // matches the SVG render exactly. Falls back to 0 while layout pending.
  const contentAreaHeight = editHeight - inset * 2;
  const docHeight = doc?.height ?? 0;
  let verticalOffset = 0;
  if (style.verticalAlign === 'middle') {
    verticalOffset = Math.max(0, (contentAreaHeight - docHeight) / 2);
  } else if (style.verticalAlign === 'bottom') {
    verticalOffset = Math.max(0, contentAreaHeight - docHeight);
  }

  // Source of truth for the contentEditable's rendered content is liveText
  // (updated synchronously on every keystroke). doc.lines is used for line
  // div heights; native soft rows use the same synchronous strut as SVG.
  const sourceLines = liveText.split('\n');
  const defaultLineHeight = textRowMetrics(style.fontSize, style.lineHeight).advance;

  // Element passed to SVGTextPaths uses (x:0, y:0) so its internal
  // translate(elementX+padding, elementY+padding+verticalOffset) places the
  // text at (padding, padding+verticalOffset) inside our local viewBox.
  // text:liveText drives the SVG re-layout on every keystroke. width is the
  // edit-box width so a bound label wraps at its container's inner width.
  const localElement: TextElement = {
    ...(previewElement ?? textElement), text: liveText, x: 0, y: 0, rotation: 0, width: editWidth, height: editHeight,
  };

  return (
    <div
      style={{
        position: 'absolute',
        left: offsetX,
        top: offsetY,
        width: widthPx,
        height: heightPx,
        transform: previewElement?.rotation ? `rotate(${previewElement.rotation}deg)` : undefined,
        transformOrigin: 'center center',
        zIndex: 1000,
        pointerEvents: 'none',
      }}
    >
      {/* Rendered (SVG) layer — same renderer as the steady frame. */}
      <svg
        width={widthPx}
        height={heightPx}
        viewBox={`0 0 ${editWidth} ${editHeight}`}
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          pointerEvents: 'none',
          overflow: 'visible',
        }}
      >
        <SVGTextAutoFitHandle element={localElement} zoom={zoom} onAutoFit={() => {
          void sessionRef.current?.finish(liveTextRef.current, 'auto-content');
          setEditingTextId(null);
          useEditorStore.getState().setSelectedElements([textElement.id]);
        }} />
        <SVGTextPaths
          element={localElement}
          rawLineIndices={rawLines}
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
        onPointerDown={() => { initialCaretClaimedRef.current = true; }}
        onCompositionStart={() => { initialCaretClaimedRef.current = true; }}
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
          whiteSpace: textElement.textSizing === 'auto-content' && !labelContainer ? 'pre' : 'pre-wrap',
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
          const row = textRowMetrics(lineFontSize, style.lineHeight);
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
                lineHeight: `${row.advance}px`,
                position: 'relative',
                top: row.baseline - nativeTextBaseline(lineFontSize, row.advance, m > 1 ? 'bold' : style.fontWeight, style.fontStyle),
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
