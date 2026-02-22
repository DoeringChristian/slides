import { useEffect } from 'react';
import { AppLayout } from './components/layout/AppLayout';
import { PresenterView } from './components/presenter/PresenterView';
import { PresenterControlPanel } from './components/presenter/PresenterControlPanel';
import { AudienceView } from './components/presenter/AudienceView';
import { useEditorStore } from './store/editorStore';
import { usePresentationStore } from './store/presentationStore';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import { generateObjectName } from './utils/slideFactory';
import { generateId } from './utils/idGenerator';
import type { Presentation, ObjectMeta, Resource } from './types/presentation';

// Check if this is the audience window
const isAudienceMode = new URLSearchParams(window.location.search).get('audience') === 'true';

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

  // Migrate image elements: extract src into resources
  if (!data.resources) {
    const resources: Record<string, Resource> = {};
    const srcToResourceId: Record<string, string> = {}; // Dedup by src

    // Collect all image elements from slides
    for (const slideId of data.slideOrder) {
      const slide = data.slides[slideId];
      if (!slide) continue;
      for (const elId of slide.elementOrder) {
        const el = slide.elements[elId];
        if (!el || el.type !== 'image') continue;
        if (el.src) {
          // Check if we already have a resource for this src
          let resourceId = srcToResourceId[el.src];
          if (!resourceId) {
            resourceId = generateId();
            srcToResourceId[el.src] = resourceId;
            resources[resourceId] = {
              id: resourceId,
              name: `Image ${Object.keys(resources).length + 1}`,
              type: 'image',
              src: el.src,
              originalWidth: el.originalWidth || 100,
              originalHeight: el.originalHeight || 100,
            };
          }
          // Update element: replace src with resourceId, remove originalWidth/originalHeight
          el.resourceId = resourceId;
          delete el.src;
          delete el.originalWidth;
          delete el.originalHeight;
        }
      }
    }

    // Also migrate templates
    if (data.templates) {
      for (const templateId of Object.keys(data.templates)) {
        const template = data.templates[templateId];
        if (!template) continue;
        for (const elId of template.elementOrder) {
          const el = template.elements[elId];
          if (!el || el.type !== 'image') continue;
          if (el.src) {
            let resourceId = srcToResourceId[el.src];
            if (!resourceId) {
              resourceId = generateId();
              srcToResourceId[el.src] = resourceId;
              resources[resourceId] = {
                id: resourceId,
                name: `Image ${Object.keys(resources).length + 1}`,
                type: 'image',
                src: el.src,
                originalWidth: el.originalWidth || 100,
                originalHeight: el.originalHeight || 100,
              };
            }
            el.resourceId = resourceId;
            delete el.src;
            delete el.originalWidth;
            delete el.originalHeight;
          }
        }
      }
    }

    data.resources = resources;
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

  // Render audience view for spawned presentation window
  if (isAudienceMode) {
    return <AudienceView />;
  }

  return (
    <>
      <AppLayout />
      <PresenterView />
      <PresenterControlPanel />
    </>
  );
}

export default App;
