import React, { useState, useRef, useCallback } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import type { ObjectMeta, SlideElement } from '../../types/presentation';
import { ObjectPreview } from './ObjectPreview';

interface Props {
  object: ObjectMeta;
  element: SlideElement | undefined;
  isVisibleOnSlide: boolean;
  isSelected: boolean;
  onSelect: () => void;
  onRename: (name: string) => void;
  onToggleVisibility: () => void;
  onHover: () => void;
  onHoverEnd: () => void;
}

export const ObjectListItem: React.FC<Props> = ({
  object,
  element,
  isVisibleOnSlide,
  isSelected,
  onSelect,
  onRename,
  onToggleVisibility,
  onHover,
  onHoverEnd,
}) => {
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState(object.name);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleDoubleClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setEditName(object.name);
    setIsEditing(true);
    setTimeout(() => inputRef.current?.select(), 0);
  }, [object.name]);

  const handleRenameSubmit = useCallback(() => {
    const trimmed = editName.trim();
    if (trimmed && trimmed !== object.name) {
      onRename(trimmed);
    }
    setIsEditing(false);
  }, [editName, object.name, onRename]);

  const handleDragStart = useCallback((e: React.DragEvent) => {
    e.dataTransfer.setData('application/x-object-id', object.id);
    e.dataTransfer.effectAllowed = 'move';
  }, [object.id]);

  const handleVisibilityClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    onToggleVisibility();
  }, [onToggleVisibility]);

  return (
    <div
      className={`group flex flex-col rounded-md border cursor-pointer select-none overflow-hidden ${
        isSelected
          ? 'border-blue-500 bg-blue-50'
          : 'border-gray-200 hover:border-gray-300 bg-white'
      } ${!isVisibleOnSlide ? 'opacity-50' : ''}`}
      onClick={onSelect}
      onMouseEnter={onHover}
      onMouseLeave={onHoverEnd}
      draggable
      onDragStart={handleDragStart}
    >
      {/* Preview area */}
      <div className="relative aspect-square overflow-hidden">
        <ObjectPreview element={element} objectType={object.type} />
        {/* Visibility toggle overlay */}
        <button
          onClick={handleVisibilityClick}
          className={`absolute top-1 right-1 p-0.5 rounded bg-white/80 hover:bg-white shadow-sm ${
            isVisibleOnSlide ? 'opacity-0 group-hover:opacity-100' : 'opacity-100'
          } transition-opacity`}
        >
          {isVisibleOnSlide ? (
            <Eye size={12} className="text-gray-500" />
          ) : (
            <EyeOff size={12} className="text-gray-400" />
          )}
        </button>
      </div>

      {/* Name label */}
      <div className="px-1 py-0.5 border-t border-gray-100">
        {isEditing ? (
          <input
            ref={inputRef}
            value={editName}
            onChange={(e) => setEditName(e.target.value)}
            onBlur={handleRenameSubmit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleRenameSubmit();
              if (e.key === 'Escape') setIsEditing(false);
            }}
            className="w-full text-[10px] border border-blue-400 rounded px-0.5 py-0 outline-none"
            autoFocus
          />
        ) : (
          <span
            className="block text-[10px] text-gray-600 truncate text-center"
            onDoubleClick={handleDoubleClick}
          >
            {object.name}
          </span>
        )}
      </div>
    </div>
  );
};
