import { create } from 'zustand';
import type { ProjectMeta } from '../types/vault';
import { isFileSystemAccessSupported } from '../types/vault';
import {
  saveVaultHandle,
  loadVaultHandle,
  clearVaultHandle,
  verifyVaultPermission,
} from '../utils/vaultStorage';
import {
  listProjects as listProjectsFS,
  loadProject as loadProjectFS,
  saveProject as saveProjectFS,
  deleteProject as deleteProjectFS,
  duplicateProject as duplicateProjectFS,
} from '../utils/projectFiles';
import {
  getStorageClient,
  getStorageConfig,
  setStorageConfig,
  initStorageConfig,
  testServerConnection,
} from '../utils/storageClient';
import { usePresentationStore } from './presentationStore';
import { useEditorStore } from './editorStore';
import { createPresentation } from '../utils/slideFactory';

const supportsFileSystem = isFileSystemAccessSupported();

// Storage modes
export type StorageMode = 'local' | 'server' | 'filesystem';

interface VaultStore {
  // State
  vaultHandle: FileSystemDirectoryHandle | null;
  projects: ProjectMeta[];
  activeProjectId: string | null;
  isLoading: boolean;
  error: string | null;
  currentFilename: string | null;
  saveDebounceTimer: ReturnType<typeof setTimeout> | null;
  storageMode: StorageMode;
  serverUrl: string | null;

  // Initialization
  initialize: () => Promise<void>;

  // Storage mode management
  setStorageMode: (mode: StorageMode, serverUrl?: string) => Promise<void>;
  testServer: (url: string) => Promise<boolean>;

  // Vault management (File System mode only)
  selectVault: () => Promise<void>;
  clearVault: () => void;

  // Project management
  loadProjects: () => Promise<void>;
  createProject: (title: string) => Promise<void>;
  openProject: (id: string) => Promise<void>;
  deleteProject: (id: string) => Promise<void>;
  duplicateProject: (id: string) => Promise<void>;

  // Current project
  saveCurrentProject: () => Promise<void>;
  scheduleSave: () => void;
  closeProject: () => void;

  // Thumbnail
  updateThumbnail: (id: string, dataUrl: string) => void;

  // Error handling
  setError: (error: string | null) => void;
}

