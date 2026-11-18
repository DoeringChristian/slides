// Media as files: a deck references each image and video by the SHA-256 of
// its bytes (`Resource.hash`), and the bytes live here — never inside the
// deck, its Y.Doc or any JSON. That keeps decks small however large their
// videos are, and lets a video stream and seek instead of loading whole.
//
// Three layers, looked up in order:
//   1. memory — blobs of this session (just added, just fetched);
//   2. the local cache — IndexedDB, persistent, shared by every window of
//      this origin (the audience window reads what the presenter cached);
//   3. the backend — where the deck's media is kept for good: the server
//      (HTTP, streamable), or the filesystem vault's media folder. Local
//      decks have none: the local cache IS their store.
//
// Presenting never depends on layer 3: `ensureMedia` copies everything into
// the local cache first, and playback reads only from there.

import type { Presentation, Resource } from '../types/presentation';
import { createLocalCache, type LocalCache } from './localCache';

export interface MediaBackend {
  /** Stable id: a store change re-resolves sources. */
  readonly id: string;
  upload(hash: string, blob: Blob, onProgress?: (loaded: number, total: number) => void): Promise<void>;
  download(hash: string): Promise<Blob | null>;
  /** Whether the backend already keeps this file. */
  has(hash: string): Promise<boolean>;
  /** A URL the browser can stream from (HTTP Range), without downloading
   *  first. Absent where the media is not served over HTTP. */
  streamUrl?(hash: string): string;
}

export type MediaStatus = 'ready' | 'streaming' | 'loading' | 'uploading' | 'missing';

export interface MediaInfo { hash: string; mime: string; size: number }

const memory = new Map<string, Blob>();
const objectUrls = new Map<string, string>();
const fetches = new Map<string, Promise<Blob | null>>();
const uploads = new Map<string, { loaded: number; total: number; done: Promise<void> }>();
// Files not found anywhere yet (a collaborator may still be uploading one):
// retried with backoff, never in a loop.
const failed = new Map<string, { tries: number; retryAt: number }>();
const listeners = new Set<() => void>();
let backend: MediaBackend | null = null;
let cache: LocalCache = createLocalCache();
let version = 0;

function changed() {
  version++;
  for (const l of listeners) l();
}

