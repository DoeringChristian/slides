import { transferIds } from '../utils/model/groupTransfer';
import { getActiveDoc } from '../collab/yDocAdapter';
import { readElementForMutation } from '../store/currentMutation';
import { useEffect } from 'react';
import { useEditorStore } from '../store/editorStore';
import { usePresentationStore } from '../store/presentationStore';
import { duplicateElements, loadImageFile } from '../utils/model/slideFactory';
import { createBoundLabel, findBoundText } from '../utils/model/syncDependents';
import { getActiveUndoManager } from '../collab/activeUndo';

export function useKeyboardShortcuts() {
  const store = usePresentationStore;
  const editor = useEditorStore;

  useEffect(() => {
    const INTERNAL_MARKER = 'slides-internal-copy';

    const handleKeyDown = (e: KeyboardEvent) => {
      // Drafts, palettes, vertex handles and text editors own handled keys.
      if (e.defaultPrevented) return;
      const target = e.target as HTMLElement;
      const isInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' ||
        target.isContentEditable;

      // Don't intercept keyboard shortcuts when typing in inputs
      if (isInput && !e.ctrlKey && !e.metaKey) return;

      // Let native copy/cut/paste work in inputs (text editing)
      if (isInput && (e.ctrlKey || e.metaKey) && (e.key === 'c' || e.key === 'x' || e.key === 'v')) return;

      // Don't intercept during presentation
      if (editor.getState().isPresenting) return;

      const ctrl = e.ctrlKey || e.metaKey;

      // Save — download a standalone viewer HTML (same mechanism as the Save button).
      if (ctrl && e.key === 's') {
        e.preventDefault();
        import('../utils/io/exportStandaloneHtml').then(({ exportStandaloneHtml }) =>
          exportStandaloneHtml(store.getState().presentation, { mode: 'viewer' }).catch((err) => {
            console.error(err);
            alert(err.message);
          }),
        );
        return;
      }

      // Undo/Redo. In collab mode, the active Y.UndoManager owns the stack
      // (scoped to local edits); elsewhere we fall back to zundo's temporal.
      const key = e.key.toLowerCase();
      if (ctrl && key === 'z' && !e.shiftKey) {
        e.preventDefault();
        const yMgr = getActiveUndoManager();
        if (yMgr) yMgr.undo();
        else store.temporal.getState().undo();
        return;
      }
      if (ctrl && (key === 'y' || (key === 'z' && e.shiftKey))) {
        e.preventDefault();
        const yMgr = getActiveUndoManager();
        if (yMgr) yMgr.redo();
        else store.temporal.getState().redo();
        return;
      }

      // Skip other shortcuts when in text edit mode
      if (editor.getState().editingTextId && !ctrl) return;

      const activeSlideId = editor.getState().activeSlideId;
      const selectedIds = editor.getState().selectedElementIds;

      // Object groups are independent of slide-chain grouping.
      if (ctrl && key === 'g' && !isInput && !editor.getState().editingTextId &&
          !editor.getState().croppingElementId && editor.getState().tool === 'select') {
        e.preventDefault();
        if (e.shiftKey) store.getState().ungroupObjects(activeSlideId, selectedIds);
        else store.getState().groupObjects(activeSlideId, selectedIds);
        editor.getState().setSelectedElements(selectedIds);
        return;
      }


      // Delete — hide elements on current slide, or delete slide if nothing selected
      if ((e.key === 'Delete' || e.key === 'Backspace') && !isInput && editor.getState().tool === 'select') {
        if (selectedIds.length > 0) {
          e.preventDefault();
          store.getState().hideElements(activeSlideId, selectedIds);
          editor.getState().setSelectedElements([]);
          return;
        }
        // No elements selected — delete the active slide
        const slideOrder = store.getState().presentation.slideOrder;
        if (slideOrder.length > 1) {
          e.preventDefault();
          const idx = slideOrder.indexOf(activeSlideId);
          store.getState().deleteSlide(activeSlideId);
          const remaining = slideOrder.filter((id) => id !== activeSlideId);
          editor.getState().setActiveSlide(remaining[Math.min(idx, remaining.length - 1)]);
          return;
        }
      }

      // Enter — edit the sole selected element's text: a text element opens
      // its editor; a shape/arrow opens (or creates) its bound label. Only
      // with the select tool active — the poly-draft commit in useSVGDrawing
      // owns Enter while a polygon/spline draft is in flight.
      if (
        e.key === 'Enter' && !ctrl && !isInput &&
        !editor.getState().editingTextId &&
        editor.getState().tool === 'select' &&
        selectedIds.length === 1
      ) {
        const slide = store.getState().presentation.slides[activeSlideId];
        const el = slide?.elements[selectedIds[0]];
        if (el && el.visible && !el.locked) {
          if (el.type === 'text') {
            e.preventDefault();
            editor.getState().setEditingTextId(el.id);
            return;
          }
          if (el.type === 'shape') {
            e.preventDefault();
            const existing = findBoundText(slide, el.id);
            if (existing) {
              editor.getState().setEditingTextId(existing.id);
            } else {
              const label = createBoundLabel(el);
              store.getState().addElement(activeSlideId, label);
              editor.getState().setEditingTextId(label.id);
            }
            return;
          }
        }
      }

      // Escape
      if (e.key === 'Escape') {
        e.preventDefault();
        if (editor.getState().editingTextId) {
          editor.getState().setEditingTextId(null);
        } else if (editor.getState().activeObjectGroupId) {
          editor.getState().exitObjectGroup();
        } else {
          editor.getState().clearSelection();
          editor.getState().setTool('select');
        }
        return;
      }

      // Copy — containers bring their bound-text labels along so a paste
      // reproduces the labelled shape (ids remapped at paste time).
      if (ctrl && e.key === 'c' && selectedIds.length > 0) {
        e.preventDefault();
        const slide = store.getState().presentation.slides[activeSlideId];
        if (slide) {
          const copyIds = transferIds(slide, selectedIds);
          const elements = copyIds.map((id) => slide.elements[id]).filter(Boolean);
          editor.getState().setClipboard(elements.map((e) => JSON.parse(JSON.stringify(e))));
          // Write marker to system clipboard so paste knows it's internal
          navigator.clipboard.writeText(INTERNAL_MARKER).catch(() => {});
        }
        return;
      }

      // Cut
      if (ctrl && e.key === 'x' && selectedIds.length > 0) {
        e.preventDefault();
        const slide = store.getState().presentation.slides[activeSlideId];
        if (slide) {
          const copyIds = transferIds(slide, selectedIds);
          const elements = copyIds.map((id) => slide.elements[id]).filter(Boolean);
          editor.getState().setClipboard(elements.map((e) => JSON.parse(JSON.stringify(e))));
          store.getState().hideElements(activeSlideId, selectedIds);
          editor.getState().setSelectedElements([]);
          navigator.clipboard.writeText(INTERNAL_MARKER).catch(() => {});
        }
        return;
      }

      // Select All
      if (ctrl && e.key === 'a' && !isInput) {
        e.preventDefault();
        const slide = store.getState().presentation.slides[activeSlideId];
        if (slide) {
          editor.getState().setSelectedElements(slide.elementOrder);
        }
        return;
      }

      // Tool hotkeys. Plain letters, no modifiers — see Toolbar.tsx for the
      // matching tooltips shown to users.
      if (!ctrl && !isInput) {
        switch (e.key.toLowerCase()) {
          case 'v': editor.getState().setTool('select'); break;
          case 't': editor.getState().setTool('text'); break;
          case 'r': editor.getState().setTool('rect'); break;
          case 'e': editor.getState().setTool('ellipse'); break;
          case 'y': editor.getState().setTool('triangle'); break;
          case 's': editor.getState().setTool('star'); break;
          case 'l': editor.getState().setTool('line'); break;
          case 'a': editor.getState().setTool('arrow'); break;
          case 'g': editor.getState().setTool('polygon'); break;
          case 'p': editor.getState().setTool('bspline'); break;
          case 'i': editor.getState().setTool('image'); break;
        }
      }

      // Zoom
      if (ctrl && (e.key === '=' || e.key === '+')) {
        e.preventDefault();
        editor.getState().setZoom(editor.getState().zoom + 0.1);
      }
      if (ctrl && e.key === '-') {
        e.preventDefault();
        editor.getState().setZoom(editor.getState().zoom - 0.1);
      }
      if (ctrl && e.key === '0') {
        e.preventDefault();
        editor.getState().setZoom(1);
      }

      // Bold/Italic/Underline for text
      if (ctrl && selectedIds.length === 1 && ['b', 'i', 'u'].includes(e.key)) {
        const el = readElementForMutation(activeSlideId, selectedIds[0]);
        if (el && el.type === 'text') {
          const textEl = el as import('../types/presentation').TextElement;
          if (e.key === 'b') {
            e.preventDefault();
            store.getState().updateElement(activeSlideId, textEl.id, {
              style: { ...textEl.style, fontWeight: textEl.style.fontWeight === 'bold' ? 'normal' : 'bold' },
            } as Partial<import('../types/presentation').TextElement>);
          }
          if (e.key === 'i') {
            e.preventDefault();
            store.getState().updateElement(activeSlideId, textEl.id, {
              style: { ...textEl.style, fontStyle: textEl.style.fontStyle === 'italic' ? 'normal' : 'italic' },
            } as Partial<import('../types/presentation').TextElement>);
          }
          if (e.key === 'u') {
            e.preventDefault();
            store.getState().updateElement(activeSlideId, textEl.id, {
              style: { ...textEl.style, textDecoration: textEl.style.textDecoration === 'underline' ? 'none' : 'underline' },
            } as Partial<import('../types/presentation').TextElement>);
          }
        }
      }
    };

    // Native paste events carry user-authorized clipboard data without a
    // permission-gated navigator.clipboard.read() call on every keystroke.
    const handlePaste = (event: ClipboardEvent) => {
      const state = editor.getState();
      const target = event.target instanceof Element ? event.target : null;
      if (event.defaultPrevented) return;
      if (target?.closest('input, textarea, [contenteditable="true"]') || state.editingTextId ||
          state.isPresenting || state.isPresenterMode || !state.activeSlideId) return;
      const data = event.clipboardData;
      if (!data) return;
      const image = Array.from(data.files).find(file => file.type.startsWith('image/'));
      if (image) {
        event.preventDefault();
        const projectId = store.getState().presentation.id;
        const slideId = state.activeSlideId;
        const doc = getActiveDoc();
        let cancelled = false;
        const unsubscribe = editor.subscribe(next => {
          if (next.activeSlideId !== slideId) cancelled = true;
        });
        void loadImageFile(image, undefined, store.getState().presentation.resources).then(({ resource, element, isExisting }) => {
          if (cancelled || getActiveDoc() !== doc || store.getState().presentation.id !== projectId ||
              editor.getState().activeSlideId !== slideId || !store.getState().presentation.slides[slideId]) return;
          if (!isExisting) store.getState().addResource(resource);
          store.getState().addElement(slideId, element);
          if (editor.getState().activeSlideId === slideId) editor.getState().setSelectedElements([element.id]);
        }).catch(console.error).finally(unsubscribe);
      } else if (data.getData('text/plain') === INTERNAL_MARKER && state.clipboard.length) {
        event.preventDefault();
        const copies = duplicateElements(state.clipboard);
        store.getState().addElements(state.activeSlideId, copies);
        state.setSelectedElements(copies.filter(el => !(el.type === 'text' && el.containerId)).map(el => el.id));
      }
    };
    window.addEventListener('paste', handlePaste);
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('paste', handlePaste);
    };
  }, []);
}
