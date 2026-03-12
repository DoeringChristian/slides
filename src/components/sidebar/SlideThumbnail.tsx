import React from 'react';
import { X, EyeOff, Eye } from 'lucide-react';
import { SVGStaticSlide } from '../svg/SVGStaticSlide';
import type { Slide } from '../../types/presentation';
import { SLIDE_WIDTH, SLIDE_HEIGHT } from '../../utils/constants';

const THUMB_WIDTH = 192;
const THUMB_SCALE = THUMB_WIDTH / SLIDE_WIDTH;
const THUMB_HEIGHT = SLIDE_HEIGHT * THUMB_SCALE;

interface Props {
  slide: Slide;
  index: number;
  isActive: boolean;
  isSelected?: boolean;
  canDelete: boolean;
  onClick: (e: React.MouseEvent) => void;
  onDelete: () => void;
  onToggleHidden: () => void;
}

export const SlideThumbnail: React.FC<Props> = React.memo(({ slide, index, isActive, isSelected = false, canDelete, onClick, onDelete, onToggleHidden }) => {
  const hidden = slide.hidden;

  // Background: active = orange-50, selected (not active) = blue-50/50, else hover:gray-50
  const bgClass = isActive ? 'bg-orange-50' : isSelected ? 'bg-blue-50/50' : 'hover:bg-gray-50';
  // Border: active = orange-500, selected = blue-400, else gray-200
  const borderClass = isActive ? 'border-orange-500' : isSelected ? 'border-blue-400' : 'border-gray-200 group-hover:border-gray-300';

  return (
    <div
      onClick={onClick}
      className={`flex items-center gap-2 px-2 py-1.5 cursor-pointer group ${bgClass}`}
    >
      <span className="text-xs text-gray-400 w-5 text-right shrink-0">{index + 1}</span>
      <div className="relative">
        <div className={`relative rounded border-2 overflow-hidden ${hidden ? 'opacity-40' : ''} ${borderClass}`}>
          <SVGStaticSlide
            slide={slide}
            width={THUMB_WIDTH}
            height={THUMB_HEIGHT}
            showHighlights={true}
          />
        </div>
        <button
          onClick={(e) => { e.stopPropagation(); onToggleHidden(); }}
          className={`absolute -bottom-1.5 -right-1.5 p-0.5 rounded-full bg-white border border-gray-200 shadow-sm text-gray-400 hover:text-gray-600 transition-opacity ${hidden ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}
          title={hidden ? 'Show slide' : 'Hide slide'}
        >
          {hidden ? <Eye size={12} /> : <EyeOff size={12} />}
        </button>
        {canDelete && (
          <button
            onClick={(e) => { e.stopPropagation(); onDelete(); }}
            className="absolute -top-1.5 -right-1.5 p-0.5 rounded-full bg-white border border-gray-200 shadow-sm text-gray-400 hover:text-gray-600 opacity-0 group-hover:opacity-100 transition-opacity"
            title="Delete slide"
          >
            <X size={12} />
          </button>
        )}
      </div>
    </div>
  );
});
