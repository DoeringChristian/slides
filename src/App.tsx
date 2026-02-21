import React, { useEffect } from 'react';
import { AppLayout } from './components/layout/AppLayout';
import { PresenterView } from './components/presenter/PresenterView';
import { useEditorStore } from './store/editorStore';
import { usePresentationStore } from './store/presentationStore';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import { generateObjectName } from './utils/slideFactory';
import type { Presentation, ObjectMeta } from './types/presentation';

function migratePresentation(data: any): Presentation {
  if (!data.objects) {
    const objects: Record<string, ObjectMeta> = {};
    for (const slideId of data.slideOrder) {
      const slide = data.slides[slideId];
      if (!slide) continue;
      for (const elId of slide.elementOrder) {
        const el = slide.elements[elId];
        if (!el || objects[elId]) continue;
        const subtype = el.type === 'shape' ? el.shapeType : el.type;
        objects[elId] = {
          id: elId,
          name: generateObjectName(subtype, objects),
          type: el.type === 'text' ? 'text' : el.type === 'image' ? 'image' : 'shape',
        };
      }
    }
    data.objects = objects;
  }
  // Normalize transition format: remove legacy type field
  for (const slideId of data.slideOrder) {
    const slide = data.slides[slideId];
    if (slide?.transition?.type !== undefined) {
      slide.transition = { duration: slide.transition.duration || 300 };
    }
  }
  return data as Presentation;
}

function App() {
  const setActiveSlide = useEditorStore((s) => s.setActiveSlide);
  const activeSlideId = useEditorStore((s) => s.activeSlideId);
  const slideOrder = usePresentationStore((s) => s.presentation.slideOrder);

  // Initialize active slide on mount
  useEffect(() => {
    if (!activeSlideId && slideOrder.length > 0) {
      setActiveSlide(slideOrder[0]);
    }
  }, [activeSlideId, slideOrder, setActiveSlide]);

  // Auto-save to localStorage
  useEffect(() => {
    const unsub = usePresentationStore.subscribe((state) => {
      try {
        localStorage.setItem('slides-presentation', JSON.stringify(state.presentation));
      } catch { /* ignore quota errors */ }
    });
    return unsub;
  }, []);

  // Load from localStorage on mount
  useEffect(() => {
    try {
      const saved = localStorage.getItem('slides-presentation');
      if (saved) {
        const data = JSON.parse(saved);
        if (data && data.slideOrder && data.slideOrder.length > 0) {
          const migrated = migratePresentation(data);
          usePresentationStore.getState().loadPresentation(migrated);
          setActiveSlide(migrated.slideOrder[0]);
        }
      }
    } catch { /* ignore parse errors */ }
  }, [setActiveSlide]);

  useKeyboardShortcuts();

  return (
    <>
      <AppLayout />
      <PresenterView />
    </>
  );
}

export default App;
