import React, { useMemo, useCallback, useState, useRef, useEffect } from 'react';
import { ChevronDown, ChevronUp, Layers } from 'lucide-react';
import { useEditorStore } from '../../store/editorStore';
import { usePresentationStore } from '../../store/presentationStore';
import { useAllObjects, useActiveSlide, useObjectElements } from '../../store/selectors';
import { ObjectListItem } from './ObjectListItem';

export const ObjectListDrawer: React.FC = () => {
  const objectDrawerOpen = useEditorStore((s) => s.objectDrawerOpen);
  const setObjectDrawerOpen = useEditorStore((s) => s.setObjectDrawerOpen);
  const selectedElementIds = useEditorStore((s) => s.selectedElementIds);
  const setSelectedElements = useEditorStore((s) => s.setSelectedElements);
  const activeSlideId = useEditorStore((s) => s.activeSlideId);
  const hoveredObjectId = useEditorStore((s) => s.hoveredObjectId);
  const setHoveredObjectId = useEditorStore((s) => s.setHoveredObjectId);
  const renameObject = usePresentationStore((s) => s.renameObject);
  const hideElement = usePresentationStore((s) => s.hideElement);
  const unhideElement = usePresentationStore((s) => s.unhideElement);
  const removeObject = usePresentationStore((s) => s.removeObject);
  const mergeObjects = usePresentationStore((s) => s.mergeObjects);

  const objects = useAllObjects();
  const slide = useActiveSlide();
  const objectElements = useObjectElements();

  // Bound-text labels don't get their own rows — their container's row shows
  // a small label badge instead (the label's lifecycle is chained to the
  // container everywhere else, so a standalone row would only confuse).
  const { boundLabelIds, labelledContainerIds } = useMemo(() => {
    const labels = new Set<string>();
    const containers = new Set<string>();
    for (const [id, el] of Object.entries(objectElements)) {
      if (el?.type === 'text' && el.containerId) {
        labels.add(id);
        containers.add(el.containerId);
      }
    }
    return { boundLabelIds: labels, labelledContainerIds: containers };
  }, [objectElements]);

  const listedObjects = useMemo(
    () => objects.filter((obj) => !boundLabelIds.has(obj.id)),
    [objects, boundLabelIds],
  );

  const sortedObjects = useMemo(() => {
    if (!slide) return listedObjects;
    return [...listedObjects].sort((a, b) => {
      const aVisible = !!(slide.elements[a.id]?.visible);
      const bVisible = !!(slide.elements[b.id]?.visible);
      if (aVisible === bVisible) return 0;
      return aVisible ? -1 : 1;
    });
  }, [listedObjects, slide]);

  const handleToggleVisibility = useCallback(
    (objectId: string, isCurrentlyVisible: boolean) => {
      if (isCurrentlyVisible) {
        hideElement(activeSlideId, objectId);
        // Deselect the element when hiding it
        if (selectedElementIds.includes(objectId)) {
          setSelectedElements(selectedElementIds.filter((id) => id !== objectId));
        }
      } else {
        unhideElement(activeSlideId, objectId);
      }
    },
    [activeSlideId, hideElement, unhideElement, selectedElementIds, setSelectedElements],
  );

  // Transient notice for target-wins conflict resolution during a merge.
  const [mergeNotice, setMergeNotice] = useState<string | null>(null);
  const noticeTimer = useRef<number | null>(null);
  useEffect(() => () => {
    if (noticeTimer.current !== null) window.clearTimeout(noticeTimer.current);
  }, []);

  // Merge SOURCE (the row the picker was opened from) INTO the picked TARGET.
  const handleMergeInto = useCallback(
    (sourceId: string, targetId: string) => {
      const target = objects.find((o) => o.id === targetId);
      const result = mergeObjects(targetId, sourceId);
      if (!result.merged) return;
      // The two objects are one identity now — select the survivor.
      setSelectedElements([targetId]);
      if (result.droppedOnSlides.length > 0) {
        const n = result.droppedOnSlides.length;
        setMergeNotice(
          `Kept “${target?.name ?? 'target'}” on ${n} conflicting slide${n === 1 ? '' : 's'}`,
        );
        if (noticeTimer.current !== null) window.clearTimeout(noticeTimer.current);
        noticeTimer.current = window.setTimeout(() => setMergeNotice(null), 5000);
      }
    },
    [mergeObjects, objects, setSelectedElements],
  );

  const handleDelete = useCallback(
    (objectId: string) => {
      // Deselect the element before removing
      if (selectedElementIds.includes(objectId)) {
        setSelectedElements(selectedElementIds.filter((id) => id !== objectId));
      }
      removeObject(objectId);
    },
    [removeObject, selectedElementIds, setSelectedElements],
  );

  return (
    <div className="border-t border-gray-200 bg-white shrink-0">
      {/* Header bar */}
      <button
        onClick={() => setObjectDrawerOpen(!objectDrawerOpen)}
        className="w-full flex items-center gap-2 px-3 h-7 text-xs font-medium text-gray-500 uppercase hover:bg-gray-50"
      >
        <Layers size={12} />
        <span>Objects ({listedObjects.length})</span>
        <span className="ml-auto">
          {objectDrawerOpen ? <ChevronDown size={12} /> : <ChevronUp size={12} />}
        </span>
      </button>

      {/* Transient merge-conflict notice */}
      {mergeNotice && (
        <div className="px-3 py-1 text-xs text-amber-700 bg-amber-50 border-t border-amber-200">
          {mergeNotice}
        </div>
      )}

      {/* Collapsible content */}
      {objectDrawerOpen && (
        <div className="max-h-[220px] overflow-y-auto border-t border-gray-100">
          {listedObjects.length === 0 ? (
            <div className="px-3 py-2 text-xs text-gray-400">No objects yet</div>
          ) : (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(90px,1fr))] gap-2 p-2">
              {sortedObjects.map((obj) => {
                const isVisibleOnSlide = !!(slide?.elements[obj.id]?.visible);
                const isSelected = selectedElementIds.includes(obj.id);
                const isHovered = hoveredObjectId === obj.id;
                return (
                  <ObjectListItem
                    key={obj.id}
                    object={obj}
                    element={objectElements[obj.id]}
                    hasBoundLabel={labelledContainerIds.has(obj.id)}
                    isVisibleOnSlide={isVisibleOnSlide}
                    isSelected={isSelected}
                    isHovered={isHovered}
                    mergeCandidates={listedObjects.filter((o) => o.id !== obj.id)}
                    onMergeInto={(targetId) => handleMergeInto(obj.id, targetId)}
                    onSelect={() => {
                      if (isVisibleOnSlide) {
                        setSelectedElements([obj.id]);
                      }
                    }}
                    onRename={(name) => renameObject(obj.id, name)}
                    onToggleVisibility={() => handleToggleVisibility(obj.id, isVisibleOnSlide)}
                    onDelete={() => handleDelete(obj.id)}
                    onHover={() => setHoveredObjectId(obj.id)}
                    onHoverEnd={() => setHoveredObjectId(null)}
                  />
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