export const useVaultStore = create<VaultStore>()((set, get) => ({
  vaultHandle: null,
  projects: [],
  activeProjectId: null,
  isLoading: false,
  error: null,
  currentFilename: null,
  saveDebounceTimer: null,
  storageMode: 'local',
  serverUrl: null,

  initialize: async () => {
    set({ isLoading: true, error: null });

    // Load storage config
    initStorageConfig();
    const config = getStorageConfig();

    try {
      if (config.mode === 'server' && config.serverUrl) {
        // Server mode
        const isConnected = await testServerConnection(config.serverUrl);
        if (isConnected) {
          set({ storageMode: 'server', serverUrl: config.serverUrl });
          await get().loadProjects();
          return;
        } else {
          // Fall back to local if server unavailable
          console.warn('Server unavailable, falling back to local storage');
          setStorageConfig({ mode: 'local' });
        }
      }

      // Try to load vault handle for File System mode
      if (supportsFileSystem) {
        const handle = await loadVaultHandle();
        if (handle) {
          const hasPermission = await verifyVaultPermission(handle);
          if (hasPermission) {
            set({ vaultHandle: handle, storageMode: 'filesystem' });
            await get().loadProjects();
            return;
          } else {
            await clearVaultHandle();
          }
        }
      }

      // Fall back to local (IndexedDB) mode
      set({ storageMode: 'local' });
      await get().loadProjects();
    } catch (error) {
      set({ error: 'Failed to initialize' });
      console.error('Vault initialization error:', error);
    } finally {
      set({ isLoading: false });
    }
  },

  setStorageMode: async (mode: StorageMode, serverUrl?: string) => {
    set({ isLoading: true, error: null });

    try {
      if (mode === 'server') {
        if (!serverUrl) {
          throw new Error('Server URL required');
        }
        const isConnected = await testServerConnection(serverUrl);
        if (!isConnected) {
          throw new Error('Cannot connect to server');
        }
        setStorageConfig({ mode: 'server', serverUrl });
        set({ storageMode: 'server', serverUrl, vaultHandle: null });
      } else if (mode === 'filesystem') {
        // Will be set up via selectVault
        set({ storageMode: 'filesystem', serverUrl: null });
      } else {
        setStorageConfig({ mode: 'local' });
        set({ storageMode: 'local', serverUrl: null, vaultHandle: null });
      }

      // Clear current project and reload projects
      set({ activeProjectId: null, currentFilename: null });
      await get().loadProjects();
    } catch (error) {
      set({ error: (error as Error).message });
    } finally {
      set({ isLoading: false });
    }
  },

  testServer: async (url: string) => {
    return testServerConnection(url);
  },

  selectVault: async () => {
    if (!supportsFileSystem) return;

    set({ isLoading: true, error: null });
    try {
      const handle = await window.showDirectoryPicker({ mode: 'readwrite' });
      await saveVaultHandle(handle);
      set({
        vaultHandle: handle,
        storageMode: 'filesystem',
        serverUrl: null,
        activeProjectId: null,
        currentFilename: null,
      });
      await get().loadProjects();
    } catch (error) {
      if ((error as Error).name !== 'AbortError') {
        set({ error: 'Failed to select vault folder' });
        console.error('Vault selection error:', error);
      }
    } finally {
      set({ isLoading: false });
    }
  },

  clearVault: async () => {
    await clearVaultHandle();
    set({
      vaultHandle: null,
      storageMode: 'local',
      activeProjectId: null,
      currentFilename: null,
      error: null,
    });
    setStorageConfig({ mode: 'local' });
    await get().loadProjects();
  },

  loadProjects: async () => {
    const { vaultHandle, storageMode } = get();
    set({ isLoading: true, error: null });

    try {
      let projects: ProjectMeta[];

      if (storageMode === 'filesystem' && vaultHandle) {
        projects = await listProjectsFS(vaultHandle);
      } else {
        // Use storage client for local or server mode
        const client = getStorageClient();
        projects = await client.listProjects();
      }

      set({ projects });
    } catch (error) {
      set({ error: 'Failed to load projects' });
      console.error('Load projects error:', error);
    } finally {
      set({ isLoading: false });
    }
  },

  createProject: async (title: string) => {
    const { vaultHandle, storageMode } = get();
    set({ isLoading: true, error: null });

    try {
      const presentation = createPresentation();
      presentation.title = title;

      let newProject: ProjectMeta;

      if (storageMode === 'filesystem' && vaultHandle) {
        const filename = await saveProjectFS(vaultHandle, presentation);
        newProject = {
          id: presentation.id,
          title: presentation.title,
          filename,
          createdAt: presentation.createdAt,
          updatedAt: presentation.updatedAt,
        };
      } else {
        const client = getStorageClient();
        newProject = await client.saveProject(presentation);
      }

      set((state) => ({
        projects: [newProject, ...state.projects],
      }));

      await get().openProject(presentation.id);
    } catch (error) {
      set({ error: 'Failed to create project' });
      console.error('Create project error:', error);
    } finally {
      set({ isLoading: false });
    }
  },

  openProject: async (id: string) => {
    const { vaultHandle, projects, storageMode } = get();
    const project = projects.find((p) => p.id === id);
    if (!project) return;

    set({ isLoading: true, error: null });

    try {
      let presentation;

      if (storageMode === 'filesystem' && vaultHandle) {
        presentation = await loadProjectFS(vaultHandle, project.filename);
      } else {
        const client = getStorageClient();
        const data = await client.getProject(id);
        if (!data) throw new Error('Project not found');
        presentation = data.presentation;
      }

      usePresentationStore.getState().loadPresentation(presentation);

      if (presentation.slideOrder.length > 0) {
        useEditorStore.getState().setActiveSlide(presentation.slideOrder[0]);
      }

      set({
        activeProjectId: id,
        currentFilename: project.filename || null,
      });
    } catch (error) {
      set({ error: 'Failed to open project' });
      console.error('Open project error:', error);
    } finally {
      set({ isLoading: false });
    }
  },

  deleteProject: async (id: string) => {
    const { vaultHandle, projects, activeProjectId, storageMode } = get();
    const project = projects.find((p) => p.id === id);
    if (!project) return;

    set({ isLoading: true, error: null });

    try {
      if (storageMode === 'filesystem' && vaultHandle) {
        await deleteProjectFS(vaultHandle, project.filename);
      } else {
        const client = getStorageClient();
        await client.deleteProject(id);
      }

      set((state) => ({
        projects: state.projects.filter((p) => p.id !== id),
        activeProjectId: activeProjectId === id ? null : activeProjectId,
        currentFilename: activeProjectId === id ? null : state.currentFilename,
      }));
    } catch (error) {
      set({ error: 'Failed to delete project' });
      console.error('Delete project error:', error);
    } finally {
      set({ isLoading: false });
    }
  },

  duplicateProject: async (id: string) => {
    const { vaultHandle, projects, storageMode } = get();
    const project = projects.find((p) => p.id === id);
    if (!project) return;

    set({ isLoading: true, error: null });

    try {
      let newProject: ProjectMeta | null;

      if (storageMode === 'filesystem' && vaultHandle) {
        newProject = await duplicateProjectFS(vaultHandle, project.filename);
      } else {
        const client = getStorageClient();
        newProject = await client.duplicateProject(id);
      }

      if (newProject) {
        set((state) => ({
          projects: [newProject!, ...state.projects],
        }));
      }
    } catch (error) {
      set({ error: 'Failed to duplicate project' });
      console.error('Duplicate project error:', error);
    } finally {
      set({ isLoading: false });
    }
  },

  saveCurrentProject: async () => {
    const { vaultHandle, activeProjectId, currentFilename, storageMode, projects } = get();
    if (!activeProjectId) return;

    try {
      const presentation = usePresentationStore.getState().presentation;
      const project = projects.find((p) => p.id === activeProjectId);
      const thumbnailDataUrl = project?.thumbnailDataUrl;

      if (storageMode === 'filesystem' && vaultHandle) {
        const newFilename = await saveProjectFS(vaultHandle, presentation, currentFilename || undefined);

        set((state) => ({
          currentFilename: newFilename,
          projects: state.projects.map((p) =>
            p.id === activeProjectId
              ? { ...p, filename: newFilename, title: presentation.title, updatedAt: presentation.updatedAt }
              : p
          ),
        }));
      } else {
        const client = getStorageClient();
        await client.saveProject(presentation, thumbnailDataUrl);

        set((state) => ({
          projects: state.projects.map((p) =>
            p.id === activeProjectId
              ? { ...p, title: presentation.title, updatedAt: presentation.updatedAt }
              : p
          ),
        }));
      }
    } catch (error) {
      console.error('Save project error:', error);
    }
  },

  scheduleSave: () => {
    const { saveDebounceTimer, activeProjectId } = get();
    if (!activeProjectId) return;

    if (saveDebounceTimer) {
      clearTimeout(saveDebounceTimer);
    }

    const timer = setTimeout(() => {
      get().saveCurrentProject();
    }, 500);

    set({ saveDebounceTimer: timer });
  },

  closeProject: () => {
    const { saveDebounceTimer } = get();
    if (saveDebounceTimer) {
      clearTimeout(saveDebounceTimer);
    }
    get().saveCurrentProject();

    set({
      activeProjectId: null,
      currentFilename: null,
      saveDebounceTimer: null,
    });
  },

  updateThumbnail: async (id: string, dataUrl: string) => {
    const { storageMode, vaultHandle, projects } = get();

    // Update in store
    set((state) => ({
      projects: state.projects.map((p) =>
        p.id === id ? { ...p, thumbnailDataUrl: dataUrl } : p
      ),
    }));

    // Also save if not in filesystem mode
    if (storageMode !== 'filesystem' || !vaultHandle) {
      const project = projects.find((p) => p.id === id);
      if (project) {
        try {
          const client = getStorageClient();
          const data = await client.getProject(id);
          if (data) {
            await client.saveProject(data.presentation, dataUrl);
          }
        } catch (error) {
          console.error('Failed to save thumbnail:', error);
        }
      }
    }
  },

  setError: (error: string | null) => set({ error }),
}));
