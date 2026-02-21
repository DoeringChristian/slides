import React, { useCallback, useRef, useState } from 'react';
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { SlideSortable } from './SlideSortable';
import { usePresentationStore } from '../../store/presentationStore';
import { useEditorStore } from '../../store/editorStore';
import { useOrderedSlides } from '../../store/selectors';
import { Plus, ArrowDown, ArrowUp, Blend, FilePlus2, LayoutTemplate } from 'lucide-react';
import { TemplatePicker } from './TemplatePicker';
import type { DragEndEvent } from '@dnd-kit/core';

interface SlideInsertRowProps {
  afterIndex: number;
  hasPrevious: boolean;
  hasNext: boolean;
  onInsert: (afterIndex: number, mode: 'previous' | 'next' | 'interpolate') => void;
  onInsertEmpty: (afterIndex: number) => void;
}

const SlideInsertRow: React.FC<SlideInsertRowProps> = ({ afterIndex, hasPrevious, hasNext, onInsert, onInsertEmpty }) => {
  return (
    <div className="group relative h-0 z-10 flex items-center justify-center">
      <div className="absolute inset-x-0 top-0 flex items-center justify-center -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
        <div className="flex items-center gap-1 bg-white/90 backdrop-blur-sm border border-gray-200 rounded-full shadow-md px-1.5 py-1 pointer-events-auto">
          {hasPrevious && (
            <button
              onClick={() => onInsert(afterIndex, 'previous')}
              className="p-1.5 rounded-full hover:bg-blue-100 text-gray-400 hover:text-blue-600 transition-colors"
              title="Copy from above"
            >
              <ArrowDown size={18} />
            </button>
          )}
          {hasPrevious && hasNext && (
            <button
              onClick={() => onInsert(afterIndex, 'interpolate')}
              className="p-1.5 rounded-full hover:bg-purple-100 text-gray-400 hover:text-purple-600 transition-colors"
              title="Interpolate"
            >
              <Blend size={18} />
            </button>
          )}
          {hasNext && (
            <button
              onClick={() => onInsert(afterIndex, 'next')}
              className="p-1.5 rounded-full hover:bg-blue-100 text-gray-400 hover:text-blue-600 transition-colors"
              title="Copy from below"
            >
              <ArrowUp size={18} />
            </button>
          )}
          <button
            onClick={() => onInsertEmpty(afterIndex)}
            className="p-1.5 rounded-full hover:bg-green-100 text-gray-400 hover:text-green-600 transition-colors"
            title="New empty slide"
          >
            <FilePlus2 size={18} />
          </button>
        </div>
      </div>
    </div>
  );
};