/** Subscribe to any change of media state (for useSyncExternalStore). */
export function subscribeMedia(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
export const mediaVersion = () => version;

/** Where the open deck keeps its media; null for local decks. */
export function setMediaBackend(next: MediaBackend | null): void {
  if (backend?.id === next?.id) return;
  backend = next;
  failed.clear();
  changed();
  void retryPendingUploads();
}
export const getMediaBackend = () => backend;

/** Tests: an in-memory cache instead of IndexedDB, everything forgotten. */
export function resetMediaStoreForTests(local: LocalCache = createLocalCache({ memoryOnly: true })): void {
  for (const url of objectUrls.values()) { try { URL.revokeObjectURL(url); } catch { /* not a browser */ } }
  memory.clear(); objectUrls.clear(); fetches.clear(); uploads.clear(); failed.clear();
  backend = null; cache = local; changed();
}

export async function hashBlob(blob: Blob): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Keep a new media file: it is in memory and the local cache at once (so
 * it renders immediately), and uploads to the backend in the background —
 * retried on the next start if the page closes first.
 */
export async function addMedia(blob: Blob, mime = blob.type || 'application/octet-stream', { upload = true } = {}): Promise<MediaInfo> {
  const hash = await hashBlob(blob);
  const typed = blob.type === mime ? blob : new Blob([blob], { type: mime });
  memory.set(hash, typed);
  failed.delete(hash);
  await cache.put(hash, typed);
  // An import keeps its files here only: the deck is not open yet, and the
  // open deck's backend is not where they belong. Opening it publishes them.
  if (backend && upload) startUpload(hash, typed, backend);
  changed();
  return { hash, mime, size: blob.size };
}

/** Media that came with the page (a standalone HTML export): memory only. */
export function registerMedia(hash: string, blob: Blob): void {
  memory.set(hash, blob);
  failed.delete(hash);
  changed();
}

function startUpload(hash: string, blob: Blob, target: MediaBackend) {
  if (uploads.has(hash)) return;
  const entry = { loaded: 0, total: blob.size, done: Promise.resolve() };
  void cache.markPending(hash, target.id);
  entry.done = (async () => {
    for (let attempt = 0; ; attempt++) {
      try {
        await target.upload(hash, blob, (loaded, total) => { entry.loaded = loaded; entry.total = total; changed(); });
        await cache.clearPending(hash, target.id);
        return;
      } catch (err) {
        if (backend !== target) return; // the deck changed; retried when it is opened again
        console.warn(`[media] upload of ${hash.slice(0, 12)} failed (attempt ${attempt + 1}):`, err);
        await new Promise(r => setTimeout(r, Math.min(30_000, 1000 * 2 ** attempt)));
      }
    }
  })().finally(() => { uploads.delete(hash); changed(); });
  uploads.set(hash, entry);
  changed();
}

/** Uploads a closed page left unfinished, for the open deck's backend. */
async function retryPendingUploads() {
  const target = backend;
  if (!target) return;
  for (const hash of await cache.pending(target.id)) {
    const blob = memory.get(hash) ?? await cache.get(hash);
    if (blob && backend === target) startUpload(hash, blob, target);
  }
}

/**
 * Make sure the backend keeps every media file of a deck this machine has:
 * a deck imported or made before it had a backend (or whose upload was cut
 * short) gets its files uploaded when it is opened.
 */
export async function publishDeckMedia(presentation: Pick<Presentation, 'resources'>): Promise<void> {
  const target = backend;
  if (!target) return;
  for (const r of deckMedia(presentation)) {
    if (backend !== target) return;
    if (uploads.has(r.hash)) continue;
    const blob = memory.get(r.hash) ?? await cache.get(r.hash);
    if (!blob) continue;
    if (!(await target.has(r.hash).catch(() => true))) startUpload(r.hash, blob, target);
  }
}

/** Upload progress of media this window is uploading, or null. */
export function uploadProgress(hash: string): { loaded: number; total: number } | null {
  const u = uploads.get(hash);
  return u ? { loaded: u.loaded, total: u.total } : null;
}

/** Wait until every upload this window started has finished. */
export async function flushUploads(): Promise<void> {
  await Promise.all([...uploads.values()].map(u => u.done));
}

/** The bytes of a media file, from wherever they are; null if nowhere.
 *  A file not found recently is not asked for again until its retry time,
 *  unless `force` (an explicit request: presenting, exporting). */
export function getMediaBlob(hash: string, { force = false } = {}): Promise<Blob | null> {
  const inMemory = memory.get(hash);
  if (inMemory) return Promise.resolve(inMemory);
  let job = fetches.get(hash);
  const miss = failed.get(hash);
  if (!job && miss && !force && Date.now() < miss.retryAt) return Promise.resolve(null);
  if (!job) {
    job = (async () => {
      const cached = await cache.get(hash);
      if (cached) { memory.set(hash, cached); return cached; }
      const source = backend;
      const fetched = source ? await source.download(hash).catch(() => null) : null;
      if (fetched) {
        memory.set(hash, fetched);
        await cache.put(hash, fetched);
        return fetched;
      }
      return null;
    })();
    fetches.set(hash, job);
    void job.then(blob => {
      fetches.delete(hash);
      if (blob) failed.delete(hash);
      else {
        const tries = (failed.get(hash)?.tries ?? 0) + 1;
        const delay = Math.min(60_000, 1000 * 2 ** tries);
        failed.set(hash, { tries, retryAt: Date.now() + delay });
        // Let renderers ask again then.
        setTimeout(changed, delay + 10);
      }
      changed();
    });
  }
  return job;
}

/** Whether the bytes are on this machine (memory or local cache). */
export async function isMediaLocal(hash: string): Promise<boolean> {
  return memory.has(hash) || await cache.has(hash);
}

/** One blob URL per media file (every element showing it shares it). */
export async function mediaObjectUrl(hash: string, options: { force?: boolean } = {}): Promise<string | null> {
  const existing = objectUrls.get(hash);
  if (existing) return existing;
  const blob = await getMediaBlob(hash, options);
  if (!blob) return null;
  const again = objectUrls.get(hash);
  if (again) return again;
  const url = URL.createObjectURL(blob);
  objectUrls.set(hash, url);
  changed();
  return url;
}

/**
 * Where to show a media file from right now, without waiting:
 * a blob URL once it is here; else, from a streaming backend, its HTTP URL
 * (a video starts after its first megabytes and seeks by range) while the
 * file is copied here in the background; else nothing yet.
 */
export function mediaSource(hash: string): { url: string | null; status: MediaStatus } {
  const local = objectUrls.get(hash);
  if (local) return { url: local, status: uploads.has(hash) ? 'uploading' : 'ready' };
  const inMemory = memory.get(hash);
  if (inMemory) {
    // Here already: its URL at once, so a just-added file never flashes empty.
    const url = URL.createObjectURL(inMemory);
    objectUrls.set(hash, url);
    return { url, status: uploads.has(hash) ? 'uploading' : 'ready' };
  }
  void mediaObjectUrl(hash);
  // Stream from the server meanwhile — unless it did not have the file.
  const stream = failed.has(hash) ? undefined : backend?.streamUrl?.(hash);
  if (stream) return { url: stream, status: 'streaming' };
  return { url: null, status: failed.has(hash) ? 'missing' : 'loading' };
}

/** The media a deck uses (resources and image backgrounds). */
export function deckMedia(presentation: Pick<Presentation, 'resources'>): Resource[] {
  return Object.values(presentation.resources ?? {}).filter(r => r && typeof r.hash === 'string');
}

export interface MediaReadiness { ready: number; total: number; missing: Resource[] }

/**
 * Copy every media file of a deck to this machine, so that presenting it
 * needs neither the server nor the network. Resolves with what is ready
 * and what could not be found anywhere.
 */
export async function ensureMedia(
  presentation: Pick<Presentation, 'resources'>,
  onProgress?: (r: MediaReadiness) => void,
): Promise<MediaReadiness> {
  const all = deckMedia(presentation);
  const state: MediaReadiness = { ready: 0, total: all.length, missing: [] };
  const queue = [...all];
  const worker = async () => {
    for (let r = queue.shift(); r; r = queue.shift()) {
      const url = await mediaObjectUrl(r.hash, { force: true });
      if (url) state.ready++; else state.missing.push(r);
      onProgress?.({ ...state, missing: [...state.missing] });
    }
  };
  await Promise.all(Array.from({ length: 4 }, worker));
  return state;
}

/** A media file as a data URL — only for formats that need one (a
 *  single-file HTML export, an SVG rasterised into a canvas). */
export async function mediaDataUrl(resource: Pick<Resource, 'hash' | 'mime'>): Promise<string | null> {
  const blob = await getMediaBlob(resource.hash, { force: true });
  if (!blob) return null;
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:${resource.mime};base64,${btoa(binary)}`;
}

/** Decode a data URL into a blob (importing decks that embed media). */
export function dataUrlToBlob(dataUrl: string): Blob {
  const comma = dataUrl.indexOf(',');
  const header = dataUrl.slice(5, comma);
  const mime = header.split(';')[0] || 'application/octet-stream';
  const body = dataUrl.slice(comma + 1);
  if (header.endsWith(';base64')) {
    const binary = atob(body);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new Blob([bytes], { type: mime });
  }
  return new Blob([decodeURIComponent(body)], { type: mime });
}

// ---------------------------------------------------------------------------
// The open deck's readiness: every media file copied to this machine, so that
// presenting never waits on the network. Tracked in the background while a
// deck is open; the presenter shows it and waits for it.
// ---------------------------------------------------------------------------

export interface DeckReadiness extends MediaReadiness { checking: boolean }
let readiness: DeckReadiness = { ready: 0, total: 0, missing: [], checking: false };
let readinessRun = 0;
let readinessKey = '';

export const getDeckReadiness = () => readiness;

/** Copy every media file of the open deck here (again when its media
 *  changes). Missing files are retried while the deck stays open. */
export function trackDeckMedia(presentation: Pick<Presentation, 'resources'>): void {
  const media = deckMedia(presentation);
  const key = media.map(r => r.hash).sort().join(',');
  if (key === readinessKey && !readiness.missing.length) return;
  readinessKey = key;
  const run = ++readinessRun;
  readiness = { ...readiness, total: media.length, checking: true };
  changed();
  void ensureMedia(presentation, (r) => {
    if (run !== readinessRun) return;
    readiness = { ...r, checking: true };
    changed();
  }).then((r) => {
    if (run !== readinessRun) return;
    readiness = { ...r, checking: false };
    changed();
    // A collaborator may still be uploading: look again in a while.
    if (r.missing.length) setTimeout(() => { if (run === readinessRun) { readinessKey = ''; trackDeckMedia(presentation); } }, 10_000);
  });
}
