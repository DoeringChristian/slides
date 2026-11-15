import { create } from 'zustand';
import { useEditorStore } from '../store/editorStore';
import { usePresentationStore } from '../store/presentationStore';
import { readPresentation } from './tools';
import { runAgentTurn } from './agentLoop';
import { beginTurnHistory, type TurnUndo } from './turnHistory';
import { useAgentSettings, relayServerUrl, hasCredentials } from './agentSettings';
import { describeAttachments, type ChatAttachment } from './attachments';
import { ProviderError, type AgentMessage, type ModelProvider, type UserMessage } from './providers/types';
import { createOpenAIProvider } from './providers/openai';
import type { SlideComment } from '../types/presentation';
import { defaultBackend, fromStored, toStored, type ThreadBackend } from './threadStorage';

/**
 * Chat state for the assistant: one conversation per project (deck).
 *
 * The conversation holds the model transcript (what the model remembers),
 * the chat items (what the panel shows), attachments and the undoable last
 * turn. Each message carries where the user is — current slide, selection —
 * so "this slide" resolves without splitting the conversation.
 *
 * One turn runs at a time (turns share the undo history); requests made
 * meanwhile — typed, or forwarded from comments — wait in a queue.
 *
 * The conversation is saved per deck in this browser (threadStorage.ts) and
 * restored when the deck opens again, so a reload loses nothing but the
 * running turn and "Undo turn".
 */

export type ChatItem =
  | { kind: 'user'; id: string; text: string; attachments?: Array<{ id: string; name: string; kind: 'image' | 'pdf'; previewUrl?: string }>; queued?: boolean; fromComment?: boolean; notSent?: boolean }
  | { kind: 'assistant'; id: string; text: string }
  | { kind: 'tool'; id: string; name: string; summary?: string; isError?: boolean; done: boolean }
  | { kind: 'error'; id: string; text: string };

export interface Thread {
  items: ChatItem[];
  transcript: AgentMessage[];
  attachments: Map<string, ChatAttachment>;
  lastTurn: TurnUndo | null;
}

interface Request {
  itemId: string;
  text: string;
  attachments: ChatAttachment[];
}

interface AgentState {
  /** The open deck's conversation. */
  thread: Thread;
  deckId: string | null;
  running: boolean;
  /** Slide the running turn last touched. */
  workingSlideId: string | null;
  queue: Request[];
  send: (text: string, attachments?: ChatAttachment[]) => void;
  /** Hand a just-posted comment to the assistant. */
  forwardComment: (slideId: string, comment: SlideComment) => void;
  stop: () => void;
  undoLastTurn: () => void;
  clear: () => void;
}

let controller: AbortController | null = null;
let seq = 0;
const nextId = () => `c${++seq}`;

export const emptyThread = (): Thread => ({ items: [], transcript: [], attachments: new Map(), lastTurn: null });

/** The configured provider. The Anthropic SDK loads on demand, so OpenAI
 *  users never download it. Replaceable for tests. */
let providerFactory: () => Promise<ModelProvider> = async () => {
  const s = useAgentSettings.getState();
  if (!hasCredentials(s)) throw new ProviderError('Set up the assistant first: open its settings (gear icon) and add a key or sign in.', { needsAuth: true });
  const effort = s.effort || undefined;
  if (s.provider === 'anthropic') {
    const { createAnthropicProvider } = await import('./providers/anthropic');
    return createAnthropicProvider({ apiKey: s.anthropicKey, model: s.models.anthropic, effort });
  }
  return s.provider === 'openai'
    ? createOpenAIProvider({ transport: { kind: 'apiKey', apiKey: s.openaiKey }, model: s.models.openai, effort })
    : createOpenAIProvider({ transport: { kind: 'chatgptRelay', serverUrl: relayServerUrl(s) }, model: s.models.chatgpt, effort });
};
export function setProviderFactory(factory: () => Promise<ModelProvider>) { providerFactory = factory; }

let backend: ThreadBackend = defaultBackend();
/** The deck whose stored conversation has been loaded; saving waits for it
 *  so an early empty state never overwrites what is on disk. */
let loadedDeckId: string | null = null;
let loading: Promise<void> | null = null;
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let pruned = false;
const SAVE_DELAY_MS = 400;
const KEEP_DECKS = 30;

/** Test seam: replace where conversations are stored. */
export function setThreadBackend(next: ThreadBackend) {
  backend = next;
  loadedDeckId = null;
  loading = null;
}

