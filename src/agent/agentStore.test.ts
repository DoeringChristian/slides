import { readFileSync } from 'node:fs';
import { parse } from 'opentype.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { usePresentationStore as store } from '../store/presentationStore';
import { useEditorStore } from '../store/editorStore';
import { createPresentation, createShapeElement, copySlideAsKeyframe } from '../utils/model/slideFactory';
import { useAgentStore, setProviderFactory, emptyThread } from './agentStore';
import { useAgentSettings } from './agentSettings';
import { runTool } from './tools';
import type { AgentMessage, ModelProvider, ProviderResult } from './providers/types';
import type { ChatAttachment } from './attachments';

vi.mock('../utils/text/glyphPaths', async importOriginal => {
  const actual = await importOriginal<typeof import('../utils/text/glyphPaths')>();
  const bytes = readFileSync(new URL('../assets/fonts/Inter-Regular.ttf', import.meta.url));
  const font = parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  return { ...actual, loadFont: async () => font };
});

// loadImageFile needs a DOM image decoder; the placement logic is what is
// under test.
vi.mock('../utils/model/slideFactory', async importOriginal => {
  const actual = await importOriginal<typeof import('../utils/model/slideFactory')>();
  return {
    ...actual,
    loadImageFile: async (file: Blob) => {
      const resource = actual.createResource('fig.png', 'data:image/png;base64,AA', 400, 200, 'image', undefined, `h${file.size}`);
      return { resource, element: actual.createImageElement(resource.id, 400, 200), isExisting: false };
    },
  };
});

/** Each call answers with the next scripted result; records every request. */
function scripted(make: (messages: AgentMessage[]) => ProviderResult) {
  const seen: AgentMessage[][] = [];
  let gate: Promise<void> = Promise.resolve();
  const provider: ModelProvider = {
    id: 'fake',
    async stream({ messages, onText }) {
      await gate;
      seen.push(structuredClone(messages));
      const result = make(messages);
      for (const b of result.message.content) if (b.type === 'text') onText(b.text);
      return result;
    },
  };
  return { provider, seen, hold: (p: Promise<void>) => { gate = p; } };
}
const say = (text: string): ProviderResult => ({ message: { role: 'assistant', content: [{ type: 'text', text }] }, stopReason: 'end_turn' });
const idle = () => new Promise<void>(resolve => {
  const check = () => (!useAgentStore.getState().running && !useAgentStore.getState().queue.length ? resolve() : setTimeout(check, 5));
  check();
});

let s1 = '', s2 = '';
beforeEach(() => {
  const p = createPresentation();
  s1 = p.slideOrder[0];
  p.slides[s1].elements = { box: createShapeElement('rect', { id: 'box' }) };
  p.slides[s1].elementOrder = ['box'];
  const second = copySlideAsKeyframe(p.slides[s1]);
  s2 = second.id;
  p.slides[s2] = second;
  p.slideOrder.push(s2);
  store.setState({ presentation: p });
  useEditorStore.setState({ activeSlideId: s1, selectedElementIds: [], selectedSlideIds: [] });
  useAgentStore.setState({ thread: emptyThread(), running: false, queue: [] });
  useAgentSettings.setState({ follow: true });
});

describe('one conversation per project', () => {
  it('keeps one conversation across slides, telling the model where the user is', async () => {
    const fake = scripted(() => say('ok'));
    setProviderFactory(async () => fake.provider);
    useAgentStore.getState().send('about slide one');
    await idle();
    useEditorStore.getState().setActiveSlide(s2);
    useAgentStore.getState().send('now this one');
    await idle();

    const second = fake.seen[1];
    // The second request continues the same conversation.
    expect(second.map(m => m.role)).toEqual(['user', 'assistant', 'user']);
    expect(JSON.stringify(second)).toContain('about slide one');
    expect(JSON.stringify(second[2])).toContain(`the user is on slide 2 (id ${s2})`);
    expect(useAgentStore.getState().thread.items.map(i => i.kind)).toEqual(['user', 'assistant', 'user', 'assistant']);
  });

  it('queues a request made while a turn runs', async () => {
    let release!: () => void;
    const fake = scripted(() => say('ok'));
    fake.hold(new Promise(r => { release = r; }));
    setProviderFactory(async () => fake.provider);
    useAgentStore.getState().send('first');
    useAgentStore.getState().send('second');
    expect(useAgentStore.getState().thread.items[1]).toMatchObject({ kind: 'user', text: 'second', queued: true });
    release();
    await idle();
    expect(fake.seen).toHaveLength(2);
    expect(useAgentStore.getState().thread.items.find(i => i.kind === 'user' && i.text === 'second')).toMatchObject({ queued: false });
  });

  it('follows the assistant to the slide it edits', async () => {
    const fake = scripted(messages => (messages.length === 1
      ? { message: { role: 'assistant', content: [{ type: 'tool_call', id: 't', name: 'update_elements', input: { slideId: s2, patches: [{ id: 'box', x: 5 }] } }] }, stopReason: 'tool_use' }
      : say('done')));
    setProviderFactory(async () => fake.provider);
    useAgentStore.getState().send('move the box on the next slide');
    await idle();
    expect(useEditorStore.getState().activeSlideId).toBe(s2);
  });
});

