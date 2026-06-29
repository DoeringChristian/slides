import React, { useState, useRef, useEffect } from 'react';
import { usePresentationStore } from '../../store/presentationStore';
import { useEditorStore } from '../../store/editorStore';
import { useVaultStore } from '../../store/vaultStore';
import { usePresenterMode } from '../../hooks/usePresenterMode';
import { Play, Download, FilePlus, Undo2, Redo2, Monitor, ChevronDown, FileDown, Smartphone, Link as LinkIcon, Film } from 'lucide-react';
import { ExportDialog } from '../dialogs/ExportDialog';
import { ShareDialog } from '../dialogs/ShareDialog';
import { usePwaInstall } from '../../hooks/usePwaInstall';
import { useJoinedProjects } from '../../store/joinedStore';
import { useActivePeers } from '../../collab/activeAwareness';

export const Header: React.FC = () => {
  const title = usePresentationStore((s) => s.presentation.title);
  const updateTitle = usePresentationStore((s) => s.updateTitle);
  const resetPresentation = usePresentationStore((s) => s.resetPresentation);
  const setPresenting = useEditorStore((s) => s.setPresenting);
  const setPresentingSlideIndex = useEditorStore((s) => s.setPresentingSlideIndex);
  const autoDrawMode = useEditorStore((s) => s.autoDrawMode);
  const setAutoDrawMode = useEditorStore((s) => s.setAutoDrawMode);
  const slideOrder = usePresentationStore((s) => s.presentation.slideOrder);
  const activeSlideId = useEditorStore((s) => s.activeSlideId);

  const { startPresenterMode } = usePresenterMode();

  const activeProjectId = useVaultStore((s) => s.activeProjectId);
  const closeProject = useVaultStore((s) => s.closeProject);
  const storageMode = useVaultStore((s) => s.storageMode);
  const joinedProjects = useJoinedProjects();

  // Share is owner-only: visible when we're on the server and the project
  // isn't one we joined via someone else's link.
  const isJoined = !!activeProjectId && joinedProjects.some((p) => p.projectId === activeProjectId);
  const canShare = storageMode === 'server' && !!activeProjectId && !isJoined;

  const { canInstall, promptInstall } = usePwaInstall();

  const [isEditing, setIsEditing] = useState(false);
  const [showPresentMenu, setShowPresentMenu] = useState(false);
  const [showExportDialog, setShowExportDialog] = useState(false);
  const [showShareDialog, setShowShareDialog] = useState(false);
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

  const handleSave = async () => {
    const { exportStandaloneHtml } = await import('../../utils/exportStandaloneHtml');
    try {
      await exportStandaloneHtml(usePresentationStore.getState().presentation, { mode: 'viewer' });
    } catch (err) {
      console.error(err);
      alert((err as Error).message);
    }
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
        {activeProjectId ? (
          <button
            onClick={closeProject}
            className="w-8 h-8 bg-blue-500 hover:bg-blue-600 rounded flex items-center justify-center transition-colors cursor-pointer"
            title="Back to Projects"
          >
            <span className="text-white font-bold text-sm">S</span>
          </button>
        ) : (
          <div className="w-8 h-8 bg-blue-500 rounded flex items-center justify-center">
            <span className="text-white font-bold text-sm">S</span>
          </div>
        )}
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
        <button onClick={handleSave} className="p-1.5 rounded hover:bg-gray-100 text-gray-600" title="Save as standalone viewer HTML (⌘S)">
          <Download size={18} />
        </button>
        <button onClick={() => setShowExportDialog(true)} className="p-1.5 rounded hover:bg-gray-100 text-gray-600" title="Export">
          <FileDown size={18} />
        </button>
        {canInstall && (
          <button
            onClick={() => { void promptInstall(); }}
            className="p-1.5 rounded hover:bg-blue-50 text-blue-600"
            title="Install Slides as an app"
          >
            <Smartphone size={18} />
          </button>
        )}
        <div className="w-px h-6 bg-gray-300 mx-1" />
        <button onClick={handleUndo} className="p-1.5 rounded hover:bg-gray-100 text-gray-600" title="Undo (Ctrl+Z)">
          <Undo2 size={18} />
        </button>
        <button onClick={handleRedo} className="p-1.5 rounded hover:bg-gray-100 text-gray-600" title="Redo (Ctrl+Y)">
          <Redo2 size={18} />
        </button>
        <div className="w-px h-6 bg-gray-300 mx-1" />
        <button
          onClick={() => setAutoDrawMode(!autoDrawMode)}
          className={`p-1.5 rounded flex items-center gap-1 ${
            autoDrawMode
              ? 'bg-red-50 text-red-600 hover:bg-red-100'
              : 'hover:bg-gray-100 text-gray-600'
          }`}
          title={autoDrawMode
            ? 'Auto-draw: ON — each change spawns a new slide. Click to turn off.'
            : 'Auto-draw: OFF — turn on to record each edit as a new keyframe slide.'}
        >
          <Film size={18} />
          {autoDrawMode && <span className="text-xs font-medium">REC</span>}
        </button>
      </div>

      <div className="flex-1" />

      <PeerAvatars />

      {canShare && (
        <button
          onClick={() => setShowShareDialog(true)}
          className="flex items-center gap-1.5 text-sm text-gray-700 hover:bg-gray-100 px-3 py-1.5 rounded-md mr-2"
          title="Share this presentation"
        >
          <LinkIcon size={14} />
          Share
        </button>
      )}

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

      <ExportDialog isOpen={showExportDialog} onClose={() => setShowExportDialog(false)} />
      {canShare && (
        <ShareDialog
          isOpen={showShareDialog}
          projectId={activeProjectId!}
          onClose={() => setShowShareDialog(false)}
        />
      )}
    </div>
  );
};

// Small stack of avatar pills for every connected peer. Initial + color from
// their identity, tooltip shows the full name and which slide they're on.
const PeerAvatars: React.FC = () => {
  const peers = useActivePeers();
  if (peers.length === 0) return null;
  return (
    <div className="flex items-center gap-1 mr-3">
      {peers.map((p) => {
        const initial = (p.user.name || p.user.id || '?').trim().slice(0, 1).toUpperCase();
        return (
          <div
            key={p.clientId}
            className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-medium text-white shadow-sm"
            style={{ backgroundColor: p.user.color }}
            title={`${p.user.name}${p.activeSlideId ? ` — on a slide` : ''}`}
          >
            {initial}
          </div>
        );
      })}
    </div>
  );
};