const previewUrlFor = (file: Blob) => (typeof URL.createObjectURL === 'function' ? URL.createObjectURL(file) : undefined);

/** Where the user is and what they have selected, so "this slide" and
 *  "these" resolve. Sent with each message rather than in the system
 *  prompt, which stays cacheable. */
function editorContext(): string {
  const { activeSlideId, selectedElementIds, selectedSlideIds } = useEditorStore.getState();
  const p = readPresentation();
  const lines = [`Editor context: the user is on slide ${p.slideOrder.indexOf(activeSlideId) + 1} (id ${activeSlideId}).`];
  if (selectedElementIds.length) lines.push(`Selected elements: ${selectedElementIds.join(', ')}.`);
  if (selectedSlideIds.length > 1) lines.push(`Selected slides: ${selectedSlideIds.map(id => p.slideOrder.indexOf(id) + 1).join(', ')}.`);
  return lines.join(' ');
}

export const useAgentStore = create<AgentState>((set, get) => {
  const patchThread = (patch: (t: Thread) => Partial<Thread>) => set(s => ({ thread: { ...s.thread, ...patch(s.thread) } }));
  const patchItem = (id: string, patch: (item: ChatItem) => ChatItem) =>
    patchThread(t => ({ items: t.items.map(item => (item.id === id ? patch(item) : item)) }));

  async function run(request: Request) {
    controller = new AbortController();
    const signal = controller.signal;
    patchItem(request.itemId, item => (item.kind === 'user' ? { ...item, queued: false } : item));
    patchThread(t => ({ lastTurn: null, attachments: new Map([...t.attachments, ...request.attachments.map(a => [a.id, a] as const)]) }));
    set({ running: true, workingSlideId: null });

    const thread = get().thread;
    const prompt: UserMessage['content'] = [
      { type: 'text', text: [editorContext(), describeAttachments(request.attachments), request.text].filter(Boolean).join('\n\n') },
      ...request.attachments.map(a => a.block),
    ];
    let assistantId: string | null = null;
    const finishHistory = beginTurnHistory();
    try {
      await runAgentTurn({
        provider: await providerFactory(),
        messages: thread.transcript,
        prompt,
        signal,
        toolContext: {
          attachments: thread.attachments,
          onSlide: (touched) => {
            set({ workingSlideId: touched });
            if (useAgentSettings.getState().follow && useEditorStore.getState().activeSlideId !== touched) {
              useEditorStore.getState().setActiveSlide(touched);
            }
          },
        },
        onEvent: (event) => {
          if (event.type === 'text') {
            if (!assistantId) {
              assistantId = nextId();
              const id = assistantId;
              patchThread(t => ({ items: [...t.items, { kind: 'assistant', id, text: event.delta }] }));
            } else {
              patchItem(assistantId, item => (item.kind === 'assistant' ? { ...item, text: item.text + event.delta } : item));
            }
          } else if (event.type === 'assistant_done') {
            assistantId = null;
          } else if (event.type === 'tool_start') {
            patchThread(t => ({ items: [...t.items, { kind: 'tool', id: event.id, name: event.name, done: false }] }));
          } else if (event.type === 'tool_end') {
            patchItem(event.id, item => (item.kind === 'tool' ? { ...item, summary: event.summary, isError: event.isError, done: true } : item));
          }
        },
      });
    } catch (err) {
      if (!signal.aborted) {
        const text = err instanceof Error ? err.message : String(err);
        patchThread(t => ({ items: [...t.items, { kind: 'error', id: nextId(), text }] }));
      }
    } finally {
      const lastTurn = finishHistory();
      controller = null;
      patchThread(t => ({
        lastTurn,
        items: signal.aborted ? [...t.items, { kind: 'error', id: nextId(), text: 'Stopped.' }] : t.items,
      }));
      set({ running: false, workingSlideId: null });
      void saveNow();
      const [next, ...rest] = get().queue;
      if (next) {
        set({ queue: rest });
        void run(next);
      }
    }
  }

  function enqueue(text: string, attachments: ChatAttachment[], fromComment: boolean) {
    void ensureDeck();
    const itemId = nextId();
    const busy = get().running;
    patchThread(t => ({
      items: [...t.items, {
        kind: 'user', id: itemId, text, queued: busy, fromComment,
        attachments: attachments.map(a => ({ id: a.id, name: a.name, kind: a.kind, previewUrl: a.previewUrl })),
      }],
    }));
    const request = { itemId, text, attachments };
    if (busy) set(s => ({ queue: [...s.queue, request] }));
    else void run(request);
  }

  return {
    thread: emptyThread(),
    deckId: null,
    running: false,
    workingSlideId: null,
    queue: [],

    send: (text, attachments = []) => {
      if (!text.trim() && !attachments.length) return;
      enqueue(text.trim(), attachments, false);
    },

    forwardComment: (slideId, comment) => {
      const p = readPresentation();
      const element = comment.elementId ? p.slides[slideId]?.elements[comment.elementId] : undefined;
      const name = comment.elementId ? p.objects[comment.elementId]?.name : undefined;
      const where = `slide ${p.slideOrder.indexOf(slideId) + 1} (id ${slideId})`;
      const about = element ? `on element ${comment.elementId}${name ? ` ("${name}")` : ''} of ${where}` : `on ${where}`;
      const text = `${comment.author.name} left a comment ${about}: ${comment.text}\n\n(Comment id ${comment.id}. Do what it asks, then answer it with reply_to_comment and resolve it if done.)`;
      useAgentSettings.getState().update({ panelOpen: true });
      enqueue(text, [], true);
    },

    stop: () => {
      set({ queue: [] });
      controller?.abort();
    },

    undoLastTurn: () => {
      const turn = get().thread.lastTurn;
      if (turn?.canUndo()) turn.undo();
      patchThread(() => ({ lastTurn: null }));
    },

    clear: () => {
      if (get().running) return;
      get().thread.attachments.forEach(a => { if (a.previewUrl) URL.revokeObjectURL(a.previewUrl); });
      set({ thread: emptyThread(), queue: [] });
    },
  };
});

