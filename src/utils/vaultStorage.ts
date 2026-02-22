const DB_NAME = 'slides-vault';
const DB_VERSION = 2;
const HANDLES_STORE = 'handles';
const PROJECTS_STORE = 'projects';
const VAULT_KEY = 'vault-handle';

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(HANDLES_STORE)) {
        db.createObjectStore(HANDLES_STORE);
      }
      if (!db.objectStoreNames.contains(PROJECTS_STORE)) {
        db.createObjectStore(PROJECTS_STORE, { keyPath: 'id' });
      }
    };
  });
}

export async function saveVaultHandle(handle: FileSystemDirectoryHandle): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(HANDLES_STORE, 'readwrite');
    const store = transaction.objectStore(HANDLES_STORE);
    const request = store.put(handle, VAULT_KEY);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve();

    transaction.oncomplete = () => db.close();
  });
}

export async function loadVaultHandle(): Promise<FileSystemDirectoryHandle | null> {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(HANDLES_STORE, 'readonly');
      const store = transaction.objectStore(HANDLES_STORE);
      const request = store.get(VAULT_KEY);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result || null);

      transaction.oncomplete = () => db.close();
    });
  } catch {
    return null;
  }
}

export async function clearVaultHandle(): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(HANDLES_STORE, 'readwrite');
    const store = transaction.objectStore(HANDLES_STORE);
    const request = store.delete(VAULT_KEY);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve();

    transaction.oncomplete = () => db.close();
  });
}

// Verify we still have permission to access the vault
export async function verifyVaultPermission(handle: FileSystemDirectoryHandle): Promise<boolean> {
  try {
    const permission = await handle.queryPermission({ mode: 'readwrite' });
    if (permission === 'granted') return true;

    const request = await handle.requestPermission({ mode: 'readwrite' });
    return request === 'granted';
  } catch {
    return false;
  }
}

// IndexedDB-based project storage (fallback for browsers without File System Access API)
import type { Presentation } from '../types/presentation';
import type { ProjectMeta } from '../types/vault';

export interface StoredProject {
  id: string;
  presentation: Presentation;
  thumbnailDataUrl?: string;
}

export async function saveProjectToIDB(project: StoredProject): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(PROJECTS_STORE, 'readwrite');
    const store = transaction.objectStore(PROJECTS_STORE);
    const request = store.put(project);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve();

    transaction.oncomplete = () => db.close();
  });
}

export async function loadProjectFromIDB(id: string): Promise<StoredProject | null> {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(PROJECTS_STORE, 'readonly');
      const store = transaction.objectStore(PROJECTS_STORE);
      const request = store.get(id);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result || null);

      transaction.oncomplete = () => db.close();
    });
  } catch {
    return null;
  }
}

export async function deleteProjectFromIDB(id: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(PROJECTS_STORE, 'readwrite');
    const store = transaction.objectStore(PROJECTS_STORE);
    const request = store.delete(id);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve();

    transaction.oncomplete = () => db.close();
  });
}

export async function listProjectsFromIDB(): Promise<ProjectMeta[]> {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(PROJECTS_STORE, 'readonly');
      const store = transaction.objectStore(PROJECTS_STORE);
      const request = store.getAll();

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const projects: ProjectMeta[] = (request.result as StoredProject[]).map((p) => ({
          id: p.id,
          title: p.presentation.title,
          filename: '', // Not used in IDB mode
          createdAt: p.presentation.createdAt,
          updatedAt: p.presentation.updatedAt,
          thumbnailDataUrl: p.thumbnailDataUrl,
        }));
        // Sort by most recently updated
        projects.sort((a, b) => b.updatedAt - a.updatedAt);
        resolve(projects);
      };

      transaction.oncomplete = () => db.close();
    });
  } catch {
    return [];
  }
}
