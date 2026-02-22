import React, { useState, useEffect } from 'react';
import { RefreshCw, Loader2, Settings } from 'lucide-react';
import { useVaultStore } from '../../store/vaultStore';
import { ProjectCard, NewProjectCard } from './ProjectCard';
import { generateThumbnail } from '../../utils/thumbnailGenerator';
import { StorageSettingsDialog } from './StorageSettingsDialog';

export const ProjectPickerDialog: React.FC = () => {
  const [newProjectTitle, setNewProjectTitle] = useState('');
  const [showNewInput, setShowNewInput] = useState(false);
  const [showSettings, setShowSettings] = useState(false);

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

  // Generate thumbnails for projects that don't have them
  useEffect(() => {
    const generateMissingThumbnails = async () => {
      if (!vaultHandle) return;

      for (const project of projects) {
        if (!project.thumbnailDataUrl) {
          try {
            // Load the project to get the first slide
            const fileHandle = await vaultHandle.getFileHandle(project.filename);
            const file = await fileHandle.getFile();
            const text = await file.text();
            const data = JSON.parse(text);

            if (data.slideOrder && data.slideOrder.length > 0 && data.slides) {
              const firstSlide = data.slides[data.slideOrder[0]];
              if (firstSlide) {
                const thumbnail = await generateThumbnail(firstSlide, data.resources || {});
                updateThumbnail(project.id, thumbnail);
              }
            }
          } catch (err) {
            console.warn(`Failed to generate thumbnail for ${project.filename}:`, err);
          }
        }
      }
    };

    generateMissingThumbnails();
  }, [projects, vaultHandle, updateThumbnail]);

  const handleCreateProject = () => {
    if (newProjectTitle.trim()) {
      createProject(newProjectTitle.trim());
      setNewProjectTitle('');
      setShowNewInput(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleCreateProject();
    } else if (e.key === 'Escape') {
      setShowNewInput(false);
      setNewProjectTitle('');
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
          <div className="flex items-center gap-2">
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
            /* Project grid */
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
              {/* New project input or card */}
              {showNewInput ? (
                <div className="flex flex-col border-2 border-blue-400 rounded-lg overflow-hidden bg-white">
                  <div className="aspect-video flex items-center justify-center bg-blue-50">
                    <div className="text-4xl font-light text-blue-400">+</div>
                  </div>
                  <div className="p-3">
                    <input
                      type="text"
                      value={newProjectTitle}
                      onChange={(e) => setNewProjectTitle(e.target.value)}
                      onKeyDown={handleKeyDown}
                      placeholder="Presentation title..."
                      autoFocus
                      className="w-full px-2 py-1 text-sm border border-gray-300 rounded focus:outline-none focus:border-blue-400"
                    />
                    <div className="flex gap-2 mt-2">
                      <button
                        onClick={handleCreateProject}
                        disabled={!newProjectTitle.trim()}
                        className="flex-1 px-3 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        Create
                      </button>
                      <button
                        onClick={() => {
                          setShowNewInput(false);
                          setNewProjectTitle('');
                        }}
                        className="px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100 rounded"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                </div>
              ) : (
                <NewProjectCard onClick={() => setShowNewInput(true)} />
              )}

              {/* Existing projects */}
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
          )}
        </div>
      </div>

      <StorageSettingsDialog isOpen={showSettings} onClose={() => setShowSettings(false)} />
    </div>
  );
};
