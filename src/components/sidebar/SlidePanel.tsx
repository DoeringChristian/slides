import React, { useCallback, useMemo, useRef, useState } from 'react';
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { SlideSortable } from './SlideSortable';
import type { SlideGroupInfo } from './SlideThumbnail';
import { usePresentationStore } from '../../store/presentationStore';
import { useEditorStore } from '../../store/editorStore';
import { useOrderedSlides, useGroupRuns } from '../../store/selectors';
import { areSlidesContiguous, groupColorFor } from '../../utils/presenterAdvance';
import { foldedSlideIds, slideGroupRunKey } from '../../utils/slideGroupEditing';
import { ChevronDown, ChevronRight, Scissors, Minus, Plus, ArrowDown, ArrowUp, Blend, FilePlus2, LayoutTemplate, Group, Ungroup } from 'lucide-react';
import { TemplatePicker } from './TemplatePicker';
import type { DragEndEvent } from '@dnd-kit/core';

interface SlideInsertRowProps {
  afterIndex: number;
  hasPrevious: boolean;
  hasNext: boolean;
  onInsert: (afterIndex: number, mode: 'previous' | 'next' | 'interpolate') => void;
  onInsertEmpty: (afterIndex: number) => void;
  onOpenTemplatePicker: (insertIndex: number, anchorRect: DOMRect) => void;
}

const SlideInsertRow: React.FC<SlideInsertRowProps> = ({ afterIndex, hasPrevious, hasNext, onInsert, onInsertEmpty, onOpenTemplatePicker }) => {
  return (
    <div className="group relative h-0 z-10 flex items-center justify-center">
      <div className="absolute inset-x-0 top-0 flex items-center justify-center -translate-y-1/2 opacity-0 group-hover:opacity-100 coarse:opacity-100 transition-opacity pointer-events-none">
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
          <button
            data-template-trigger
            onClick={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              onOpenTemplatePicker(afterIndex + 1, rect);
            }}
            className="p-1.5 rounded-full hover:bg-orange-100 text-gray-400 hover:text-orange-600 transition-colors"
            title="Insert from template"
          >
            <LayoutTemplate size={18} />
          </button>
        </div>
      </div>
    </div>
  );
};

interface PickerState {
  insertIndex: number;
  anchorRect: DOMRect;
}

