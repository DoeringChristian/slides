// The local media cache: IndexedDB, keyed by content hash. Browsers keep
// IndexedDB blobs on disk, not in memory, so caching a deck's videos costs
// disk, not RAM. Where IndexedDB is unavailable (tests, some private modes)
// it degrades to memory for the session.

export interface LocalCache {
  get(hash: string): Promise<Blob | null>;
  has(hash: string): Promise<boolean>;
  put(hash: string, blob: Blob): Promise<void>;
  /** Uploads not yet confirmed by `backendId`. */
  pending(backendId: string): Promise<string[]>;
  markPending(hash: string, backendId: string): Promise<void>;
  clearPending(hash: string, backendId: string): Promise<void>;
}

const DB_NAME = 'slides-media';
const BLOBS = 'blobs';
const PENDING = 'pending';

export function createLocalCache({ memoryOnly = false } = {}): LocalCache {
  const blobs = new Map<string, Blob>();
  const pending = new Set<string>();
  const key = (hash: string, backendId: string) => `${backendId}|${hash}`;
  const memoryCache: LocalCache = {
    async get(hash) { return blobs.get(hash) ?? null; },
    async has(hash) { return blobs.has(hash); },
    async put(hash, blob) { blobs.set(hash, blob); },
    async pending(backendId) { return [...pending].filter(k => k.startsWith(`${backendId}|`)).map(k => k.slice(backendId.length + 1)); },
    async markPending(hash, backendId) { pending.add(key(hash, backendId)); },
    async clearPending(hash, backendId) { pending.delete(key(hash, backendId)); },
  };
  if (memoryOnly || typeof indexedDB === 'undefined') return memoryCache;

  let db: Promise<IDBDatabase> | null = null;
  const open = () => db ??= new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(BLOBS);
      req.result.createObjectStore(PENDING);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  // Ask the browser not to evict the cache under storage pressure: for local
  // decks it is the only copy of their media.
  try { void navigator.storage?.persist?.(); } catch { /* not offered */ }

  async function run<T>(store: string, mode: IDBTransactionMode, op: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    const d = await open();
    return new Promise<T>((resolve, reject) => {
      const tx = d.transaction(store, mode);
      const req = op(tx.objectStore(store));
      tx.oncomplete = () => resolve(req.result);
      tx.onerror = () => reject(tx.error ?? req.error);
      tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
    });
  }
  // A failing IndexedDB (quota, a broken profile) must not lose media this
  // session: fall back to memory for that call.
  const safe = <A extends unknown[], T>(f: (...a: A) => Promise<T>, fallback: (...a: A) => Promise<T>) =>
    async (...a: A) => { try { return await f(...a); } catch (err) { console.warn('[media] local cache:', err); return fallback(...a); } };

  return {
    get: safe(async (hash) => blobs.get(hash) ?? (await run<Blob | undefined>(BLOBS, 'readonly', s => s.get(hash))) ?? null, memoryCache.get),
    has: safe(async (hash) => blobs.has(hash) || (await run<number>(BLOBS, 'readonly', s => s.count(hash))) > 0, memoryCache.has),
    put: safe(async (hash, blob) => { await run(BLOBS, 'readwrite', s => s.put(blob, hash)); }, memoryCache.put),
    pending: safe(async (backendId) => {
      const keys = await run<IDBValidKey[]>(PENDING, 'readonly', s => s.getAllKeys());
      return keys.map(String).filter(k => k.startsWith(`${backendId}|`)).map(k => k.slice(backendId.length + 1));
    }, memoryCache.pending),
    markPending: safe(async (hash, backendId) => { await run(PENDING, 'readwrite', s => s.put(1, key(hash, backendId))); }, memoryCache.markPending),
    clearPending: safe(async (hash, backendId) => { await run(PENDING, 'readwrite', s => s.delete(key(hash, backendId))); }, memoryCache.clearPending),
  };
}
