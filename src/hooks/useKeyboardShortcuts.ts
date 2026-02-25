import { useEffect } from 'react';
import { useEditorStore } from '../store/editorStore';
import { usePresentationStore } from '../store/presentationStore';
import { duplicateElement, loadImageFile } from '../utils/slideFactory';

export function useKeyboardShortcuts() {
  const store = usePresentationStore;
  const editor = useEditorStore;

  useEffect(() => {
    const INTERNAL_MARKER = 'slides-internal-copy';

    const handleKeyDown = (e: KeyboardEvent) => {
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

      // Copy
      if (ctrl && e.key === 'c' && selectedIds.length > 0) {
        e.preventDefault();
        const slide = store.getState().presentation.slides[activeSlideId];
        if (slide) {
          const elements = selectedIds.map((id) => slide.elements[id]).filter(Boolean);
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
          const elements = selectedIds.map((id) => slide.elements[id]).filter(Boolean);
          editor.getState().setClipboard(elements.map((e) => JSON.parse(JSON.stringify(e))));
          for (const id of selectedIds) {
            store.getState().hideElement(activeSlideId, id);
          }
          editor.getState().setSelectedElements([]);
          navigator.clipboard.writeText(INTERNAL_MARKER).catch(() => {});
        }
        return;
      }

      // Paste
      if (ctrl && e.key === 'v') {
        e.preventDefault();

        // Read clipboard via the paste event by manually triggering
        // document.execCommand('paste') on the proxy — but that's deprecated.
        // Instead, handle paste logic directly here using navigator.clipboard.
        const activeId = editor.getState().activeSlideId;

        // Try to read files from clipboard (images)
        if (navigator.clipboard && navigator.clipboard.read) {
          navigator.clipboard.read().then(async (clipboardItems) => {
            const existingResources = store.getState().presentation.resources;
            for (const item of clipboardItems) {
              // Check for images
              const imageType = item.types.find(t => t.startsWith('image/'));
              if (imageType) {
                const blob = await item.getType(imageType);
                const file = new File([blob], 'pasted-image.png', { type: imageType });
                const { resource, element, isExisting } = await loadImageFile(file, undefined, existingResources);
                if (!isExisting) {
                  store.getState().addResource(resource);
                }
                store.getState().addElement(activeId, element);
                editor.getState().setSelectedElements([element.id]);
                return;
              }
            }

            // No image — check for our internal marker
            for (const item of clipboardItems) {
              if (item.types.includes('text/plain')) {
                const blob = await item.getType('text/plain');
                const text = await blob.text();
                if (text === INTERNAL_MARKER) {
                  const internalClipboard = editor.getState().clipboard;
                  if (internalClipboard.length > 0) {
                    const duplicates = internalClipboard.map((el) => duplicateElement(el));
                    store.getState().addElements(activeId, duplicates);
                    editor.getState().setSelectedElements(duplicates.map((el) => el.id));
                  }
                }
              }
            }
          }).catch(() => {
            // Permission denied or not supported — fall back to internal clipboard
            const internalClipboard = editor.getState().clipboard;
            if (internalClipboard.length > 0) {
              const duplicates = internalClipboard.map((el) => duplicateElement(el));
              store.getState().addElements(activeId, duplicates);
              editor.getState().setSelectedElements(duplicates.map((el) => el.id));
            }
          });
        } else {
          // Fallback for browsers without clipboard API
          const internalClipboard = editor.getState().clipboard;
          if (internalClipboard.length > 0) {
            const duplicates = internalClipboard.map((el) => duplicateElement(el));
            store.getState().addElements(activeId, duplicates);
            editor.getState().setSelectedElements(duplicates.map((el) => el.id));
          }
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

    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, []);
}
