import type { ChatAttachment } from './attachments';
import type { AgentMessage } from './providers/types';
import type { ChatItem, Thread } from './agentStore';

/**
 * Assistant conversations survive a reload.
 *
 * Each deck's conversation is saved in this browser's IndexedDB
 * (not localStorage: transcripts carry images and PDFs, and IndexedDB stores
 * the attachment files as Blobs). They are the user's own, like their model
 * key: never written into the deck or sent to the slides server, so
 * collaborators do not see them.
 *
 * What a reload cannot restore is "Undo turn" — the editor's undo history
 * does not survive a reload either — and a turn that was running. Such a turn
 * is repaired on load so the conversation stays valid for the next request.
 */

export interface StoredThread {
  items: ChatItem[];
  transcript: AgentMessage[];
  attachments: Array<Omit<ChatAttachment, 'previewUrl'>>;
}

export interface StoredDeck {
  deckId: string;
  updatedAt: number;
  thread: StoredThread;
}

/** Where conversations are kept. IndexedDB in the app; swappable in tests. */
export interface ThreadBackend {
  load(deckId: string): Promise<StoredDeck | null>;
  save(deck: StoredDeck): Promise<void>;
  remove(deckId: string): Promise<void>;
  /** Drop all but the `keep` most recently used decks. */
  prune(keep: number): Promise<void>;
}

const INTERRUPTED = 'Interrupted: the page was reloaded before this finished.';

/** Thread → storable record. Object URLs are per page, so they are dropped. */
export function toStored(thread: Thread): StoredThread {
  return {
    items: thread.items.map(item => (item.kind === 'user' && item.attachments
      ? { ...item, attachments: item.attachments.map(({ previewUrl: _url, ...rest }) => rest) }
      : item)),
    transcript: thread.transcript,
    attachments: [...thread.attachments.values()].map(({ previewUrl: _url, ...rest }) => rest),
  };
}

/**
 * Stored record → live thread, repairing whatever a reload cut short:
 * - an assistant message whose tool calls never got results gets an
 *   "interrupted" result for each, so the transcript is valid to send;
 * - running tool rows end as interrupted, queued messages as not sent.
 */
export function fromStored(stored: StoredThread, previewUrl: (file: Blob) => string | undefined): Thread {
  const transcript = structuredClone(stored.transcript);
  const last = transcript[transcript.length - 1];
  if (last?.role === 'assistant') {
    const calls = last.content.filter(block => block.type === 'tool_call');
    if (calls.length) {
      transcript.push({
        role: 'user',
        content: calls.map(call => ({ type: 'tool_result', id: call.id, content: [{ type: 'text', text: INTERRUPTED }], isError: true })),
      });
    }
  }
  const attachments = new Map<string, ChatAttachment>(stored.attachments.map(a => [
    a.id,
    { ...a, previewUrl: a.kind === 'image' ? previewUrl(a.file) : undefined },
  ]));
  let cutShort = false;
  const items: ChatItem[] = stored.items.map(item => {
    if (item.kind === 'tool' && !item.done) {
      cutShort = true;
      return { ...item, done: true, isError: true, summary: `${item.summary ?? item.name.replace(/_/g, ' ')} — interrupted` };
    }
    if (item.kind === 'user') {
      const restored = item.attachments?.map(a => ({ ...a, previewUrl: attachments.get(a.id)?.previewUrl }));
      if (item.queued) {
        cutShort = true;
        return { ...item, queued: false, attachments: restored, notSent: true };
      }
      return restored ? { ...item, attachments: restored } : item;
    }
    return item;
  });
  if (cutShort) items.push({ kind: 'error', id: `restored-${items.length}`, text: INTERRUPTED });
  return { items, transcript, attachments, lastTurn: null };
}

// ── IndexedDB ──────────────────────────────────────────────────────────────

const DB_NAME = 'slides-assistant-v2';
const STORE = 'decks';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const store = request.result.createObjectStore(STORE, { keyPath: 'deckId' });
      store.createIndex('updatedAt', 'updatedAt');
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function run<T>(mode: IDBTransactionMode, body: (store: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> {
  return openDb().then(db => new Promise<T | undefined>((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const request = body(tx.objectStore(STORE));
    tx.oncomplete = () => { db.close(); resolve(request ? request.result : undefined); };
    tx.onerror = () => { db.close(); reject(tx.error); };
    tx.onabort = () => { db.close(); reject(tx.error); };
  }));
}

export const indexedDbBackend: ThreadBackend = {
  load: async (deckId) => (await run<StoredDeck>('readonly', store => store.get(deckId))) ?? null,
  save: async (deck) => { await run('readwrite', store => { store.put(deck); }); },
  remove: async (deckId) => { await run('readwrite', store => { store.delete(deckId); }); },
  prune: async (keep) => {
    await run('readwrite', store => {
      const keys: IDBValidKey[] = [];
      const cursor = store.index('updatedAt').openKeyCursor(null, 'prev');
      cursor.onsuccess = () => {
        const c = cursor.result;
        if (!c) {
          for (const key of keys.slice(keep)) store.delete(key);
          return;
        }
        keys.push(c.primaryKey);
        c.continue();
      };
    });
  },
};

/** A backend that keeps nothing, for environments without IndexedDB. */
export const noopBackend: ThreadBackend = {
  load: async () => null,
  save: async () => {},
  remove: async () => {},
  prune: async () => {},
};

export function defaultBackend(): ThreadBackend {
  return typeof indexedDB === 'undefined' ? noopBackend : indexedDbBackend;
}
