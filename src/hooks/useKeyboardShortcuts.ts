import { useEffect } from 'react';
import { useEditorStore } from '../store/editorStore';
import { usePresentationStore } from '../store/presentationStore';
import { duplicateElement, loadImageFile, loadPdfFile, loadVideoFile } from '../utils/slideFactory';

export function useKeyboardShortcuts() {
  const store = usePresentationStore;
  const editor = useEditorStore;

  useEffect(() => {
    // Hidden contenteditable element that ensures paste events fire on Ctrl+V
    // even when no input/textarea has focus (e.g., when the canvas is active).
    const clipboardProxy = document.createElement('div');
    clipboardProxy.contentEditable = 'true';
    clipboardProxy.setAttribute('aria-hidden', 'true');
    clipboardProxy.tabIndex = -1;
    clipboardProxy.style.cssText = 'position:fixed;left:-9999px;top:-9999px;width:1px;height:1px;opacity:0;pointer-events:none;';
    document.body.appendChild(clipboardProxy);

    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const isInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' ||
        (target.isContentEditable && target !== clipboardProxy);

      // Don't intercept keyboard shortcuts when typing in inputs
      if (isInput && !e.ctrlKey && !e.metaKey) return;

      // Don't intercept during presentation
      if (editor.getState().isPresenting) return;

      const ctrl = e.ctrlKey || e.metaKey;

      // Save
      if (ctrl && e.key === 's') {
        e.preventDefault();
        const presentation = store.getState().presentation;
        const data = JSON.stringify(presentation);
        const blob = new Blob([data], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${presentation.title.replace(/\s+/g, '_')}.json`;
        a.click();
        URL.revokeObjectURL(url);
        return;
      }

      // Undo/Redo
      const key = e.key.toLowerCase();
      if (ctrl && key === 'z' && !e.shiftKey) {
        e.preventDefault();
        (store as any).temporal?.getState()?.undo();
        return;
      }
      if (ctrl && (key === 'y' || (key === 'z' && e.shiftKey))) {
        e.preventDefault();
        (store as any).temporal?.getState()?.redo();
        return;
      }

      // Skip other shortcuts when in text edit mode
      if (editor.getState().editingTextId && !ctrl) return;

      const activeSlideId = editor.getState().activeSlideId;
      const selectedIds = editor.getState().selectedElementIds;

      // Delete — hide elements on current slide, or delete slide if nothing selected
      if ((e.key === 'Delete' || e.key === 'Backspace') && !isInput) {
        if (selectedIds.length > 0) {
          e.preventDefault();
          for (const id of selectedIds) {
            store.getState().hideElement(activeSlideId, id);
          }
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

      // Escape
      if (e.key === 'Escape') {
        e.preventDefault();
        if (editor.getState().editingTextId) {
          editor.getState().setEditingTextId(null);
        } else {
          editor.getState().clearSelection();
          editor.getState().setTool('select');
        }
        return;
      }

      // Copy — intercept the 'copy' event to write our marker to the system clipboard
      if (ctrl && e.key === 'c' && selectedIds.length > 0) {
        const slide = store.getState().presentation.slides[activeSlideId];
        if (slide) {
          const elements = selectedIds.map((id) => slide.elements[id]).filter(Boolean);
          editor.getState().setClipboard(elements.map((e) => JSON.parse(JSON.stringify(e))));
        }
        // Don't preventDefault — let the browser fire the 'copy' event,
        // which copyHandler will intercept to write our marker
        return;
      }

      // Cut
      if (ctrl && e.key === 'x' && selectedIds.length > 0) {
        const slide = store.getState().presentation.slides[activeSlideId];
        if (slide) {
          const elements = selectedIds.map((id) => slide.elements[id]).filter(Boolean);
          editor.getState().setClipboard(elements.map((e) => JSON.parse(JSON.stringify(e))));
          for (const id of selectedIds) {
            store.getState().hideElement(activeSlideId, id);
          }
          editor.getState().setSelectedElements([]);
        }
        // Don't preventDefault — let the browser fire the 'cut' event
        return;
      }

      // Paste — don't preventDefault, let the browser fire the 'paste' event
      // which handlePaste will process (system clipboard content takes priority
      // over internal element clipboard)
      if (ctrl && e.key === 'v') {
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

      // Tool hotkeys
      if (!ctrl && !isInput) {
        switch (e.key.toLowerCase()) {
          case 'v': editor.getState().setTool('select'); break;
          case 't': editor.getState().setTool('text'); break;
          case 'r': editor.getState().setTool('rect'); break;
          case 'e': editor.getState().setTool('ellipse'); break;
          case 'l': editor.getState().setTool('line'); break;
          case 'a': editor.getState().setTool('arrow'); break;
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
      if (ctrl && selectedIds.length === 1) {
        const slide = store.getState().presentation.slides[activeSlideId];
        const el = slide?.elements[selectedIds[0]];
        if (el && el.type === 'text') {
          const textEl = el as import('../types/presentation').TextElement;
          if (e.key === 'b') {
            e.preventDefault();
            store.getState().updateElement(activeSlideId, textEl.id, {
              style: { ...textEl.style, fontWeight: textEl.style.fontWeight === 'bold' ? 'normal' : 'bold' },
            } as any);
          }
          if (e.key === 'i') {
            e.preventDefault();
            store.getState().updateElement(activeSlideId, textEl.id, {
              style: { ...textEl.style, fontStyle: textEl.style.fontStyle === 'italic' ? 'normal' : 'italic' },
            } as any);
          }
          if (e.key === 'u') {
            e.preventDefault();
            store.getState().updateElement(activeSlideId, textEl.id, {
              style: { ...textEl.style, textDecoration: textEl.style.textDecoration === 'underline' ? 'none' : 'underline' },
            } as any);
          }
        }
      }
    };

    const INTERNAL_MARKER = 'slides-internal-copy';

    // When the browser fires the copy/cut event (because we didn't preventDefault
    // in keydown), write our marker to the system clipboard. This replaces any
    // previous clipboard content (e.g., an old screenshot), so on paste we can
    // tell whether the clipboard is ours or from an external source.
    const handleCopy = (e: ClipboardEvent) => {
      const target = e.target as HTMLElement;
      const isInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' ||
        (target.isContentEditable && target !== clipboardProxy);
      if (isInput) return;
      if (editor.getState().isPresenting) return;

      // Only write marker if we actually have an internal clipboard
      if (editor.getState().clipboard.length > 0) {
        e.preventDefault();
        e.clipboardData?.setData('text/plain', INTERNAL_MARKER);
      }
    };

    const handlePaste = (e: ClipboardEvent) => {
      const target = e.target as HTMLElement;
      const isInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' ||
        (target.isContentEditable && target !== clipboardProxy);
      if (isInput) return;
      if (editor.getState().isPresenting) return;

      const items = e.clipboardData?.items;
      if (!items) return;

      // Check if this paste is from our own internal copy
      const plainText = e.clipboardData?.getData('text/plain');
      const isInternalCopy = plainText === INTERNAL_MARKER;

      // If it's our internal copy, use the internal element clipboard directly
      if (isInternalCopy) {
        const internalClipboard = editor.getState().clipboard;
        if (internalClipboard.length > 0) {
          e.preventDefault();
          const activeSlideId = editor.getState().activeSlideId;
          const duplicates = internalClipboard.map((el) => duplicateElement(el));
          store.getState().addElements(activeSlideId, duplicates);
          editor.getState().setSelectedElements(duplicates.map((el) => el.id));
        }
        return;
      }

      // External clipboard content — check for files/images
      const activeSlideId = editor.getState().activeSlideId;
      const existingResources = store.getState().presentation.resources;
      for (const item of Array.from(items)) {
        if (item.type === 'application/pdf') {
          const file = item.getAsFile();
          if (!file) continue;
          e.preventDefault();
          loadPdfFile(file, existingResources).then(({ resources, elements, isExisting }) => {
            if (!isExisting) {
              resources.forEach((r) => store.getState().addResource(r));
            }
            if (elements.length === 1) {
              store.getState().addElement(activeSlideId, elements[0]);
              editor.getState().setSelectedElements([elements[0].id]);
            } else {
              const { slideOrder } = store.getState().presentation;
              let insertIdx = slideOrder.indexOf(activeSlideId) + 1;
              let lastSlideId = '';
              for (const pageEl of elements) {
                const newSlideId = store.getState().addEmptySlide(insertIdx);
                store.getState().addElement(newSlideId, pageEl);
                lastSlideId = newSlideId;
                insertIdx++;
              }
              if (lastSlideId) editor.getState().setActiveSlide(lastSlideId);
            }
          });
          return;
        }
        if (item.type.startsWith('image/')) {
          const file = item.getAsFile();
          if (!file) continue;
          e.preventDefault();
          loadImageFile(file, undefined, existingResources).then(({ resource, element, isExisting }) => {
            if (!isExisting) {
              store.getState().addResource(resource);
            }
            store.getState().addElement(activeSlideId, element);
            editor.getState().setSelectedElements([element.id]);
          });
          return;
        }
        if (item.type.startsWith('video/')) {
          const file = item.getAsFile();
          if (!file) continue;
          e.preventDefault();
          loadVideoFile(file, undefined, existingResources).then(({ resource, element, isExisting }) => {
            if (!isExisting) {
              store.getState().addResource(resource);
            }
            store.getState().addElement(activeSlideId, element);
            editor.getState().setSelectedElements([element.id]);
          });
          return;
        }
      }
    };

    // Keep the proxy focused when no other input has focus
    const maintainFocus = () => {
      const active = document.activeElement;
      if (!active || active === document.body || active === clipboardProxy) {
        clipboardProxy.focus({ preventScroll: true });
      }
    };

    // Re-focus proxy when other elements blur
    const handleFocusOut = (e: FocusEvent) => {
      // If focus is leaving to body (nothing focused), grab it
      if (!e.relatedTarget || e.relatedTarget === document.body) {
        // Slight delay to let browser settle focus
        requestAnimationFrame(maintainFocus);
      }
    };

    // Initial focus
    maintainFocus();

    const handleMouseDown = () => requestAnimationFrame(maintainFocus);

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('paste', handlePaste);
    window.addEventListener('copy', handleCopy);
    window.addEventListener('cut', handleCopy);
    document.addEventListener('focusout', handleFocusOut);
    document.addEventListener('mousedown', handleMouseDown);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('paste', handlePaste);
      window.removeEventListener('copy', handleCopy);
      window.removeEventListener('cut', handleCopy);
      document.removeEventListener('focusout', handleFocusOut);
      document.removeEventListener('mousedown', handleMouseDown);
      document.body.removeChild(clipboardProxy);
    };
  }, []);
}
