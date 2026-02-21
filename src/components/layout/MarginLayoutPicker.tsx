import React, { useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useEditorStore } from '../../store/editorStore';
import { MARGIN_LAYOUTS } from '../../utils/marginLayouts';
import { SLIDE_WIDTH, SLIDE_HEIGHT } from '../../utils/constants';

const PREVIEW_WIDTH = 64;
const PREVIEW_HEIGHT = (PREVIEW_WIDTH / SLIDE_WIDTH) * SLIDE_HEIGHT;

interface Props {
  open: boolean;
  onClose: () => void;
  anchorRect: DOMRect | null;
}

const LayoutPreview: React.FC<{
  layout: typeof MARGIN_LAYOUTS[0];
  isSelected: boolean;
  onClick: () => void;
}> = ({ layout, isSelected, onClick }) => {
  const scaleX = PREVIEW_WIDTH / SLIDE_WIDTH;
  const scaleY = PREVIEW_HEIGHT / SLIDE_HEIGHT;

  const left = layout.left * scaleX;
  const right = layout.right * scaleX;
  const top = layout.top * scaleY;
  const bottom = layout.bottom * scaleY;

  const isNone = layout.id === 'none';

  return (
    <button
      onClick={onClick}
      className={`flex flex-col items-center gap-1 p-1.5 rounded transition-colors ${
        isSelected ? 'bg-blue-100 ring-2 ring-blue-500' : 'hover:bg-gray-100'
      }`}
      title={layout.name}
    >
      <div
        className="relative bg-white border border-gray-300 rounded-sm overflow-hidden"
        style={{ width: PREVIEW_WIDTH, height: PREVIEW_HEIGHT }}
      >
        {!isNone && (
          <>
            {/* Left margin */}
            <div
              className="absolute bg-blue-200/50"
              style={{ left: 0, top: 0, width: left, height: PREVIEW_HEIGHT }}
            />
            {/* Right margin */}
            <div
              className="absolute bg-blue-200/50"
              style={{ right: 0, top: 0, width: right, height: PREVIEW_HEIGHT }}
            />
            {/* Top margin */}
            <div
              className="absolute bg-blue-200/50"
              style={{ left: left, top: 0, width: PREVIEW_WIDTH - left - right, height: top }}
            />
            {/* Bottom margin */}
            <div
              className="absolute bg-blue-200/50"
              style={{ left: left, bottom: 0, width: PREVIEW_WIDTH - left - right, height: bottom }}
            />
            {/* Content area border */}
            <div
              className="absolute border border-dashed border-blue-400"
              style={{
                left: left,
                top: top,
                width: PREVIEW_WIDTH - left - right,
                height: PREVIEW_HEIGHT - top - bottom,
              }}
            />
          </>
        )}
      </div>
      <span className="text-[10px] text-gray-600 truncate w-full text-center">{layout.name}</span>
    </button>
  );
};

export const MarginLayoutPicker: React.FC<Props> = ({ open, onClose, anchorRect }) => {
  const marginLayoutId = useEditorStore((s) => s.marginLayoutId);
  const setMarginLayoutId = useEditorStore((s) => s.setMarginLayoutId);
  const popoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handleMouseDown = (e: MouseEvent) => {
      if (popoverRef.current?.contains(e.target as Node)) return;
      if ((e.target as HTMLElement).closest('[data-margin-trigger]')) return;
      onClose();
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', handleMouseDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleMouseDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open, onClose]);

  if (!open || !anchorRect) return null;

  // Position above anchor
  const popoverWidth = 280;
  const popoverHeight = 200;
  let left = anchorRect.left;
  let top = anchorRect.top - popoverHeight - 8;

  // Clamp to viewport
  if (left + popoverWidth > window.innerWidth - 8) {
    left = window.innerWidth - popoverWidth - 8;
  }
  if (top < 8) {
    top = anchorRect.bottom + 8;
  }

  const handleSelect = (id: string) => {
    setMarginLayoutId(id === 'none' ? null : id);
    onClose();
  };

  const popover = (
    <div
      ref={popoverRef}
      className="fixed bg-white rounded-lg shadow-xl border border-gray-200 z-[200] overflow-hidden"
      style={{ top, left, width: popoverWidth }}
    >
      <div className="p-2 border-b border-gray-100">
        <span className="text-xs font-medium text-gray-500 uppercase">Margin Guides</span>
      </div>
      <div className="p-2 grid grid-cols-4 gap-1 max-h-48 overflow-y-auto">
        {MARGIN_LAYOUTS.map((layout) => (
          <LayoutPreview
            key={layout.id}
            layout={layout}
            isSelected={
              (layout.id === 'none' && !marginLayoutId) ||
              layout.id === marginLayoutId
            }
            onClick={() => handleSelect(layout.id)}
          />
        ))}
      </div>
    </div>
  );

  return createPortal(popover, document.body);
};
