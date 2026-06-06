import { useSyncExternalStore } from 'react';
import { nanoid } from 'nanoid';

// Anonymous, Excalidraw-style identity. Each browser is its own user; nothing
// is sent to GitHub or any other identity provider. The userId is generated
// once and persisted to localStorage. The display name defaults to
// "Editor <three chars of id>" and is editable. Color is deterministic from
// the userId so the same user always shows up in the same shade.
//
// This identity feeds awareness during collaboration (showing peers their
// names + colors) but is otherwise unused — it does not authorize access to
// projects. Project sharing happens through capability URLs (the project id
// is the secret).

export interface Identity {
  /** Stable per-browser. Used for awareness presence keys. */
  userId: string;
  name: string;
  color: string;
}

const STORAGE_KEY = 'slides.identity';

// Palette of WCAG-AA accessible accent colors against the editor's mostly
// white / mid-gray background.
const PALETTE = [
  '#dc2626', '#ea580c', '#ca8a04', '#16a34a',
  '#059669', '#0891b2', '#2563eb', '#4f46e5',
  '#7c3aed', '#9333ea', '#c026d3', '#db2777',
];

function pickColor(seed: string): string {
  let h = 5381;
  for (let i = 0; i < seed.length; i++) {
    h = ((h << 5) + h + seed.charCodeAt(i)) >>> 0;
  }
  return PALETTE[h % PALETTE.length];
}

function freshIdentity(): Identity {
  const userId = nanoid(10);
  return {
    userId,
    name: `Editor ${userId.slice(-3).toUpperCase()}`,
    color: pickColor(userId),
  };
}

// Module-level cache so useSyncExternalStore's getSnapshot is referentially
// stable until an explicit mutation. Without this, React would tear.
let cached: Identity | null = null;
const listeners = new Set<() => void>();

function readFromStorage(): Identity | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Identity;
    // Defensive — refresh color in case the palette changes between versions.
    return { ...parsed, color: pickColor(parsed.userId) };
  } catch {
    return null;
  }
}

function writeToStorage(id: Identity) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(id));
  } catch {
    // localStorage disabled — degrade gracefully; identity won't persist
    // across reloads but the rest of the app still works.
  }
}

function ensureIdentity(): Identity {
  if (cached) return cached;
  cached = readFromStorage() ?? freshIdentity();
  writeToStorage(cached);
  return cached;
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function getSnapshot(): Identity {
  return ensureIdentity();
}

export function useIdentity(): Identity {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/** Update the display name. No-ops if `name` is empty after trimming. */
export function setDisplayName(name: string) {
  const trimmed = name.trim();
  if (!trimmed) return;
  cached = { ...ensureIdentity(), name: trimmed };
  writeToStorage(cached);
  listeners.forEach((cb) => cb());
}

/** Replace the current identity with a fresh one. Useful for "log out". */
export function resetIdentity(): Identity {
  cached = freshIdentity();
  writeToStorage(cached);
  listeners.forEach((cb) => cb());
  return cached;
}
