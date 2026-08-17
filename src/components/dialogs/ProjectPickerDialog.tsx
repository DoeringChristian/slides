import React, { useState, useEffect, useRef } from 'react';
import { RefreshCw, Loader2, Settings, Upload, Menu, X } from 'lucide-react';
import { useVaultStore } from '../../store/vaultStore';
import { usePresentationStore } from '../../store/presentationStore';
import { useEditorStore } from '../../store/editorStore';
import { useIsMobile } from '../../hooks/useIsMobile';
import { ProjectCard, NewProjectCard } from './ProjectCard';
// NOTE: thumbnailGenerator is imported lazily at the call sites below. It
// pulls in svgRenderer → react-dom/server (shape markup now comes from the
// shared RenderShape via renderToStaticMarkup), which must stay out of the
// main editor chunk — same treatment as the export utilities.
import { StorageSettingsDialog } from './StorageSettingsDialog';
import { getStorageClient } from '../../utils/storageClient';
import { useJoinedProjects, removeJoinedProject } from '../../store/joinedStore';

export const ProjectPickerDialog: React.FC = () => {
  const [showSettings, setShowSettings] = useState(false);
  const [showMobileMenu, setShowMobileMenu] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const isMobile = useIsMobile();

  const vaultHandle = useVaultStore((s) => s.vaultHandle);
  const projects = useVaultStore((s) => s.projects);
  const isLoading = useVaultStore((s) => s.isLoading);
  const error = useVaultStore((s) => s.error);
  const storageMode = useVaultStore((s) => s.storageMode);
  const serverUrl = useVaultStore((s) => s.serverUrl);

  const loadProjects = useVaultStore((s) => s.loadProjects);
  const createProject = useVaultStore((s) => s.createProject);
  const openProject = useVaultStore((s) => s.openProject);
  const deleteProject = useVaultStore((s) => s.deleteProject);
  const duplicateProject = useVaultStore((s) => s.duplicateProject);
  const updateThumbnail = useVaultStore((s) => s.updateThumbnail);

  const loadPresentation = usePresentationStore((s) => s.loadPresentation);
  const setActiveSlide = useEditorStore((s) => s.setActiveSlide);

  // "Shared with me" — projects the user joined via someone else's share URL.
  // Only meaningful in server mode; we still surface them in other modes for
  // visibility, since clicking one switches to server mode anyway.
  const joinedProjects = useJoinedProjects();

  // Generate thumbnails for projects that don't have them
  useEffect(() => {
    const generateMissingThumbnails = async () => {
      for (const project of projects) {
        if (!project.thumbnailDataUrl) {
          try {
            let data: any = null;

            if (storageMode === 'filesystem' && vaultHandle) {
              // Load from filesystem
              const fileHandle = await vaultHandle.getFileHandle(project.filename);
              const file = await fileHandle.getFile();
              const text = await file.text();
              data = JSON.parse(text);
            } else {
              // Load from local/server storage
              const client = getStorageClient();
              const result = await client.getProject(project.id);
              if (result) {
                data = result.presentation;
              }
            }

            if (data && data.slideOrder && data.slideOrder.length > 0 && data.slides) {
              const firstSlide = data.slides[data.slideOrder[0]];
              if (firstSlide) {
                const { generateThumbnail } = await import('../../utils/thumbnailGenerator');
                const thumbnail = await generateThumbnail(firstSlide, data.resources || {});
                updateThumbnail(project.id, thumbnail);
              }
            }
          } catch (err) {
            console.warn(`Failed to generate thumbnail for ${project.id}:`, err);
          }
        }
      }
    };

    generateMissingThumbnails();
  }, [projects, vaultHandle, storageMode, updateThumbnail]);

  const handleImport = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      let presentation;
      const ext = file.name.split('.').pop()?.toLowerCase();

      if (ext === 'pptx') {
        const { importPptx } = await import('../../utils/importPptx');
        presentation = await importPptx(file);
      } else if (ext === 'odp') {
        const { importOdp } = await import('../../utils/importOdp');
        presentation = await importOdp(file);
      } else {
        // JSON import (existing logic)
        const text = await file.text();
        const data = JSON.parse(text);

        if (!data.slideOrder || !data.slides) {
          throw new Error('Invalid presentation file');
        }

        presentation = {
          ...data,
          id: data.id || crypto.randomUUID(),
          updatedAt: Date.now(),
        };
      }

      // Load the presentation and open it
      loadPresentation(presentation);

      // Set the first slide as active
      if (presentation.slideOrder.length > 0) {
        setActiveSlide(presentation.slideOrder[0]);
      }

      // Save it to storage and open
      const client = getStorageClient();
      const firstSlide = presentation.slides[presentation.slideOrder[0]];
      let thumbnail: string | undefined;
      if (firstSlide) {
        try {
          const { generateThumbnail } = await import('../../utils/thumbnailGenerator');
          thumbnail = await generateThumbnail(firstSlide, presentation.resources || {});
        } catch {
          // Thumbnail generation can fail (e.g. foreignObject in SVG); continue without it
        }
      }
      await client.saveProject(presentation, thumbnail);

      // Reload projects and open the imported one
      await loadProjects();
      await openProject(presentation.id);
    } catch (err) {
      console.error('Failed to import presentation:', err);
      alert('Failed to import presentation. Please check the file format.');
    }

    // Reset the input
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  return (
    <div className="fixed inset-0 bg-gray-100 flex flex-col">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-6 py-4">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold text-gray-900">Your Presentations</h1>
            <p className="text-sm text-gray-500 mt-0.5">
              {projects.length} presentation{projects.length !== 1 ? 's' : ''}
              {storageMode === 'server' && serverUrl && (
                <span className="ml-2 text-blue-600">(server)</span>
              )}
              {storageMode === 'filesystem' && vaultHandle && (
                <span className="ml-2 text-green-600">(synced to folder)</span>
              )}
            </p>
          </div>
          {isMobile ? (
            // On phones, collapse the three header actions into a hamburger
            // menu — keeps the project grid the focal point.
            <button
              onClick={() => setShowMobileMenu(true)}
              className="w-10 h-10 flex items-center justify-center rounded-lg text-gray-600 hover:bg-gray-100"
              aria-label="Menu"
            >
              <Menu size={20} />
            </button>
          ) : (
            <div className="flex items-center gap-2">
              <button
                onClick={handleImport}
                className="flex items-center gap-2 px-3 py-2 text-sm text-gray-600 hover:text-gray-800 hover:bg-gray-100 rounded-lg transition-colors"
              >
                <Upload size={16} />
                Import
              </button>
              <button
                onClick={loadProjects}
                disabled={isLoading}
                className="flex items-center gap-2 px-3 py-2 text-sm text-gray-600 hover:text-gray-800 hover:bg-gray-100 rounded-lg transition-colors"
              >
                <RefreshCw size={16} className={isLoading ? 'animate-spin' : ''} />
                Refresh
              </button>
              <button
                onClick={() => setShowSettings(true)}
                className="flex items-center gap-2 px-3 py-2 text-sm text-gray-600 hover:text-gray-800 hover:bg-gray-100 rounded-lg transition-colors"
              >
                <Settings size={16} />
                Storage
              </button>
            </div>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept=".json,.pptx,.odp"
            onChange={handleFileChange}
            className="hidden"
          />
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto">
        <div className="max-w-6xl mx-auto p-6">
          {error && (
            <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700">
              {error}
            </div>
          )}

          {isLoading && projects.length === 0 ? (
            <div className="flex items-center justify-center h-64">
              <Loader2 size={32} className="animate-spin text-gray-400" />
            </div>
          ) : (
            <>
              {/* Owned projects */}
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
                <NewProjectCard onClick={() => createProject()} />
                {projects.map((project) => (
                  <ProjectCard
                    key={project.id}
                    project={project}
                    onOpen={() => openProject(project.id)}
                    onDuplicate={() => duplicateProject(project.id)}
                    onDelete={() => deleteProject(project.id)}
                  />
                ))}
              </div>

              {/* Shared with me */}
              {joinedProjects.length > 0 && (
                <>
                  <h2 className="mt-8 mb-3 text-sm font-medium text-gray-500 uppercase tracking-wide">
                    Shared with me
                  </h2>
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
                    {joinedProjects.map((j) => (
                      <ProjectCard
                        key={j.projectId}
                        project={{
                          id: j.projectId,
                          title: j.title || j.projectId,
                          filename: '',
                          createdAt: j.joinedAt,
                          updatedAt: j.refreshedAt || j.joinedAt,
                          thumbnailDataUrl: j.thumbnailDataUrl,
                        }}
                        onOpen={() => openProject(j.projectId)}
                        // Removing a joined project just drops it from the
                        // localStorage list — the server-side project is
                        // owned by someone else; we can't (and shouldn't)
                        // delete it.
                        onDelete={() => removeJoinedProject(j.projectId)}
                        onDuplicate={() => { /* no-op: not our project */ }}
                      />
                    ))}
                  </div>
                </>
              )}
            </>
          )}
        </div>
      </div>

      <StorageSettingsDialog isOpen={showSettings} onClose={() => setShowSettings(false)} />

      {showMobileMenu && (
        <div className="fixed inset-0 z-50 flex">
          <div className="absolute inset-0 bg-black/40" onClick={() => setShowMobileMenu(false)} />
          <div className="relative ml-auto bg-white w-72 max-w-[80vw] h-full shadow-xl flex flex-col">
            <div className="h-12 flex items-center justify-between px-4 border-b border-gray-200">
              <span className="font-medium">Menu</span>
              <button onClick={() => setShowMobileMenu(false)} className="w-10 h-10 flex items-center justify-center text-gray-600">
                <X size={20} />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto py-2">
              <button
                onClick={() => { handleImport(); setShowMobileMenu(false); }}
                className="w-full flex items-center gap-3 px-4 py-3 text-left text-sm hover:bg-gray-100"
              >
                <Upload size={18} /> Import
              </button>
              <button
                onClick={() => { loadProjects(); setShowMobileMenu(false); }}
                disabled={isLoading}
                className="w-full flex items-center gap-3 px-4 py-3 text-left text-sm hover:bg-gray-100 disabled:opacity-50"
              >
                <RefreshCw size={18} className={isLoading ? 'animate-spin' : ''} /> Refresh
              </button>
              <button
                onClick={() => { setShowSettings(true); setShowMobileMenu(false); }}
                className="w-full flex items-center gap-3 px-4 py-3 text-left text-sm hover:bg-gray-100"
              >
                <Settings size={18} /> Storage settings
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