export const SlidePanel: React.FC = () => {
  const slides = useOrderedSlides();
  const slideOrder = usePresentationStore((s) => s.presentation.slideOrder);
  const reorderSlides = usePresentationStore((s) => s.reorderSlides);
  const addSlide = usePresentationStore((s) => s.addSlide);
  const deleteSlide = usePresentationStore((s) => s.deleteSlide);
  const duplicateSlide = usePresentationStore((s) => s.duplicateSlide);
  const addSlideWithMode = usePresentationStore((s) => s.addSlideWithMode);
  const addEmptySlide = usePresentationStore((s) => s.addEmptySlide);
  const toggleSlideHidden = usePresentationStore((s) => s.toggleSlideHidden);
  const slidesById = usePresentationStore((s) => s.presentation.slides);
  const groupSlides = usePresentationStore((s) => s.groupSlides);
  const ungroupSlides = usePresentationStore((s) => s.ungroupSlides);
  const splitSlideGroup = usePresentationStore((s) => s.splitSlideGroup);
  const removeSlideFromGroup = usePresentationStore((s) => s.removeSlideFromGroup);
  const activeSlideId = useEditorStore((s) => s.activeSlideId);
  const setActiveSlide = useEditorStore((s) => s.setActiveSlide);
  const selectedSlideIds = useEditorStore((s) => s.selectedSlideIds);
  const setSelectedSlides = useEditorStore((s) => s.setSelectedSlides);

  const [lastClickedSlideId, setLastClickedSlideId] = useState<string | null>(null);

  const [pickerState, setPickerState] = useState<PickerState | null>(null);

  // Slide-group runs + per-slide visuals (colored rail, joined corners).
  const runs = useGroupRuns();
  const [collapsedRuns, setCollapsedRuns] = useState<Set<string>>(() => new Set());
  const toggleRun = (key: string) => setCollapsedRuns(previous => {
    const next = new Set(previous);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });
  const foldedIds = foldedSlideIds(runs, collapsedRuns, activeSlideId);
  const runBySlide = new Map(runs.flatMap(run => run.slideIds.map(id => [id, run] as const)));
  const activeRun = runBySlide.get(activeSlideId);
  const groupInfoBySlide = useMemo(() => {
    const map = new Map<string, SlideGroupInfo>();
    for (const run of runs) {
      const color = groupColorFor(run.groupId);
      run.slideIds.forEach((sid, i) => {
        map.set(sid, { color, isStart: i === 0, isEnd: i === run.slideIds.length - 1 });
      });
    }
    return map;
  }, [runs]);

  const canGroup = selectedSlideIds.length >= 2 && areSlidesContiguous(slideOrder, selectedSlideIds);
  const canUngroup = selectedSlideIds.some((id) => !!slidesById[id]?.groupId);

  const handleGroupSelected = useCallback(() => {
    groupSlides(selectedSlideIds);
  }, [groupSlides, selectedSlideIds]);

  const handleUngroupSelected = useCallback(() => {
    ungroupSlides(selectedSlideIds);
  }, [ungroupSlides, selectedSlideIds]);

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

  const handleDeleteSlide = useCallback((slideId: string) => {
    if (slideOrder.length <= 1) return;
    const idx = slideOrder.indexOf(slideId);
    const nextActive = slideOrder[idx === slideOrder.length - 1 ? idx - 1 : idx + 1];
    deleteSlide(slideId);
    if (slideId === activeSlideId) setActiveSlide(nextActive);
  }, [slideOrder, deleteSlide, activeSlideId, setActiveSlide]);

  const handleSlideClick = useCallback((slideId: string, e: React.MouseEvent) => {
    if (e.shiftKey && lastClickedSlideId) {
      // Shift-click: select range from last clicked to current
      const lastIdx = slideOrder.indexOf(lastClickedSlideId);
      const currentIdx = slideOrder.indexOf(slideId);
      const startIdx = Math.min(lastIdx, currentIdx);
      const endIdx = Math.max(lastIdx, currentIdx);
      const rangeIds = slideOrder.slice(startIdx, endIdx + 1);
      setSelectedSlides(rangeIds);
      // Don't change active slide on shift-click, just the selection
    } else if (e.ctrlKey || e.metaKey) {
      // Ctrl/Cmd-click: toggle selection
      const newSelection = selectedSlideIds.includes(slideId)
        ? selectedSlideIds.filter((id) => id !== slideId)
        : [...selectedSlideIds, slideId];
      // Ensure at least the active slide remains selected
      if (newSelection.length === 0 || !newSelection.includes(activeSlideId)) {
        setSelectedSlides([...newSelection, activeSlideId]);
      } else {
        setSelectedSlides(newSelection);
      }
      setLastClickedSlideId(slideId);
    } else {
      // Normal click: set as active and reset selection to just this slide
      setActiveSlide(slideId);
      setSelectedSlides([slideId]);
      setLastClickedSlideId(slideId);
    }
  }, [slideOrder, lastClickedSlideId, selectedSlideIds, activeSlideId, setActiveSlide, setSelectedSlides]);

  const handleOpenTemplatePicker = useCallback((insertIndex: number, anchorRect: DOMRect) => {
    setPickerState((prev) => {
      // Toggle off if already open at the same position
      if (prev && prev.insertIndex === insertIndex) return null;
      return { insertIndex, anchorRect };
    });
  }, []);

  const handleCloseTemplatePicker = useCallback(() => {
    setPickerState(null);
  }, []);

  const handleAddSlide = () => {
    const currentIdx = slideOrder.indexOf(activeSlideId);
    const id = addSlide(currentIdx + 1);
    setActiveSlide(id);
  };

  const handleHeaderTemplateClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    if (pickerState) {
      setPickerState(null);
    } else {
      const rect = e.currentTarget.getBoundingClientRect();
      const currentIdx = slideOrder.indexOf(activeSlideId);
      setPickerState({ insertIndex: currentIdx + 1, anchorRect: rect });
    }
  };

  // Show a small context menu at the given screen coords. Used by both
  // right-click (onContextMenu) and long-press (touch). Keep the menu
  // identical to avoid two divergent context paths.
  const showSlideContextMenu = useCallback((slideId: string, clientX: number, clientY: number) => {
    const menu = document.createElement('div');
    menu.className = 'fixed bg-white rounded-lg shadow-lg border border-gray-200 py-1 z-[100] text-sm';
    menu.style.left = `${clientX}px`;
    menu.style.top = `${clientY}px`;

    const idx = slideOrder.indexOf(slideId);
    const items = [
      { label: 'Duplicate', action: () => { const id = duplicateSlide(slideId); if (id) setActiveSlide(id); } },
      { label: 'Delete', action: () => { if (slideOrder.length > 1) { deleteSlide(slideId); const remaining = slideOrder.filter(id => id !== slideId); setActiveSlide(remaining[0]); } } },
      { label: 'Insert slide after', action: () => { const id = addSlide(idx + 1); setActiveSlide(id); } },
    ];
    // Slide groups: offer Group when the multi-selection includes this slide
    // and is contiguous; offer Ungroup when this slide belongs to a group.
    if (selectedSlideIds.includes(slideId) && areSlidesContiguous(slideOrder, selectedSlideIds)) {
      items.push({ label: `Group ${selectedSlideIds.length} slides`, action: () => { groupSlides(selectedSlideIds); } });
    }
    if (slidesById[slideId]?.groupId) {
      const run = runs.find(r => r.slideIds.includes(slideId));
      if (run && run.slideIds[0] !== slideId) {
        items.push({ label: 'Split group before this slide', action: () => splitSlideGroup(slideId) });
      }
      items.push({ label: 'Remove slide from group', action: () => removeSlideFromGroup(slideId) });
      items.push({ label: 'Ungroup', action: () => { ungroupSlides([slideId]); } });
    }

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
  }, [slideOrder, addSlide, deleteSlide, duplicateSlide, setActiveSlide, selectedSlideIds, slidesById, groupSlides, ungroupSlides, runs, splitSlideGroup, removeSlideFromGroup]);

  const handleContextMenu = useCallback((e: React.MouseEvent, slideId: string) => {
    e.preventDefault();
    showSlideContextMenu(slideId, e.clientX, e.clientY);
  }, [showSlideContextMenu]);

  // Long-press (touch / stylus) replaces onContextMenu. 500 ms hold with no
  // movement > 8 px fires the same menu the right-click path uses.
  const longPressTimer = useRef<number | null>(null);
  const longPressStart = useRef<{ x: number; y: number; pointerId: number; slideId: string } | null>(null);
  const longPressFired = useRef(false);

  const cancelLongPress = useCallback(() => {
    if (longPressTimer.current !== null) {
      window.clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
    longPressStart.current = null;
  }, []);

  const handleSlidePointerDown = useCallback((e: React.PointerEvent, slideId: string) => {
    // Don't intercept mouse — right-click handles its own path. Only touch /
    // pen need long-press to surface the context menu.
    if (e.pointerType === 'mouse') return;
    longPressFired.current = false;
    longPressStart.current = { x: e.clientX, y: e.clientY, pointerId: e.pointerId, slideId };
    longPressTimer.current = window.setTimeout(() => {
      longPressTimer.current = null;
      if (longPressStart.current) {
        longPressFired.current = true;
        showSlideContextMenu(slideId, longPressStart.current.x, longPressStart.current.y);
      }
    }, 500);
  }, [showSlideContextMenu]);

  const handleSlidePointerMove = useCallback((e: React.PointerEvent) => {
    if (!longPressStart.current || longPressStart.current.pointerId !== e.pointerId) return;
    const dx = e.clientX - longPressStart.current.x;
    const dy = e.clientY - longPressStart.current.y;
    if (Math.hypot(dx, dy) > 8) cancelLongPress();
  }, [cancelLongPress]);

  const handleSlidePointerUp = useCallback(() => {
    cancelLongPress();
  }, [cancelLongPress]);

  const handleEmptySpaceClick = useCallback((e: React.MouseEvent) => {
    // Only reset if clicking directly on the container (empty space), not on children
    if (e.target === e.currentTarget) {
      setSelectedSlides([activeSlideId]);
    }
  }, [activeSlideId, setSelectedSlides]);

  return (
    <div className="w-60 bg-white border-r border-gray-200 flex flex-col shrink-0">
      <div className="p-2 border-b border-gray-200 flex items-center justify-between">
        <span className="text-xs font-medium text-gray-500 uppercase">Slides</span>
        <div className="flex items-center gap-0.5">
          <button
            onClick={handleGroupSelected}
            disabled={!canGroup}
            className="p-1 rounded hover:bg-gray-100 text-gray-600 disabled:opacity-30 disabled:hover:bg-transparent"
            title="Group selected slides (auto-play as a timed chain)"
          >
            <Group size={16} />
          </button>
          <button
            onClick={handleUngroupSelected}
            disabled={!canUngroup}
            className="p-1 rounded hover:bg-gray-100 text-gray-600 disabled:opacity-30 disabled:hover:bg-transparent"
            title="Ungroup selected slides"
          >
            <Ungroup size={16} />
          </button>
          <button
            data-template-trigger
            onClick={handleHeaderTemplateClick}
            className="p-1 rounded hover:bg-gray-100 text-gray-600"
            title="Templates"
          >
            <LayoutTemplate size={16} />
          </button>
          <button
            onClick={handleAddSlide}
            className="p-1 rounded hover:bg-gray-100 text-gray-600"
            title="Add Slide"
          >
            <Plus size={16} />
          </button>
        </div>
      </div>
      {activeRun && (
        <div className="px-2 py-1 border-b text-xs flex items-center gap-1">
          <span className="flex-1 text-gray-500">Active slide's group</span>
          <button title="Split group before active slide"
            aria-label="Split group before active slide"
            disabled={activeRun.slideIds[0] === activeSlideId}
            className="p-1 rounded hover:bg-gray-100 disabled:opacity-30"
            onClick={() => splitSlideGroup(activeSlideId)}><Scissors size={16} /></button>
          <button title="Remove active slide from group (keep slide)"
            aria-label="Remove active slide from group"
            className="p-1 rounded hover:bg-gray-100 disabled:opacity-30"
            onClick={() => removeSlideFromGroup(activeSlideId)}><Minus size={16} /></button>
        </div>
      )}
      <div className="flex-1 overflow-y-auto pt-6" onClick={handleEmptySpaceClick}>
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={slideOrder.filter(id => !foldedIds.has(id))} strategy={verticalListSortingStrategy}>
            {slides.map((slide, index) => {
              const run = runBySlide.get(slide.id);
              const key = run && slideGroupRunKey(run);
              const folded = !!key && collapsedRuns.has(key);
              return <React.Fragment key={slide.id}>
                {run?.slideIds[0] === slide.id && (
                  <button type="button" data-slide-group={key}
                    aria-expanded={!folded}
                    title={folded ? 'Expand slide group' : 'Collapse slide group (active slide stays visible)'}
                    className="mx-2 mb-2 px-2 py-1 flex flex-wrap items-center gap-1 text-xs text-left rounded bg-gray-100 hover:bg-gray-200"
                    style={{ borderLeft: `3px solid ${groupColorFor(run.groupId)}` }}
                    onClick={() => toggleRun(key!)}>
                    {folded ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
                    Group · {run.slideIds.length} slides
                    {run.slideIds.includes(activeSlideId) && <span className="text-blue-600"> · active</span>}
                    {run.slideIds.some(id => selectedSlideIds.includes(id)) &&
                      <span> · {run.slideIds.filter(id => selectedSlideIds.includes(id)).length} selected</span>}
                  </button>
                )}
                {!foldedIds.has(slide.id) && <>
                {index === 0 && (
                  <SlideInsertRow
                    afterIndex={-1}
                    hasPrevious={false}
                    hasNext={true}
                    onInsert={handleInsert}
                    onInsertEmpty={handleInsertEmpty}
                    onOpenTemplatePicker={handleOpenTemplatePicker}
                  />
                )}

                <div data-slide-id={slide.id}
                  onContextMenu={(e) => handleContextMenu(e, slide.id)}
                  onPointerDown={(e) => handleSlidePointerDown(e, slide.id)}
                  onPointerMove={handleSlidePointerMove}
                  onPointerUp={handleSlidePointerUp}
                  onPointerCancel={handleSlidePointerUp}
                >
                  <SlideSortable
                    slide={slide}
                    index={index}
                    isActive={slide.id === activeSlideId}
                    isSelected={selectedSlideIds.includes(slide.id)}
                    canDelete={slides.length > 1}
                    groupInfo={groupInfoBySlide.get(slide.id)}
                    onClick={(e) => handleSlideClick(slide.id, e)}
                    onDelete={() => handleDeleteSlide(slide.id)}
                    onToggleHidden={() => toggleSlideHidden(slide.id)}
                  />
                </div>

                {!folded && <SlideInsertRow
                  afterIndex={index}
                  hasPrevious={true}
                  hasNext={index < slides.length - 1}
                  onInsert={handleInsert}
                  onInsertEmpty={handleInsertEmpty}
                  onOpenTemplatePicker={handleOpenTemplatePicker}
                />}
                </>}
              </React.Fragment>;
            })}
          </SortableContext>
        </DndContext>
      </div>

      <TemplatePicker
        open={pickerState !== null}
        onClose={handleCloseTemplatePicker}
        insertIndex={pickerState?.insertIndex ?? 0}
        anchorRect={pickerState?.anchorRect ?? null}
      />
    </div>
  );
};
