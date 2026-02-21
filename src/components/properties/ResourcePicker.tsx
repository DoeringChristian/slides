import React, { useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { ImageOff, Upload } from 'lucide-react';
import { usePresentationStore } from '../../store/presentationStore';
import { loadImageFile } from '../../utils/slideFactory';
import type { Resource } from '../../types/presentation';

const POPOVER_WIDTH = 320;

interface ResourcePickerProps {
  open: boolean;
  onClose: () => void;
  currentResourceId: string | null | undefined;
  onSelect: (resourceId: string | null) => void;
  anchorRect: DOMRect | null;
}

const ResourceThumbnail: React.FC<{ resource: Resource; isSelected: boolean; onClick: () => void }> = ({
  resource,
  isSelected,
  onClick,
}) => (
  <div
    onClick={onClick}
    className={`relative w-16 h-16 rounded border-2 overflow-hidden cursor-pointer transition-colors ${
      isSelected ? 'border-blue-500' : 'border-gray-200 hover:border-gray-300'
    }`}
  >
    <img src={resource.src} className="w-full h-full object-cover" draggable={false} />
  </div>
);

export const ResourcePicker: React.FC<ResourcePickerProps> = ({
  open,
  onClose,
  currentResourceId,
  onSelect,
  anchorRect,
}) => {
  const resources = usePresentationStore((s) => s.presentation.resources);
  const addResource = usePresentationStore((s) => s.addResource);
  const popoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handleMouseDown = (e: MouseEvent) => {
      if (popoverRef.current?.contains(e.target as Node)) return;
      if ((e.target as HTMLElement).closest('[data-resource-trigger]')) return;
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

  const resourceList = Object.values(resources ?? {});

  // Position below anchor, clamp to viewport
  let top = anchorRect.bottom + 4;
  let left = anchorRect.left;
  if (left + POPOVER_WIDTH > window.innerWidth - 8) {
    left = window.innerWidth - POPOVER_WIDTH - 8;
  }
  if (top + 280 > window.innerHeight) {
    top = anchorRect.top - 280 - 4;
  }

  const handleUpload = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*,.svg';
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      const { resource } = await loadImageFile(file);
      addResource(resource);
      onSelect(resource.id);
      onClose();
    };
    input.click();
  };

  const popover = (
    <div
      ref={popoverRef}
      className="fixed bg-white rounded-lg shadow-xl border border-gray-200 z-[200] overflow-hidden"
      style={{ top, left, width: POPOVER_WIDTH }}
    >
      <div className="max-h-56 overflow-y-auto p-2">
        {/* None option */}
        <div
          onClick={() => {
            onSelect(null);
            onClose();
          }}
          className={`flex items-center gap-2 px-2 py-1.5 rounded cursor-pointer mb-1 ${
            !currentResourceId ? 'bg-blue-50 text-blue-700' : 'hover:bg-gray-100'
          }`}
        >
          <ImageOff size={16} />
          <span className="text-sm">None (empty)</span>
        </div>

        {/* Resource grid */}
        {resourceList.length > 0 && (
          <div className="flex flex-wrap gap-2 pt-1 border-t border-gray-100">
            {resourceList.map((resource) => (
              <ResourceThumbnail
                key={resource.id}
                resource={resource}
                isSelected={currentResourceId === resource.id}
                onClick={() => {
                  onSelect(resource.id);
                  onClose();
                }}
              />
            ))}
          </div>
        )}

        {resourceList.length === 0 && (
          <div className="py-4 text-sm text-gray-400 text-center">No images yet</div>
        )}
      </div>

      <div className="border-t border-gray-200 p-2">
        <button
          onClick={handleUpload}
          className="w-full flex items-center justify-center gap-2 text-sm text-blue-600 hover:bg-blue-50 rounded px-2 py-1.5"
        >
          <Upload size={16} />
          Upload new image
        </button>
      </div>
    </div>
  );

  return createPortal(popover, document.body);
};
