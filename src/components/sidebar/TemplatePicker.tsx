import React, { useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Stage, Layer, Rect } from 'react-konva';
import { X } from 'lucide-react';
import { usePresentationStore } from '../../store/presentationStore';
import { useEditorStore } from '../../store/editorStore';
import { ThumbnailElement } from './SlideThumbnail';
import { SLIDE_WIDTH, SLIDE_HEIGHT } from '../../utils/constants';
import type { SlideTemplate } from '../../types/presentation';

const PREVIEW_WIDTH = 144;
const PREVIEW_SCALE = PREVIEW_WIDTH / SLIDE_WIDTH;
const PREVIEW_HEIGHT = SLIDE_HEIGHT * PREVIEW_SCALE;

const POPOVER_WIDTH = 360;

interface TemplatePickerProps {
  open: boolean;
  onClose: () => void;
  insertIndex: number;
  anchorRect: DOMRect | null;
}

const TemplatePreview: React.FC<{ template: SlideTemplate }> = ({ template }) => {
  const bgColor = template.background.type === 'solid' ? template.background.color : '#ffffff';
  const elements = template.elementOrder.map((id) => template.elements[id]).filter(Boolean);

  return (
    <div className="rounded border border-gray-200 overflow-hidden shrink-0">
      <Stage width={PREVIEW_WIDTH} height={PREVIEW_HEIGHT} scaleX={PREVIEW_SCALE} scaleY={PREVIEW_SCALE} listening={false}>
        <Layer listening={false}>
          <Rect x={0} y={0} width={SLIDE_WIDTH} height={SLIDE_HEIGHT} fill={bgColor} listening={false} />
          {elements.map((el) => (
            <ThumbnailElement key={el.id} element={el} />
          ))}
        </Layer>
      </Stage>
    </div>
  );
};

export const TemplatePicker: React.FC<TemplatePickerProps> = ({ open, onClose, insertIndex, anchorRect }) => {
  const templates = usePresentationStore((s) => s.presentation.templates);
  const activeSlideId = useEditorStore((s) => s.activeSlideId);
  const setActiveSlide = useEditorStore((s) => s.setActiveSlide);
  const saveAsTemplate = usePresentationStore((s) => s.saveAsTemplate);
  const addSlideFromTemplate = usePresentationStore((s) => s.addSlideFromTemplate);
  const deleteTemplate = usePresentationStore((s) => s.deleteTemplate);

  const popoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handleMouseDown = (e: MouseEvent) => {
      if (popoverRef.current?.contains(e.target as Node)) return;
      if ((e.target as HTMLElement).closest('[data-template-trigger]')) return;
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

  const templateList = Object.values(templates ?? {});

  // Position below anchor, clamp to viewport
  let top = anchorRect.bottom + 4;
  let left = anchorRect.left;
  if (left + POPOVER_WIDTH > window.innerWidth - 8) {
    left = window.innerWidth - POPOVER_WIDTH - 8;
  }
  if (top + 300 > window.innerHeight) {
    top = anchorRect.top - 300 - 4;
  }

  const handleInsert = (templateId: string) => {
    const newId = addSlideFromTemplate(templateId, insertIndex);
    if (newId) setActiveSlide(newId);
    onClose();
  };

  const handleSave = () => {
    saveAsTemplate(activeSlideId, '');
  };

  const popover = (
    <div
      ref={popoverRef}
      className="fixed bg-white rounded-lg shadow-xl border border-gray-200 z-[200] overflow-hidden"
      style={{ top, left, width: POPOVER_WIDTH }}
    >
      <div className="max-h-80 overflow-y-auto p-2 flex flex-wrap gap-2">
        {templateList.length === 0 && (
          <div className="w-full py-6 text-sm text-gray-400 text-center">No templates yet</div>
        )}
        {templateList.map((t) => (
          <div
            key={t.id}
            className="relative cursor-pointer group"
            onClick={() => handleInsert(t.id)}
          >
            <TemplatePreview template={t} />
            {t.name && (
              <div className="absolute bottom-0 inset-x-0 bg-black/50 text-white text-[10px] px-1 py-0.5 truncate rounded-b">
                {t.name}
              </div>
            )}
            <button
              onClick={(e) => { e.stopPropagation(); deleteTemplate(t.id); }}
              className="absolute -top-1.5 -right-1.5 p-0.5 rounded-full bg-white border border-gray-200 shadow-sm text-gray-400 hover:text-gray-600 opacity-0 group-hover:opacity-100 transition-opacity"
              title="Delete template"
            >
              <X size={12} />
            </button>
          </div>
        ))}
      </div>

      <div className="border-t border-gray-200 p-2">
        <button
          onClick={handleSave}
          className="w-full text-sm text-blue-600 hover:bg-blue-50 rounded px-2 py-1.5 text-left"
        >
          Save current slide as template
        </button>
      </div>
    </div>
  );

  return createPortal(popover, document.body);
};
