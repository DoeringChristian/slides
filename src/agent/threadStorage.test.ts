import { readFileSync } from 'node:fs';
import { parse } from 'opentype.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { usePresentationStore as store } from '../store/presentationStore';
import { useEditorStore } from '../store/editorStore';
import { createPresentation, createShapeElement } from '../utils/model/slideFactory';
import { useAgentStore, setProviderFactory, setThreadBackend, flushThreads, emptyThread } from './agentStore';
import { fromStored, type StoredDeck, type StoredThread, type ThreadBackend } from './threadStorage';
import type { AgentMessage, ModelProvider, ProviderResult } from './providers/types';

vi.mock('../utils/text/glyphPaths', async importOriginal => {
  const actual = await importOriginal<typeof import('../utils/text/glyphPaths')>();
  const bytes = readFileSync(new URL('../assets/fonts/Inter-Regular.ttf', import.meta.url));
  const font = parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  return { ...actual, loadFont: async () => font };
});

/** Behaves like IndexedDB: values are structured-cloned in and out. */
function memoryBackend(): ThreadBackend & { decks: Map<string, StoredDeck> } {
  const decks = new Map<string, StoredDeck>();
  return {
    decks,
    load: async id => (decks.has(id) ? structuredClone(decks.get(id)!) : null),
    save: async deck => { decks.set(deck.deckId, structuredClone(deck)); },
    remove: async id => { decks.delete(id); },
    prune: async () => {},
  };
}

const say = (text: string): ProviderResult => ({ message: { role: 'assistant', content: [{ type: 'text', text }], raw: { provider: 'fake', content: [{ secret: 'sig' }] } }, stopReason: 'end_turn' });
const idle = () => new Promise<void>(resolve => {
  const check = () => (!useAgentStore.getState().running ? resolve() : setTimeout(check, 5));
  check();
});

/** What a page reload does to the assistant: in-memory state is gone, the
 *  stored conversations are read back when the deck opens. */
async function reload(backend: ThreadBackend) {
  useAgentStore.setState({ thread: emptyThread(), deckId: null, queue: [], running: false });
  setThreadBackend(backend);
  await flushThreads();
}

let sid = '';
beforeEach(() => {
  const p = createPresentation();
  sid = p.slideOrder[0];
  p.slides[sid].elements = { box: createShapeElement('rect', { id: 'box' }) };
  p.slides[sid].elementOrder = ['box'];
  store.setState({ presentation: p });
  useEditorStore.setState({ activeSlideId: sid, selectedElementIds: [], selectedSlideIds: [] });
});

describe('conversations survive a reload', () => {
  it('restores items and transcript, and the next request continues the conversation', async () => {
    const backend = memoryBackend();
    await reload(backend);
    const seen: AgentMessage[][] = [];
    const provider: ModelProvider = {
      id: 'fake',
      async stream({ messages, onText }) {
        seen.push(structuredClone(messages));
        onText(`answer ${seen.length}`);
        return say(`answer ${seen.length}`);
      },
    };
    setProviderFactory(async () => provider);
    useAgentStore.getState().send('first question');
    await idle();
    await flushThreads();

    await reload(backend);
    const thread = useAgentStore.getState().thread;
    expect(thread.items.map(i => i.kind)).toEqual(['user', 'assistant']);
    expect(thread.items[1]).toMatchObject({ text: 'answer 1' });

    useAgentStore.getState().send('second question');
    await idle();
    // The model sees the whole conversation, including provider-private
    // content (e.g. thinking signatures) restored verbatim.
    expect(seen[1].map(m => m.role)).toEqual(['user', 'assistant', 'user']);
    expect(JSON.stringify(seen[1])).toContain('first question');
    expect(seen[1][1]).toMatchObject({ raw: { provider: 'fake', content: [{ secret: 'sig' }] } });
  });

  it('does not overwrite stored conversations before they have loaded', async () => {
    const backend = memoryBackend();
    backend.decks.set(store.getState().presentation.id, {
      deckId: store.getState().presentation.id,
      updatedAt: 1,
      thread: { items: [{ kind: 'user', id: 'u', text: 'kept' }], transcript: [{ role: 'user', content: [{ type: 'text', text: 'kept' }] }], attachments: [] },
    });
    await reload(backend);
    expect(useAgentStore.getState().thread.items[0]).toMatchObject({ text: 'kept' });
    await flushThreads();
    expect(backend.decks.get(store.getState().presentation.id)!.thread.items[0]).toMatchObject({ text: 'kept' });
  });

  it('removes the stored copy when a conversation is cleared', async () => {
    const backend = memoryBackend();
    await reload(backend);
    setProviderFactory(async () => ({ id: 'fake', stream: async ({ onText }) => { onText('ok'); return say('ok'); } }));
    useAgentStore.getState().send('hello');
    await idle();
    await flushThreads();
    expect(backend.decks.size).toBe(1);
    useAgentStore.getState().clear();
    await flushThreads();
    expect(backend.decks.size).toBe(0);
  });
});

describe('repairing a turn the reload cut off', () => {
  it('answers unanswered tool calls and marks interrupted work', () => {
    const stored: StoredThread = {
      items: [
        { kind: 'user', id: 'u1', text: 'do it' },
        { kind: 'tool', id: 't1', name: 'update_elements', done: false },
        { kind: 'user', id: 'u2', text: 'and then this', queued: true },
      ],
      transcript: [
        { role: 'user', content: [{ type: 'text', text: 'do it' }] },
        { role: 'assistant', content: [{ type: 'tool_call', id: 't1', name: 'update_elements', input: {} }] },
      ],
      attachments: [{ id: 'a1', name: 'fig.png', kind: 'image', file: new Blob(['x']), block: { type: 'image', mediaType: 'image/png', data: 'AA' } }],
    };
    const thread = fromStored(stored, () => 'blob:preview');
    expect(thread.transcript.at(-1)).toEqual({
      role: 'user',
      content: [{ type: 'tool_result', id: 't1', content: [{ type: 'text', text: expect.stringContaining('reloaded') }], isError: true }],
    });
    expect(thread.items[1]).toMatchObject({ kind: 'tool', done: true, isError: true });
    expect(thread.items[2]).toMatchObject({ queued: false, notSent: true });
    expect(thread.items.at(-1)).toMatchObject({ kind: 'error' });
    expect(thread.attachments.get('a1')?.previewUrl).toBe('blob:preview');
    expect(thread.lastTurn).toBeNull();
  });
});
