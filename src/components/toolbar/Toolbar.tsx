import React from 'react';
import { useEditorStore } from '../../store/editorStore';
import { usePresentationStore } from '../../store/presentationStore';
import { useSelectedElements } from '../../store/selectors';
import { TextFormatBar } from './TextFormatBar';
import { ShapeMenu } from './ShapeMenu';
import { createImageElement, duplicateElement } from '../../utils/slideFactory';
import {
  MousePointer2, Type, Square, Circle, Triangle, Star, Minus, MoveRight,
  Image, Trash2, Copy, Clipboard, Scissors,
} from 'lucide-react';
import type { Tool } from '../../types/presentation';

const tools: { tool: Tool; icon: React.ReactNode; label: string }[] = [
  { tool: 'select', icon: <MousePointer2 size={16} />, label: 'Select (V)' },
  { tool: 'text', icon: <Type size={16} />, label: 'Text (T)' },
  { tool: 'rect', icon: <Square size={16} />, label: 'Rectangle (R)' },
  { tool: 'ellipse', icon: <Circle size={16} />, label: 'Ellipse (E)' },
  { tool: 'triangle', icon: <Triangle size={16} />, label: 'Triangle' },
  { tool: 'star', icon: <Star size={16} />, label: 'Star' },
  { tool: 'line', icon: <Minus size={16} />, label: 'Line (L)' },
  { tool: 'arrow', icon: <MoveRight size={16} />, label: 'Arrow (A)' },
  { tool: 'image', icon: <Image size={16} />, label: 'Image (I)' },
];

export const Toolbar: React.FC = () => {
  const currentTool = useEditorStore((s) => s.tool);
  const setTool = useEditorStore((s) => s.setTool);
  const selectedIds = useEditorStore((s) => s.selectedElementIds);
  const activeSlideId = useEditorStore((s) => s.activeSlideId);
  const deleteElements = usePresentationStore((s) => s.deleteElements);
  const selectedElements = useSelectedElements();
  const clipboard = useEditorStore((s) => s.clipboard);
  const setClipboard = useEditorStore((s) => s.setClipboard);
  const setSelectedElements = useEditorStore((s) => s.setSelectedElements);
  const addElement = usePresentationStore((s) => s.addElement);

  const handleImageTool = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
        const src = ev.target?.result as string;
        const img = new window.Image();
        img.onload = () => {
          const el = createImageElement(src, img.width, img.height);
          addElement(activeSlideId, el);
          setSelectedElements([el.id]);
          setTool('select');
        };
        img.src = src;
      };
      reader.readAsDataURL(file);
    };
    input.click();
  };

  const handleCopy = () => {
    if (selectedElements.length > 0) {
      setClipboard(selectedElements.map((e) => JSON.parse(JSON.stringify(e))));
    }
  };

  const handleCut = () => {
    handleCopy();
    if (activeSlideId && selectedIds.length > 0) {
      deleteElements(activeSlideId, selectedIds);
      setSelectedElements([]);
    }
  };

  const handlePaste = () => {
    if (clipboard.length > 0 && activeSlideId) {
      const newIds: string[] = [];
      clipboard.forEach((el: any) => {
        const dup = duplicateElement(el);
        addElement(activeSlideId, dup);
        newIds.push(dup.id);
      });
      setSelectedElements(newIds);
    }
  };

  const handleDelete = () => {
    if (activeSlideId && selectedIds.length > 0) {
      deleteElements(activeSlideId, selectedIds);
      setSelectedElements([]);
    }
  };

  const showTextFormat = selectedElements.length === 1 && selectedElements[0].type === 'text';

  return (
    <div className="h-10 bg-white border-b border-gray-200 flex items-center px-2 gap-1 shrink-0">
      {tools.map(({ tool, icon, label }) => (
        <button
          key={tool}
          onClick={() => tool === 'image' ? handleImageTool() : setTool(tool)}
          className={`p-1.5 rounded text-gray-600 ${currentTool === tool ? 'bg-blue-100 text-blue-600' : 'hover:bg-gray-100'}`}
          title={label}
        >
          {icon}
        </button>
      ))}

      <div className="w-px h-6 bg-gray-300 mx-1" />

      <button onClick={handleCopy} className="p-1.5 rounded hover:bg-gray-100 text-gray-600 disabled:opacity-30" disabled={selectedIds.length === 0} title="Copy (Ctrl+C)">
        <Copy size={16} />
      </button>
      <button onClick={handleCut} className="p-1.5 rounded hover:bg-gray-100 text-gray-600 disabled:opacity-30" disabled={selectedIds.length === 0} title="Cut (Ctrl+X)">
        <Scissors size={16} />
      </button>
      <button onClick={handlePaste} className="p-1.5 rounded hover:bg-gray-100 text-gray-600 disabled:opacity-30" disabled={clipboard.length === 0} title="Paste (Ctrl+V)">
        <Clipboard size={16} />
      </button>
      <button onClick={handleDelete} className="p-1.5 rounded hover:bg-gray-100 text-gray-600 disabled:opacity-30" disabled={selectedIds.length === 0} title="Delete">
        <Trash2 size={16} />
      </button>

      {showTextFormat && (
        <>
          <div className="w-px h-6 bg-gray-300 mx-1" />
          <TextFormatBar />
        </>
      )}
    </div>
  );
};