describe('comments and attachments', () => {
  it('forwards a comment to its slide\'s conversation, and the assistant answers in the thread', async () => {
    const comment = { id: 'cm1', elementIds: ['box'], text: 'Make this red', author: { id: 'u1', name: 'Ada', color: '#000' }, createdAt: 1 };
    store.getState().addComment(s2, comment);
    const fake = scripted(messages => (messages.length === 1
      ? { message: { role: 'assistant', content: [{ type: 'tool_call', id: 't', name: 'reply_to_comment', input: { slideId: s2, commentId: 'cm1', text: 'Done — it is red now.', resolve: true } }] }, stopReason: 'tool_use' }
      : say('Resolved.')));
    setProviderFactory(async () => fake.provider);
    useAgentStore.getState().forwardComment(s2, comment);
    expect(useAgentSettings.getState().panelOpen).toBe(true);
    await idle();

    expect(JSON.stringify(fake.seen[0])).toContain(`Ada left a comment on element box of slide 2 (id ${s2})`);
    const comments = store.getState().presentation.slides[s2].comments!;
    expect(comments.cm1.resolved).toBe(true);
    const reply = Object.values(comments).find(c => c.parentId === 'cm1')!;
    expect(reply).toMatchObject({ text: 'Done — it is red now.', author: { name: 'Assistant', assistant: true } });
    expect(useAgentStore.getState().thread.items[0]).toMatchObject({ fromComment: true });
  });

  it('forwards a comment on a selection as being about those elements together', async () => {
    store.getState().addElement(s1, createShapeElement('ellipse', { id: 'dot' }));
    store.getState().renameObject('dot', 'Marker');
    const comment = { id: 'cm2', elementIds: ['box', 'dot'], text: 'Align these', author: { id: 'u1', name: 'Ada', color: '#000' }, createdAt: 1 };
    store.getState().addComment(s1, comment);
    const fake = scripted(() => say('ok'));
    setProviderFactory(async () => fake.provider);
    useAgentStore.getState().forwardComment(s1, comment);
    await idle();
    expect(JSON.stringify(fake.seen[0])).toContain('on 2 elements together — box, dot (\\"Marker\\") — of slide 1');
  });

  it('forwards a comment on empty space as a spot to put something', async () => {
    const comment = { id: 'cm3', region: { x: 640, y: 120, width: 0, height: 0 }, text: 'Put a bar chart here', author: { id: 'u1', name: 'Ada', color: '#000' }, createdAt: 1 };
    store.getState().addComment(s1, comment);
    const fake = scripted(() => say('ok'));
    setProviderFactory(async () => fake.provider);
    useAgentStore.getState().forwardComment(s1, comment);
    await idle();
    expect(JSON.stringify(fake.seen[0])).toContain('at the spot x=640, y=120 of slide 1');
    expect(JSON.stringify(fake.seen[0])).toContain('(empty space): Put a bar chart here');
  });

  it('sends attachments to the model and lets it place an image on the slide', async () => {
    const attachment: ChatAttachment = {
      id: 'a1', name: 'fig.png', kind: 'image', file: new Blob(['x'], { type: 'image/png' }),
      block: { type: 'image', mediaType: 'image/png', data: 'AA' }, width: 400, height: 200,
    };
    const fake = scripted(messages => (messages.length === 1
      ? { message: { role: 'assistant', content: [{ type: 'tool_call', id: 't', name: 'insert_attachment', input: { slideId: s1, attachmentId: 'a1', x: 10, y: 20, width: 200 } }] }, stopReason: 'tool_use' }
      : say('Placed.')));
    setProviderFactory(async () => fake.provider);
    useAgentStore.getState().send('put this on the slide', [attachment]);
    await idle();

    const firstUser = fake.seen[0][0];
    expect(firstUser.content.some(b => b.type === 'image')).toBe(true);
    const promptText = firstUser.content.find(b => b.type === 'text') as { text: string };
    expect(promptText.text).toContain('a1: image "fig.png" (400×200)');
    const slide = store.getState().presentation.slides[s1];
    const image = Object.values(slide.elements).find(e => e.type === 'image')!;
    expect(image).toMatchObject({ x: 10, y: 20, width: 200, height: 100 });
    expect(Object.values(store.getState().presentation.resources)).toHaveLength(1);
  });

  it('lists open comments in get_slide', async () => {
    store.getState().addComment(s1, { id: 'x', elementIds: ['box'], text: 'bigger', author: { id: 'u', name: 'Bo', color: '#000' }, createdAt: 1 });
    store.getState().addComment(s1, { id: 'y', text: 'done one', author: { id: 'u', name: 'Bo', color: '#000' }, createdAt: 2, resolved: true });
    const out = await runTool('get_slide', { slideId: s1 });
    const view = JSON.parse((out.content[0] as { text: string }).text);
    expect(view.comments).toEqual([{ id: 'x', author: 'Bo', text: 'bigger', elementIds: ['box'] }]);
  });
});
