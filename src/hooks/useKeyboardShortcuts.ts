import { useEffect } from 'react';
import { useEditorStore } from '../store/editorStore';
import { usePresentationStore } from '../store/presentationStore';
import { duplicateElement, loadImageFile, loadPdfFile, loadVideoFile } from '../utils/slideFactory';

export function useKeyboardShortcuts() {
  const store = usePresentationStore;
  const editor = useEditorStore;

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const isInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;

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
      if (ctrl && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        (store as any).temporal?.getState()?.undo();
        return;
      }
      if (ctrl && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
        e.preventDefault();
        (store as any).temporal?.getState()?.redo();
        return;
      }

      // Skip other shortcuts when in text edit mode
      if (editor.getState().editingTextId && !ctrl) return;

      const activeSlideId = editor.getState().activeSlideId;
      const selectedIds = editor.getState().selectedElementIds;

      // Delete — remove elements completely, or delete slide if nothing selected
      if ((e.key === 'Delete' || e.key === 'Backspace') && !isInput) {
        if (selectedIds.length > 0) {
          e.preventDefault();
          for (const id of selectedIds) {
            store.getState().removeObject(id);
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
        }
        return;
      }

      // Cut — hide elements instead of removing
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
        }
        return;
      }

      // Paste (internal elements only — image paste is handled via 'paste' event)
      if (ctrl && e.key === 'v') {
        const clipboard = editor.getState().clipboard;
        if (clipboard.length > 0) {
          e.preventDefault();
          const newIds: string[] = [];
          clipboard.forEach((el) => {
            const dup = duplicateElement(el);
            store.getState().addElement(activeSlideId, dup);
            newIds.push(dup.id);
          });
          editor.getState().setSelectedElements(newIds);
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

    const handlePaste = (e: ClipboardEvent) => {
      const target = e.target as HTMLElement;
      const isInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;
      if (isInput) return;
      if (editor.getState().isPresenting) return;

      const items = e.clipboardData?.items;
      if (!items) return;

      const activeSlideId = editor.getState().activeSlideId;
      for (const item of Array.from(items)) {
        if (item.type === 'application/pdf') {
          const file = item.getAsFile();
          if (!file) continue;
          e.preventDefault();
          loadPdfFile(file).then(({ resources, elements }) => {
            resources.forEach((r) => store.getState().addResource(r));
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
          loadImageFile(file).then(({ resource, element }) => {
            store.getState().addResource(resource);
            store.getState().addElement(activeSlideId, element);
            editor.getState().setSelectedElements([element.id]);
          });
          return;
        }
        if (item.type.startsWith('video/')) {
          const file = item.getAsFile();
          if (!file) continue;
          e.preventDefault();
          loadVideoFile(file).then(({ resource, element }) => {
            store.getState().addResource(resource);
            store.getState().addElement(activeSlideId, element);
            editor.getState().setSelectedElements([element.id]);
          });
          return;
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('paste', handlePaste);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('paste', handlePaste);
    };
  }, []);
}