// ── Persistence ────────────────────────────────────────────────────────────

/** Switch to the open deck's stored conversation. Anything typed before the
 *  load lands is kept, after the restored history. */
function ensureDeck(): Promise<void> {
  const deckId = usePresentationStore.getState().presentation.id;
  if (useAgentStore.getState().deckId === deckId && loading) return loading;
  // Write the previous deck's pending changes before its conversation goes
  // away (saveNow reads the state synchronously, before its first await).
  if (saveTimer) void saveNow();
  useAgentStore.setState({ thread: emptyThread(), deckId, queue: [] });
  loadedDeckId = null;
  const current = backend;
  loading = current.load(deckId)
    .then(stored => {
      if (current !== backend || useAgentStore.getState().deckId !== deckId || !stored?.thread) return;
      const restored = fromStored(stored.thread, previewUrlFor);
      useAgentStore.setState(s => ({
        thread: s.thread.items.length || s.thread.transcript.length
          ? {
            ...s.thread,
            items: [...restored.items, ...s.thread.items],
            transcript: [...restored.transcript, ...s.thread.transcript],
            attachments: new Map([...restored.attachments, ...s.thread.attachments]),
          }
          : restored,
      }));
    })
    .catch(err => console.warn('[agent] could not restore the conversation', err))
    .finally(() => {
      if (useAgentStore.getState().deckId === deckId) loadedDeckId = deckId;
    });
  return loading;
}

async function saveNow(): Promise<void> {
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
  const { deckId, thread } = useAgentStore.getState();
  if (!deckId || loadedDeckId !== deckId) return;
  try {
    if (thread.items.length || thread.transcript.length) await backend.save({ deckId, updatedAt: Date.now(), thread: toStored(thread) });
    else await backend.remove(deckId);
    if (!pruned) { pruned = true; await backend.prune(KEEP_DECKS); }
  } catch (err) {
    console.warn('[agent] could not save the conversation', err);
  }
}

/** Test seam: wait for the open deck's conversation to load and save. */
export async function flushThreads(): Promise<void> {
  await ensureDeck();
  await saveNow();
}

useAgentStore.subscribe((next, prev) => {
  if (next.thread === prev.thread || next.deckId !== prev.deckId) return;
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { void saveNow(); }, SAVE_DELAY_MS);
});

// Restore a deck's conversation as soon as it opens, so the panel shows it
// before anyone types.
void ensureDeck();
usePresentationStore.subscribe((next, prev) => {
  if (next.presentation.id !== prev.presentation.id) void ensureDeck();
});
