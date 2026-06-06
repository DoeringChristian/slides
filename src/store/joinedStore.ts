// Per-browser "shared with me" list. Each entry is a project the user has
// opened via a share URL — projectId + token + a cached title for the picker.
// Persisted to localStorage; no server-side mirror.

import { useSyncExternalStore } from 'react';

export interface JoinedProject {
  projectId: string;
  token: string;
  /** Cached so the picker can show something useful without a refetch. */
  title?: string;
  thumbnailDataUrl?: string;
  joinedAt: number;
  /** Last time the title/thumbnail were refreshed. */
  refreshedAt?: number;
}

const STORAGE_KEY = 'slides.joined';

let cached: JoinedProject[] | null = null;
const listeners = new Set<() => void>();

function read(): JoinedProject[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed;
  } catch {
    return [];
  }
}

function ensure(): JoinedProject[] {
  if (cached) return cached;
  cached = read();
  return cached;
}

function write(list: JoinedProject[]) {
  cached = list;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  } catch {
    /* localStorage disabled — degrade silently */
  }
  listeners.forEach((cb) => cb());
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function useJoinedProjects(): JoinedProject[] {
  return useSyncExternalStore(subscribe, ensure, ensure);
}

export function getJoinedProjects(): JoinedProject[] {
  return ensure();
}

export function getJoinedProject(projectId: string): JoinedProject | undefined {
  return ensure().find((p) => p.projectId === projectId);
}

/** Add or update a joined entry. Idempotent on projectId — if the user joins
 *  the same share twice, the entry is refreshed in place rather than dup'd. */
export function addJoinedProject(entry: Omit<JoinedProject, 'joinedAt'> & { joinedAt?: number }) {
  const list = ensure().filter((p) => p.projectId !== entry.projectId);
  list.unshift({ joinedAt: Date.now(), ...entry });
  write(list);
}

export function updateJoinedProjectMeta(projectId: string, patch: Partial<JoinedProject>) {
  const list = ensure().map((p) => (p.projectId === projectId ? { ...p, ...patch, refreshedAt: Date.now() } : p));
  write(list);
}

export function removeJoinedProject(projectId: string) {
  write(ensure().filter((p) => p.projectId !== projectId));
}
