import React from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { SlideThumbnail } from './SlideThumbnail';
import type { Slide } from '../../types/presentation';

interface Props {
  slide: Slide;
  index: number;
  isActive: boolean;
  isSelected: boolean;
  canDelete: boolean;
  onClick: (e: React.MouseEvent) => void;
  onDelete: () => void;
  onToggleHidden: () => void;
}

export const SlideSortable: React.FC<Props> = React.memo(({ slide, index, isActive, isSelected, canDelete, onClick, onDelete, onToggleHidden }) => {
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
      <SlideThumbnail slide={slide} index={index} isActive={isActive} isSelected={isSelected} canDelete={canDelete} onClick={onClick} onDelete={onDelete} onToggleHidden={onToggleHidden} />
    </div>
  );
});
