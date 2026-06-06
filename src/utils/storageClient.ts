import type { Presentation } from '../types/presentation';
import type { ProjectMeta } from '../types/vault';
import {
  saveProjectToIDB,
  loadProjectFromIDB,
  deleteProjectFromIDB,
  listProjectsFromIDB,
} from './vaultStorage';
import { getIdentity } from '../hooks/useIdentity';

export interface StorageClient {
  listProjects(): Promise<ProjectMeta[]>;
  getProject(id: string, shareToken?: string): Promise<{ presentation: Presentation; thumbnailDataUrl?: string } | null>;
  saveProject(presentation: Presentation, thumbnailDataUrl?: string): Promise<ProjectMeta>;
  deleteProject(id: string): Promise<void>;
  duplicateProject(id: string): Promise<ProjectMeta | null>;
}

/** Share-token metadata returned by the server. */
export interface ShareEntry {
  token: string;
  projectId: string;
  ownerId: string;
  createdAt: number;
  revoked: boolean;
}

// Storage mode configuration
export interface StorageConfig {
  mode: 'local' | 'server';
  serverUrl?: string;
}

let currentConfig: StorageConfig = { mode: 'local' };

export function getStorageConfig(): StorageConfig {
  return { ...currentConfig };
}

export function setStorageConfig(config: StorageConfig): void {
  currentConfig = { ...config };
  // Persist to localStorage
  localStorage.setItem('slides-storage-config', JSON.stringify(config));
}

// Load config from localStorage on init
export function initStorageConfig(): void {
  try {
    const saved = localStorage.getItem('slides-storage-config');
    if (saved) {
      currentConfig = JSON.parse(saved);
    }
  } catch {
    // Ignore errors, use default
  }
}

// Local storage client (IndexedDB)
const localClient: StorageClient = {
  async listProjects(): Promise<ProjectMeta[]> {
    return listProjectsFromIDB();
  },

  async getProject(id: string, _shareToken?: string) {
    const stored = await loadProjectFromIDB(id);
    if (!stored) return null;
    return {
      presentation: stored.presentation,
      thumbnailDataUrl: stored.thumbnailDataUrl,
    };
  },

  async saveProject(presentation: Presentation, thumbnailDataUrl?: string): Promise<ProjectMeta> {
    await saveProjectToIDB({
      id: presentation.id,
      presentation,
      thumbnailDataUrl,
    });
    return {
      id: presentation.id,
      title: presentation.title,
      filename: '',
      createdAt: presentation.createdAt,
      updatedAt: presentation.updatedAt,
      thumbnailDataUrl,
    };
  },

  async deleteProject(id: string): Promise<void> {
    await deleteProjectFromIDB(id);
  },

  async duplicateProject(id: string): Promise<ProjectMeta | null> {
    const stored = await loadProjectFromIDB(id);
    if (!stored) return null;

    const copy: Presentation = {
      ...stored.presentation,
      id: crypto.randomUUID(),
      title: `${stored.presentation.title} (Copy)`,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    return this.saveProject(copy, stored.thumbnailDataUrl);
  },
};

// Server storage client
function createServerClient(serverUrl: string): StorageClient {
  const baseUrl = serverUrl.replace(/\/$/, ''); // Remove trailing slash

  async function fetchJSON<T>(path: string, options?: RequestInit): Promise<T> {
    // Server scopes access by the anonymous identity in this header. Identity
    // is just a nanoid in localStorage (no auth), so this is presence-based
    // ownership for a personal tool — not a security boundary.
    const userId = getIdentity().userId;
    const response = await fetch(`${baseUrl}${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        'X-Slides-User': userId,
        ...options?.headers,
      },
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Unknown error' }));
      throw new Error(error.error || `HTTP ${response.status}`);
    }

    // Handle 204 No Content
    if (response.status === 204) {
      return undefined as T;
    }

    return response.json();
  }

  return {
    async listProjects(): Promise<ProjectMeta[]> {
      const projects = await fetchJSON<ProjectMeta[]>('/api/projects');
      // Add empty filename for compatibility
      return projects.map((p) => ({ ...p, filename: '' }));
    },

    async getProject(id: string, shareToken?: string) {
      try {
        const data = await fetchJSON<{
          id: string;
          presentation: Presentation;
          thumbnailDataUrl?: string;
        }>(`/api/projects/${id}`, shareToken ? { headers: { 'X-Share-Token': shareToken } } : undefined);
        return {
          presentation: data.presentation,
          thumbnailDataUrl: data.thumbnailDataUrl,
        };
      } catch (error) {
        if ((error as Error).message.includes('404')) {
          return null;
        }
        throw error;
      }
    },

    async saveProject(presentation: Presentation, thumbnailDataUrl?: string): Promise<ProjectMeta> {
      const meta = await fetchJSON<ProjectMeta>(`/api/projects/${presentation.id}`, {
        method: 'PUT',
        body: JSON.stringify({ presentation, thumbnailDataUrl }),
      });
      return { ...meta, filename: '' };
    },

    async deleteProject(id: string): Promise<void> {
      await fetchJSON(`/api/projects/${id}`, { method: 'DELETE' });
    },

    async duplicateProject(id: string): Promise<ProjectMeta | null> {
      try {
        const meta = await fetchJSON<ProjectMeta>(`/api/projects/${id}/duplicate`, {
          method: 'POST',
        });
        return { ...meta, filename: '' };
      } catch (error) {
        if ((error as Error).message.includes('404')) {
          return null;
        }
        throw error;
      }
    },
  };
}

// Get the current storage client based on config
export function getStorageClient(): StorageClient {
  if (currentConfig.mode === 'server' && currentConfig.serverUrl) {
    return createServerClient(currentConfig.serverUrl);
  }
  return localClient;
}

// Share-link helpers. Server-only — the local IDB / filesystem modes have no
// concept of sharing. Returns server JSON shapes directly; the dialog UI
// massages them.

function shareHeaders(): HeadersInit {
  return {
    'Content-Type': 'application/json',
    'X-Slides-User': getIdentity().userId,
  };
}

function shareBaseUrl(): string | null {
  if (currentConfig.mode !== 'server' || !currentConfig.serverUrl) return null;
  return currentConfig.serverUrl.replace(/\/$/, '');
}

export async function mintShare(projectId: string): Promise<ShareEntry> {
  const base = shareBaseUrl();
  if (!base) throw new Error('Share links require server mode');
  const res = await fetch(`${base}/api/projects/${projectId}/shares`, {
    method: 'POST',
    headers: shareHeaders(),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export async function listShares(projectId: string): Promise<ShareEntry[]> {
  const base = shareBaseUrl();
  if (!base) return [];
  const res = await fetch(`${base}/api/projects/${projectId}/shares`, {
    headers: shareHeaders(),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export async function revokeShare(token: string): Promise<void> {
  const base = shareBaseUrl();
  if (!base) throw new Error('Share links require server mode');
  const res = await fetch(`${base}/api/shares/${token}`, {
    method: 'DELETE',
    headers: shareHeaders(),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
}

// Test server connection
export async function testServerConnection(serverUrl: string): Promise<boolean> {
  try {
    const response = await fetch(`${serverUrl.replace(/\/$/, '')}/api/health`);
    if (!response.ok) return false;
    const data = await response.json();
    return data.status === 'ok';
  } catch {
    return false;
  }
}
