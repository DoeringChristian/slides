import React, { useCallback, useState } from 'react';
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { SlideSortable } from './SlideSortable';
import { usePresentationStore } from '../../store/presentationStore';
import { useEditorStore } from '../../store/editorStore';
import { useOrderedSlides } from '../../store/selectors';
import { InsertSlideDialog } from '../dialogs/InsertSlideDialog';
import { Plus } from 'lucide-react';
import type { DragEndEvent } from '@dnd-kit/core';

export const SlidePanel: React.FC = () => {
  const slides = useOrderedSlides();
  const slideOrder = usePresentationStore((s) => s.presentation.slideOrder);
  const reorderSlides = usePresentationStore((s) => s.reorderSlides);
  const addSlide = usePresentationStore((s) => s.addSlide);
  const deleteSlide = usePresentationStore((s) => s.deleteSlide);
  const duplicateSlide = usePresentationStore((s) => s.duplicateSlide);
  const addSlideWithMode = usePresentationStore((s) => s.addSlideWithMode);
  const activeSlideId = useEditorStore((s) => s.activeSlideId);
  const setActiveSlide = useEditorStore((s) => s.setActiveSlide);

  const [insertDialog, setInsertDialog] = useState<{ open: boolean; afterIndex: number }>({ open: false, afterIndex: 0 });

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

  const handleInsertSlide = useCallback((afterIndex: number) => {
    const hasNext = afterIndex + 1 < slideOrder.length;
    const hasPrev = afterIndex >= 0;

    if (hasPrev && hasNext) {
      // Between two slides — show dialog
      setInsertDialog({ open: true, afterIndex });
    } else {
      // At end or beginning — just copy from neighbor
      const id = addSlide(afterIndex + 1);
      setActiveSlide(id);
    }
  }, [slideOrder, addSlide, setActiveSlide]);

  const handleAddSlide = () => {
    const currentIdx = slideOrder.indexOf(activeSlideId);
    handleInsertSlide(currentIdx);
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
      { label: 'Insert slide after', action: () => { handleInsertSlide(idx); } },
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
  }, [slideOrder, addSlide, deleteSlide, duplicateSlide, setActiveSlide, handleInsertSlide]);

  return (
    <>
      <div className="w-60 bg-white border-r border-gray-200 flex flex-col shrink-0">
        <div className="p-2 border-b border-gray-200 flex items-center justify-between">
          <span className="text-xs font-medium text-gray-500 uppercase">Slides</span>
          <button
            onClick={handleAddSlide}
            className="p-1 rounded hover:bg-gray-100 text-gray-600"
            title="Add Slide"
          >
            <Plus size={16} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto">
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={slideOrder} strategy={verticalListSortingStrategy}>
              {slides.map((slide, index) => (
                <div key={slide.id} onContextMenu={(e) => handleContextMenu(e, slide.id)}>
                  <SlideSortable
                    slide={slide}
                    index={index}
                    isActive={slide.id === activeSlideId}
                    onClick={() => setActiveSlide(slide.id)}
                  />
                </div>
              ))}
            </SortableContext>
          </DndContext>
        </div>
      </div>

      <InsertSlideDialog
        isOpen={insertDialog.open}
        onConfirm={(mode) => {
          const id = addSlideWithMode(insertDialog.afterIndex, mode);
          setActiveSlide(id);
          setInsertDialog({ open: false, afterIndex: 0 });
        }}
        onCancel={() => setInsertDialog({ open: false, afterIndex: 0 })}
      />
    </>
  );
};
