import React from 'react';
import { ChevronDown, ChevronUp, Layers } from 'lucide-react';
import { useEditorStore } from '../../store/editorStore';
import { usePresentationStore } from '../../store/presentationStore';
import { useAllObjects, useActiveSlide } from '../../store/selectors';
import { ObjectListItem } from './ObjectListItem';

export const ObjectListDrawer: React.FC = () => {
  const objectDrawerOpen = useEditorStore((s) => s.objectDrawerOpen);
  const setObjectDrawerOpen = useEditorStore((s) => s.setObjectDrawerOpen);
  const selectedElementIds = useEditorStore((s) => s.selectedElementIds);
  const setSelectedElements = useEditorStore((s) => s.setSelectedElements);
  const renameObject = usePresentationStore((s) => s.renameObject);

  const objects = useAllObjects();
  const slide = useActiveSlide();

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
        <div className="max-h-[150px] overflow-y-auto border-t border-gray-100">
          {objects.length === 0 ? (
            <div className="px-3 py-2 text-xs text-gray-400">No objects yet</div>
          ) : (
            objects.map((obj) => {
              const isVisibleOnSlide = !!(slide?.elements[obj.id]?.visible);
              const isSelected = selectedElementIds.includes(obj.id);
              return (
                <ObjectListItem
                  key={obj.id}
                  object={obj}
                  isVisibleOnSlide={isVisibleOnSlide}
                  isSelected={isSelected}
                  onSelect={() => {
                    if (isVisibleOnSlide) {
                      setSelectedElements([obj.id]);
                    }
                  }}
                  onRename={(name) => renameObject(obj.id, name)}
                />
              );
            })
          )}
        </div>
      )}
    </div>
  );
};
