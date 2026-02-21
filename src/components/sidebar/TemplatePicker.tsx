import React, { useState, useRef, useEffect } from 'react';
import { X } from 'lucide-react';
import { usePresentationStore } from '../../store/presentationStore';
import { useEditorStore } from '../../store/editorStore';

interface TemplatePickerProps {
  open: boolean;
  onClose: () => void;
  anchorRef: React.RefObject<HTMLButtonElement | null>;
}

export const TemplatePicker: React.FC<TemplatePickerProps> = ({ open, onClose, anchorRef }) => {
  const templates = usePresentationStore((s) => s.presentation.templates);
  const slideOrder = usePresentationStore((s) => s.presentation.slideOrder);
  const activeSlideId = useEditorStore((s) => s.activeSlideId);
  const setActiveSlide = useEditorStore((s) => s.setActiveSlide);
  const saveAsTemplate = usePresentationStore((s) => s.saveAsTemplate);
  const addSlideFromTemplate = usePresentationStore((s) => s.addSlideFromTemplate);
  const deleteTemplate = usePresentationStore((s) => s.deleteTemplate);

  const [saveName, setSaveName] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (
        popoverRef.current && !popoverRef.current.contains(e.target as Node) &&
        anchorRef.current && !anchorRef.current.contains(e.target as Node)
      ) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open, onClose, anchorRef]);

  useEffect(() => {
    if (isSaving && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isSaving]);

  if (!open) return null;

  const templateList = Object.values(templates ?? {});

  const handleInsert = (templateId: string) => {
    const currentIdx = slideOrder.indexOf(activeSlideId);
    const newId = addSlideFromTemplate(templateId, currentIdx + 1);
    if (newId) setActiveSlide(newId);
    onClose();
  };

  const handleSave = () => {
    const trimmed = saveName.trim();
    if (!trimmed) return;
    saveAsTemplate(activeSlideId, trimmed);
    setSaveName('');
    setIsSaving(false);
  };

  const handleSaveKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleSave();
    if (e.key === 'Escape') { setIsSaving(false); setSaveName(''); }
  };

  return (
    <div
      ref={popoverRef}
      className="absolute top-full left-0 mt-1 w-56 bg-white rounded-lg shadow-lg border border-gray-200 z-50 overflow-hidden"
    >
      <div className="max-h-60 overflow-y-auto">
        {templateList.length === 0 && !isSaving && (
          <div className="px-3 py-4 text-xs text-gray-400 text-center">No templates yet</div>
        )}
        {templateList.map((t) => (
          <div
            key={t.id}
            className="flex items-center justify-between px-3 py-2 hover:bg-gray-50 cursor-pointer group"
            onClick={() => handleInsert(t.id)}
          >
            <span className="text-sm text-gray-700 truncate">{t.name}</span>
            <button
              onClick={(e) => { e.stopPropagation(); deleteTemplate(t.id); }}
              className="p-0.5 rounded hover:bg-gray-200 text-gray-400 hover:text-gray-600 opacity-0 group-hover:opacity-100 transition-opacity"
              title="Delete template"
            >
              <X size={14} />
            </button>
          </div>
        ))}
      </div>

      <div className="border-t border-gray-200 p-2">
        {isSaving ? (
          <div className="flex items-center gap-1">
            <input
              ref={inputRef}
              type="text"
              value={saveName}
              onChange={(e) => setSaveName(e.target.value)}
              onKeyDown={handleSaveKeyDown}
              placeholder="Template name"
              className="flex-1 text-sm border border-gray-300 rounded px-2 py-1 outline-none focus:border-blue-400"
            />
            <button
              onClick={handleSave}
              disabled={!saveName.trim()}
              className="text-xs px-2 py-1 bg-blue-500 text-white rounded hover:bg-blue-600 disabled:opacity-50"
            >
              Save
            </button>
          </div>
        ) : (
          <button
            onClick={() => setIsSaving(true)}
            className="w-full text-sm text-blue-600 hover:bg-blue-50 rounded px-2 py-1.5 text-left"
          >
            Save current as template
          </button>
        )}
      </div>
    </div>
  );
};
