import React, { useState, useRef, useCallback } from 'react';
import { Type, Square, Image, Eye, EyeOff } from 'lucide-react';
import type { ObjectMeta } from '../../types/presentation';

interface Props {
  object: ObjectMeta;
  isVisibleOnSlide: boolean;
  isSelected: boolean;
  onSelect: () => void;
  onRename: (name: string) => void;
}

const TYPE_ICONS: Record<string, React.FC<{ size: number; className?: string }>> = {
  text: Type,
  shape: Square,
  image: Image,
};

export const ObjectListItem: React.FC<Props> = ({ object, isVisibleOnSlide, isSelected, onSelect, onRename }) => {
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState(object.name);
  const inputRef = useRef<HTMLInputElement>(null);

  const Icon = TYPE_ICONS[object.type] || Square;

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

  return (
    <div
      className={`flex items-center gap-2 px-2 py-1 text-sm cursor-pointer select-none border-b border-gray-100 ${
        isSelected ? 'bg-blue-50' : 'hover:bg-gray-50'
      }`}
      onClick={onSelect}
      draggable
      onDragStart={handleDragStart}
    >
      <Icon size={14} className="text-gray-400 shrink-0" />
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
          className="flex-1 text-sm border border-blue-400 rounded px-1 py-0 outline-none min-w-0"
          autoFocus
        />
      ) : (
        <span className="flex-1 truncate" onDoubleClick={handleDoubleClick}>
          {object.name}
        </span>
      )}
      {isVisibleOnSlide ? (
        <Eye size={14} className="text-gray-400 shrink-0" />
      ) : (
        <EyeOff size={14} className="text-gray-300 shrink-0" />
      )}
    </div>
  );
};
