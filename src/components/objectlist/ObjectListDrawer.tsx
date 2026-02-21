import React, { useMemo, useCallback } from 'react';
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
  const setHoveredObjectId = useEditorStore((s) => s.setHoveredObjectId);
  const renameObject = usePresentationStore((s) => s.renameObject);
  const hideElement = usePresentationStore((s) => s.hideElement);
  const unhideElement = usePresentationStore((s) => s.unhideElement);

  const objects = useAllObjects();
  const slide = useActiveSlide();
  const objectElements = useObjectElements();

  const sortedObjects = useMemo(() => {
    if (!slide) return objects;
    return [...objects].sort((a, b) => {
      const aVisible = !!(slide.elements[a.id]?.visible);
      const bVisible = !!(slide.elements[b.id]?.visible);
      if (aVisible === bVisible) return 0;
      return aVisible ? -1 : 1;
    });
  }, [objects, slide]);

  const handleToggleVisibility = useCallback(
    (objectId: string, isCurrentlyVisible: boolean) => {
      if (isCurrentlyVisible) {
        hideElement(activeSlideId, objectId);
      } else {
        unhideElement(activeSlideId, objectId);
      }
    },
    [activeSlideId, hideElement, unhideElement],
  );

  return (
    <div className="border-t border-gray-200 bg-white shrink-0">
      {/* Header bar */}
      <button
        onClick={() => setObjectDrawerOpen(!objectDrawerOpen)}
        className="w-full flex items-center gap-2 px-3 h-7 text-xs font-medium text-gray-500 uppercase hover:bg-gray-50"
      >
        <Layers size={12} />
        <span>Objects ({objects.length})</span>
        <span className="ml-auto">
          {objectDrawerOpen ? <ChevronDown size={12} /> : <ChevronUp size={12} />}
        </span>
      </button>

      {/* Collapsible content */}
      {objectDrawerOpen && (
        <div className="max-h-[220px] overflow-y-auto border-t border-gray-100">
          {objects.length === 0 ? (
            <div className="px-3 py-2 text-xs text-gray-400">No objects yet</div>
          ) : (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(90px,1fr))] gap-2 p-2">
              {sortedObjects.map((obj) => {
                const isVisibleOnSlide = !!(slide?.elements[obj.id]?.visible);
                const isSelected = selectedElementIds.includes(obj.id);
                return (
                  <ObjectListItem
                    key={obj.id}
                    object={obj}
                    element={objectElements[obj.id]}
                    isVisibleOnSlide={isVisibleOnSlide}
                    isSelected={isSelected}
                    onSelect={() => {
                      if (isVisibleOnSlide) {
                        setSelectedElements([obj.id]);
                      }
                    }}
                    onRename={(name) => renameObject(obj.id, name)}
                    onToggleVisibility={() => handleToggleVisibility(obj.id, isVisibleOnSlide)}
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