export const SlidePanel: React.FC = () => {
  const slides = useOrderedSlides();
  const slideOrder = usePresentationStore((s) => s.presentation.slideOrder);
  const reorderSlides = usePresentationStore((s) => s.reorderSlides);
  const addSlide = usePresentationStore((s) => s.addSlide);
  const deleteSlide = usePresentationStore((s) => s.deleteSlide);
  const duplicateSlide = usePresentationStore((s) => s.duplicateSlide);
  const addSlideWithMode = usePresentationStore((s) => s.addSlideWithMode);
  const addEmptySlide = usePresentationStore((s) => s.addEmptySlide);
  const activeSlideId = useEditorStore((s) => s.activeSlideId);
  const selectedElementIds = useEditorStore((s) => s.selectedElementIds);
  const setActiveSlide = useEditorStore((s) => s.setActiveSlide);

  const [templatePickerOpen, setTemplatePickerOpen] = useState(false);
  const templateBtnRef = useRef<HTMLButtonElement>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  );

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = slideOrder.indexOf(active.id as string);
    const newIndex = slideOrder.indexOf(over.id as string);
    const newOrder = [...slideOrder];
    newOrder.splice(oldIndex, 1);
    newOrder.splice(newIndex, 0, active.id as string);
    reorderSlides(newOrder);
  }, [slideOrder, reorderSlides]);

  const handleInsert = useCallback((afterIndex: number, mode: 'previous' | 'next' | 'interpolate') => {
    const id = addSlideWithMode(afterIndex, mode);
    setActiveSlide(id);
  }, [addSlideWithMode, setActiveSlide]);

  const handleInsertEmpty = useCallback((afterIndex: number) => {
    const id = addEmptySlide(afterIndex + 1);
    setActiveSlide(id);
  }, [addEmptySlide, setActiveSlide]);

  const handleAddSlide = () => {
    const currentIdx = slideOrder.indexOf(activeSlideId);
    const id = addSlide(currentIdx + 1);
    setActiveSlide(id);
  };

  const handleContextMenu = useCallback((e: React.MouseEvent, slideId: string) => {
    e.preventDefault();
    const menu = document.createElement('div');
    menu.className = 'fixed bg-white rounded-lg shadow-lg border border-gray-200 py-1 z-[100] text-sm';
    menu.style.left = `${e.clientX}px`;
    menu.style.top = `${e.clientY}px`;

    const idx = slideOrder.indexOf(slideId);
    const items = [
      { label: 'Duplicate', action: () => { const id = duplicateSlide(slideId); if (id) setActiveSlide(id); } },
      { label: 'Delete', action: () => { if (slideOrder.length > 1) { deleteSlide(slideId); const remaining = slideOrder.filter(id => id !== slideId); setActiveSlide(remaining[0]); } } },
      { label: 'Insert slide after', action: () => { const id = addSlide(idx + 1); setActiveSlide(id); } },
    ];

    items.forEach(({ label, action }) => {
      const btn = document.createElement('button');
      btn.className = 'block w-full text-left px-4 py-1.5 hover:bg-gray-100';
      btn.textContent = label;
      btn.onclick = () => { action(); menu.remove(); };
      menu.appendChild(btn);
    });

    document.body.appendChild(menu);
    const remove = () => { menu.remove(); document.removeEventListener('click', remove); };
    setTimeout(() => document.addEventListener('click', remove), 0);
  }, [slideOrder, addSlide, deleteSlide, duplicateSlide, setActiveSlide]);

  return (
    <div className="w-60 bg-white border-r border-gray-200 flex flex-col shrink-0">
      <div className="p-2 border-b border-gray-200 flex items-center justify-between">
        <span className="text-xs font-medium text-gray-500 uppercase">Slides</span>
        <div className="relative flex items-center gap-0.5">
          <button
            ref={templateBtnRef}
            onClick={() => setTemplatePickerOpen((v) => !v)}
            className="p-1 rounded hover:bg-gray-100 text-gray-600"
            title="Templates"
          >
            <LayoutTemplate size={16} />
          </button>
          <TemplatePicker
            open={templatePickerOpen}
            onClose={() => setTemplatePickerOpen(false)}
            anchorRef={templateBtnRef}
          />
          <button
            onClick={handleAddSlide}
            className="p-1 rounded hover:bg-gray-100 text-gray-600"
            title="Add Slide"
          >
            <Plus size={16} />
          </button>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto">
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={slideOrder} strategy={verticalListSortingStrategy}>
            {slides.map((slide, index) => (
              <React.Fragment key={slide.id}>
                {index === 0 && (
                  <SlideInsertRow
                    afterIndex={-1}
                    hasPrevious={false}
                    hasNext={true}
                    onInsert={handleInsert}
                    onInsertEmpty={handleInsertEmpty}
                  />
                )}

                <div onContextMenu={(e) => handleContextMenu(e, slide.id)}>
                  <SlideSortable
                    slide={slide}
                    index={index}
                    isActive={slide.id === activeSlideId}
                    selectedElementIds={selectedElementIds}
                    onClick={() => setActiveSlide(slide.id)}
                  />
                </div>

                <SlideInsertRow
                  afterIndex={index}
                  hasPrevious={true}
                  hasNext={index < slides.length - 1}
                  onInsert={handleInsert}
                  onInsertEmpty={handleInsertEmpty}
                />
              </React.Fragment>
            ))}
          </SortableContext>
        </DndContext>
      </div>
    </div>
  );
};
