import React from 'react';
import {
  MousePointer2, Type, Square, Circle, Triangle, Star, Minus, MoveRight, Image, Trash2,
} from 'lucide-react';
import { useEditorStore } from '../../store/editorStore';
import { usePresentationStore } from '../../store/presentationStore';
import { loadImageFile, loadPdfFile } from '../../utils/slideFactory';
import type { Tool } from '../../types/presentation';

// Mobile-only horizontal tool palette. Wraps the same `editorStore.tool` state
// and the same image-loading helper that the desktop Toolbar uses, so behaviour
// stays in sync. Lives at the bottom of AppLayoutMobile.

const TOOLS: { tool: Tool; icon: React.ReactNode; label: string }[] = [
  { tool: 'select', icon: <MousePointer2 size={20} />, label: 'Select' },
  { tool: 'text', icon: <Type size={20} />, label: 'Text' },
  { tool: 'rect', icon: <Square size={20} />, label: 'Rect' },
  { tool: 'ellipse', icon: <Circle size={20} />, label: 'Ellipse' },
  { tool: 'triangle', icon: <Triangle size={20} />, label: 'Triangle' },
  { tool: 'star', icon: <Star size={20} />, label: 'Star' },
  { tool: 'line', icon: <Minus size={20} />, label: 'Line' },
  { tool: 'arrow', icon: <MoveRight size={20} />, label: 'Arrow' },
];

export const MobileToolPalette: React.FC = () => {
  const currentTool = useEditorStore((s) => s.tool);
  const setTool = useEditorStore((s) => s.setTool);
  const selectedIds = useEditorStore((s) => s.selectedElementIds);
  const activeSlideId = useEditorStore((s) => s.activeSlideId);
  const deleteElements = usePresentationStore((s) => s.deleteElements);
  const setSelectedElements = useEditorStore((s) => s.setSelectedElements);
  const addElement = usePresentationStore((s) => s.addElement);
  const addEmptySlide = usePresentationStore((s) => s.addEmptySlide);
  const setActiveSlide = useEditorStore((s) => s.setActiveSlide);
  const addResource = usePresentationStore((s) => s.addResource);

  const handleImageTool = async () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*,.svg,.pdf';
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      const existingResources = usePresentationStore.getState().presentation.resources;
      if (file.type === 'application/pdf' || file.name.endsWith('.pdf')) {
        const { resources, elements, isExisting } = await loadPdfFile(file, existingResources);
        if (!isExisting) resources.forEach((r) => addResource(r));
        if (elements.length === 1) {
          addElement(activeSlideId, elements[0]);
          setSelectedElements([elements[0].id]);
        } else {
          const { slideOrder } = usePresentationStore.getState().presentation;
          let insertIdx = slideOrder.indexOf(activeSlideId) + 1;
          let lastSlideId = '';
          for (const pageEl of elements) {
            const newSlideId = addEmptySlide(insertIdx);
            addElement(newSlideId, pageEl);
            lastSlideId = newSlideId;
            insertIdx++;
          }
          if (lastSlideId) setActiveSlide(lastSlideId);
        }
      } else {
        const { resource, element, isExisting } = await loadImageFile(file, undefined, existingResources);
        if (!isExisting) addResource(resource);
        addElement(activeSlideId, element);
        setSelectedElements([element.id]);
      }
      setTool('select');
    };
    input.click();
  };

  const handleDelete = () => {
    if (activeSlideId && selectedIds.length > 0) {
      deleteElements(activeSlideId, selectedIds);
      setSelectedElements([]);
    }
  };

  return (
    <div className="h-14 bg-white border-t border-gray-200 flex items-center gap-1 px-2 overflow-x-auto shrink-0">
      {TOOLS.map(({ tool, icon, label }) => (
        <button
          key={tool}
          onClick={() => setTool(tool)}
          className={`shrink-0 w-11 h-11 flex items-center justify-center rounded-md ${
            currentTool === tool ? 'bg-blue-100 text-blue-600' : 'text-gray-600 hover:bg-gray-100'
          }`}
          title={label}
          aria-label={label}
        >
          {icon}
        </button>
      ))}
      <button
        onClick={handleImageTool}
        className="shrink-0 w-11 h-11 flex items-center justify-center rounded-md text-gray-600 hover:bg-gray-100"
        title="Image"
        aria-label="Image"
      >
        <Image size={20} />
      </button>
      <div className="ml-auto" />
      <button
        onClick={handleDelete}
        disabled={selectedIds.length === 0}
        className="shrink-0 w-11 h-11 flex items-center justify-center rounded-md text-gray-600 hover:bg-gray-100 disabled:opacity-30"
        title="Delete"
        aria-label="Delete"
      >
        <Trash2 size={20} />
      </button>
    </div>
  );
};
