import React, { useState, useRef, useEffect } from 'react';
import { usePresentationStore } from '../../store/presentationStore';
import { useEditorStore } from '../../store/editorStore';
import { usePresenterMode } from '../../hooks/usePresenterMode';
import { Play, Download, Upload, FilePlus, Undo2, Redo2, Monitor, ChevronDown } from 'lucide-react';

export const Header: React.FC = () => {
  const title = usePresentationStore((s) => s.presentation.title);
  const updateTitle = usePresentationStore((s) => s.updateTitle);
  const resetPresentation = usePresentationStore((s) => s.resetPresentation);
  const loadPresentation = usePresentationStore((s) => s.loadPresentation);
  const setPresenting = useEditorStore((s) => s.setPresenting);
  const setPresentingSlideIndex = useEditorStore((s) => s.setPresentingSlideIndex);
  const slideOrder = usePresentationStore((s) => s.presentation.slideOrder);
  const activeSlideId = useEditorStore((s) => s.activeSlideId);

  const { startPresenterMode } = usePresenterMode();

  const [isEditing, setIsEditing] = useState(false);
  const [showPresentMenu, setShowPresentMenu] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  // Close present menu when clicking outside
  useEffect(() => {
    if (!showPresentMenu) return;
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setShowPresentMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [showPresentMenu]);

  const handlePresent = () => {
    const idx = slideOrder.indexOf(activeSlideId);
    setPresentingSlideIndex(Math.max(0, idx));
    setPresenting(true);
  };

  const handleSave = () => {
    const data = JSON.stringify(usePresentationStore.getState().presentation);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${title.replace(/\s+/g, '_')}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleLoad = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
        try {
          const data = JSON.parse(ev.target?.result as string);
          loadPresentation(data);
          const firstSlideId = data.slideOrder?.[0];
          if (firstSlideId) {
            useEditorStore.getState().setActiveSlide(firstSlideId);
          }
        } catch { /* ignore invalid json */ }
      };
      reader.readAsText(file);
    };
    input.click();
  };

  const handleUndo = () => {
    (usePresentationStore as any).temporal?.getState()?.undo();
  };

  const handleRedo = () => {
    (usePresentationStore as any).temporal?.getState()?.redo();
  };

  return (
    <div className="h-12 bg-white border-b border-gray-200 flex items-center px-4 gap-2 shrink-0">
      <div className="flex items-center gap-1 mr-4">
        <div className="w-8 h-8 bg-blue-500 rounded flex items-center justify-center">
          <span className="text-white font-bold text-sm">S</span>
        </div>
        {isEditing ? (
          <input
            ref={inputRef}
            className="text-lg font-medium border border-blue-400 rounded px-2 py-0.5 outline-none"
            value={title}
            onChange={(e) => updateTitle(e.target.value)}
            onBlur={() => setIsEditing(false)}
            onKeyDown={(e) => e.key === 'Enter' && setIsEditing(false)}
          />
        ) : (
          <span
            className="text-lg font-medium cursor-pointer hover:bg-gray-100 px-2 py-0.5 rounded"
            onClick={() => setIsEditing(true)}
          >
            {title}
          </span>
        )}
      </div>

      <div className="flex items-center gap-1">
        <button onClick={() => { resetPresentation(); useEditorStore.getState().setActiveSlide(usePresentationStore.getState().presentation.slideOrder[0]); }}
          className="p-1.5 rounded hover:bg-gray-100 text-gray-600" title="New">
          <FilePlus size={18} />
        </button>
        <button onClick={handleSave} className="p-1.5 rounded hover:bg-gray-100 text-gray-600" title="Save">
          <Download size={18} />
        </button>
        <button onClick={handleLoad} className="p-1.5 rounded hover:bg-gray-100 text-gray-600" title="Open">
          <Upload size={18} />
        </button>
        <div className="w-px h-6 bg-gray-300 mx-1" />
        <button onClick={handleUndo} className="p-1.5 rounded hover:bg-gray-100 text-gray-600" title="Undo (Ctrl+Z)">
          <Undo2 size={18} />
        </button>
        <button onClick={handleRedo} className="p-1.5 rounded hover:bg-gray-100 text-gray-600" title="Redo (Ctrl+Y)">
          <Redo2 size={18} />
        </button>
      </div>

      <div className="flex-1" />

      <div className="relative" ref={menuRef}>
        <div className="flex">
          <button
            onClick={handlePresent}
            className="flex items-center gap-2 bg-blue-500 hover:bg-blue-600 text-white px-4 py-1.5 rounded-l-md text-sm font-medium"
          >
            <Play size={16} />
            Present
          </button>
          <button
            onClick={() => setShowPresentMenu(!showPresentMenu)}
            className="flex items-center bg-blue-500 hover:bg-blue-600 text-white px-2 py-1.5 rounded-r-md border-l border-blue-400"
          >
            <ChevronDown size={14} />
          </button>
        </div>

        {showPresentMenu && (
          <div className="absolute right-0 top-full mt-1 bg-white border border-gray-200 rounded-md shadow-lg py-1 min-w-[180px] z-50">
            <button
              onClick={() => { handlePresent(); setShowPresentMenu(false); }}
              className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-gray-100"
            >
              <Play size={16} />
              Fullscreen
            </button>
            <button
              onClick={() => {
                const idx = slideOrder.indexOf(activeSlideId);
                setPresentingSlideIndex(Math.max(0, idx));
                startPresenterMode();
                setShowPresentMenu(false);
              }}
              className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-gray-100"
            >
              <Monitor size={16} />
              Presenter View
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
