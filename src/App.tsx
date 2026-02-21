import React, { useEffect } from 'react';
import { AppLayout } from './components/layout/AppLayout';
import { PresenterView } from './components/presenter/PresenterView';
import { useEditorStore } from './store/editorStore';
import { usePresentationStore } from './store/presentationStore';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';

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
          usePresentationStore.getState().loadPresentation(data);
          setActiveSlide(data.slideOrder[0]);
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
