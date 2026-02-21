import React from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { SlideThumbnail } from './SlideThumbnail';
import type { Slide } from '../../types/presentation';

interface Props {
  slide: Slide;
  index: number;
  isActive: boolean;
  canDelete: boolean;
  selectedElementIds: string[];
  onClick: () => void;
  onDelete: () => void;
}

export const SlideSortable: React.FC<Props> = ({ slide, index, isActive, canDelete, selectedElementIds, onClick, onDelete }) => {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: slide.id });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    position: 'relative' as const,
    zIndex: isDragging ? 10 : 'auto',
  };

  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
      <SlideThumbnail slide={slide} index={index} isActive={isActive} canDelete={canDelete} selectedElementIds={selectedElementIds} onClick={onClick} onDelete={onDelete} />
    </div>
  );
};
